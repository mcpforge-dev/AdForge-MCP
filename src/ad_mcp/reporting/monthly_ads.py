from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from ad_mcp.core.models import DateRange, ReportRequest


REPORT_FIELDS = ["impressions", "clicks", "spend", "ctr", "conversions", "cr", "interactions"]
METRIC_DEFINITIONS = {
    "spend": "Расход из рекламного кабинета",
    "impressions": "Показы из рекламного кабинета",
    "clicks": "Клики из рекламного кабинета",
    "conversions": "Конверсии платформы; тип результата должен быть уточнён",
    "interactions": "Взаимодействия, как определено платформой",
    "ctr": "CTR = clicks / impressions × 100%",
    "cpc": "CPC = spend / clicks",
    "cpa": "CPA = spend / conversions",
    "cvr": "CVR = conversions / clicks × 100%",
}


def _as_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _pretty_number(value: float | None) -> str:
    if value is None:
        return "—"
    if abs(value - round(value)) < 0.000001:
        return f"{int(round(value)):,}".replace(",", " ")
    return f"{value:,.2f}".replace(",", " ")


def _period(start_date: str, end_date: str, timezone_name: str) -> dict[str, str]:
    return {"start": start_date, "end": end_date, "timezone": timezone_name}


def _source_ref(response: dict[str, Any], provider: str, account_id: str, start_date: str, end_date: str) -> str:
    source_api = str(response.get("source_api") or f"{provider}_api")
    return f"{source_api}:{provider}:{account_id}:{start_date}/{end_date}"


def _metric_value(rows: list[dict[str, Any]], metric: str) -> tuple[float | None, str | None]:
    values: list[float] = []
    seen = False
    for row in rows:
        if metric not in row or row.get(metric) is None:
            continue
        seen = True
        numeric = _as_number(row.get(metric))
        if numeric is not None:
            values.append(numeric)
    if not seen or not values:
        return None, "Источник не вернул показатель за выбранный период."
    return sum(values), None


def _fact(
    fact_id: str,
    name: str,
    value: Any,
    period: dict[str, str],
    source_ref: str,
    *,
    unit: str | None = None,
    status: str = "SOURCE_FACT",
    dimensions: dict[str, Any] | None = None,
    formula: str | None = None,
    evidence_ids: list[str] | None = None,
    unknown_reason: str | None = None,
) -> dict[str, Any]:
    provenance: dict[str, Any] = {
        "status": status,
        "source_type": "advertising_api" if status == "SOURCE_FACT" else None,
        "source_ref": source_ref if status == "SOURCE_FACT" else None,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "formula": formula,
        "evidence_ids": evidence_ids or [],
        "unknown_reason": unknown_reason,
    }
    return {
        "fact_id": fact_id,
        "name": name,
        "value": value,
        "unit": unit,
        "period": period,
        "dimensions": dimensions or {},
        "attribution_window": None,
        "definition": METRIC_DEFINITIONS.get(name),
        "provenance": provenance,
    }


def _question(question_id: str, category: str, question: str, period: str, required_for: list[str]) -> dict[str, Any]:
    return {
        "question_id": question_id,
        "category": category,
        "entity_id": None,
        "period": period,
        "question": question,
        "required_for": required_for,
        "status": "OPEN",
        "answer": None,
        "respondent": None,
        "answered_at": None,
        "source_ref": None,
    }


def _sum_entity_rows(rows: list[dict[str, Any]], entity_key: str) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        entity_id = str(row.get(f"{entity_key}_id") or row.get(entity_key) or "").strip()
        entity_name = str(row.get(f"{entity_key}_name") or row.get(entity_key) or "").strip()
        key = entity_id or entity_name
        if not key:
            continue
        group = groups.setdefault(
            key,
            {
                "entity_id": entity_id or None,
                "entity_name": entity_name or key,
                "spend": 0.0,
                "impressions": 0.0,
                "clicks": 0.0,
                "conversions": 0.0,
                "rows": 0,
            },
        )
        group["rows"] += 1
        for metric in ("spend", "impressions", "clicks", "conversions"):
            numeric = _as_number(row.get(metric))
            if numeric is not None:
                group[metric] += numeric
    result = list(groups.values())
    for group in result:
        clicks = group["clicks"]
        impressions = group["impressions"]
        conversions = group["conversions"]
        group["ctr"] = (clicks / impressions * 100) if impressions else None
        group["cpc"] = (group["spend"] / clicks) if clicks else None
        group["cpa"] = (group["spend"] / conversions) if conversions else None
    return sorted(result, key=lambda item: item["spend"], reverse=True)


def _comparison(current: dict[str, float | None], previous: dict[str, float | None]) -> dict[str, dict[str, float | None]]:
    result: dict[str, dict[str, float | None]] = {}
    for metric, current_value in current.items():
        previous_value = previous.get(metric)
        if current_value is None or previous_value is None:
            result[metric] = {"current": current_value, "previous": previous_value, "delta": None, "delta_percent": None}
            continue
        delta = current_value - previous_value
        delta_percent = (delta / abs(previous_value) * 100) if previous_value else None
        result[metric] = {
            "current": current_value,
            "previous": previous_value,
            "delta": delta,
            "delta_percent": delta_percent,
        }
    return result


def _build_period_summary(
    *,
    response: dict[str, Any],
    provider: str,
    account_id: str,
    start_date: str,
    end_date: str,
    timezone_name: str,
    currency: str,
    facts: list[dict[str, Any]],
    fact_prefix: str,
) -> tuple[dict[str, float | None], dict[str, str], list[str]]:
    rows = response.get("rows") if isinstance(response.get("rows"), list) else []
    period = _period(start_date, end_date, timezone_name)
    source_ref = _source_ref(response, provider, account_id, start_date, end_date)
    totals: dict[str, float | None] = {}
    fact_ids: dict[str, str] = {}
    unknowns: list[str] = []
    for metric in ("spend", "impressions", "clicks", "conversions", "interactions"):
        value, reason = _metric_value(rows, metric)
        totals[metric] = value
        fact_id = f"{fact_prefix}_{metric}"
        fact_ids[metric] = fact_id
        if value is None:
            unknowns.append(metric)
        facts.append(
            _fact(
                fact_id,
                metric,
                {"amount": value, "currency": currency} if metric == "spend" and value is not None else value,
                period,
                source_ref,
                unit=currency if metric == "spend" else "count",
                status="SOURCE_FACT" if value is not None else "UNKNOWN",
                unknown_reason=reason,
            )
        )

    for metric, numerator, denominator, unit, formula in (
        ("ctr", "clicks", "impressions", "%", "clicks / impressions × 100%"),
        ("cpc", "spend", "clicks", currency, "spend / clicks"),
        ("cpa", "spend", "conversions", currency, "spend / conversions"),
        ("cvr", "conversions", "clicks", "%", "conversions / clicks × 100%"),
    ):
        numerator_value = totals.get(numerator)
        denominator_value = totals.get(denominator)
        if numerator_value is None or denominator_value is None or denominator_value == 0:
            value = None
            reason = "Недостаточно данных или знаменатель равен нулю."
            unknowns.append(metric)
        else:
            multiplier = 100 if unit == "%" else 1
            value = numerator_value / denominator_value * multiplier
            reason = None
        totals[metric] = value
        fact_id = f"{fact_prefix}_{metric}"
        fact_ids[metric] = fact_id
        facts.append(
            _fact(
                fact_id,
                metric,
                value,
                period,
                source_ref,
                unit=unit,
                status="CALCULATED" if value is not None else "UNKNOWN",
                formula=formula if value is not None else None,
                evidence_ids=[fact_ids[numerator], fact_ids[denominator]] if value is not None else [],
                unknown_reason=reason,
            )
        )
    return totals, fact_ids, sorted(set(unknowns))


def collect_monthly_ads_report(
    provider_client: Any,
    *,
    provider: str,
    account_id: str,
    start_date: str,
    end_date: str,
    timezone_name: str = "UTC",
    account_name: str | None = None,
    currency: str = "USD",
    include_previous: bool = True,
    report_run_id: str | None = None,
) -> dict[str, Any]:
    """Collect a read-only, provenance-aware report from the connected provider."""
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    if end < start:
        raise ValueError("end_date must be on or after start_date")
    report_run_id = report_run_id or f"monthly-{uuid4()}"
    request = ReportRequest(
        provider=provider,
        account_id=account_id,
        entity_level="campaign",
        date_range=DateRange(start_date=start_date, end_date=end_date),
        fields=REPORT_FIELDS,
    )
    response_model = provider_client.get_report(request)
    response = response_model.model_dump() if hasattr(response_model, "model_dump") else dict(response_model)
    facts: list[dict[str, Any]] = []
    current_totals, current_fact_ids, unknowns = _build_period_summary(
        response=response,
        provider=provider,
        account_id=account_id,
        start_date=start_date,
        end_date=end_date,
        timezone_name=timezone_name,
        currency=currency,
        facts=facts,
        fact_prefix="current",
    )
    previous_response: dict[str, Any] | None = None
    previous_totals: dict[str, float | None] = {}
    previous_period = None
    if include_previous:
        duration = (end - start).days + 1
        previous_end = start - timedelta(days=1)
        previous_start = previous_end - timedelta(days=duration - 1)
        previous_period = _period(previous_start.isoformat(), previous_end.isoformat(), timezone_name)
        previous_model = provider_client.get_report(
            ReportRequest(
                provider=provider,
                account_id=account_id,
                entity_level="campaign",
                date_range=DateRange(start_date=previous_start.isoformat(), end_date=previous_end.isoformat()),
                fields=REPORT_FIELDS,
            )
        )
        previous_response = previous_model.model_dump() if hasattr(previous_model, "model_dump") else dict(previous_model)
        previous_totals, _previous_fact_ids, previous_unknowns = _build_period_summary(
            response=previous_response,
            provider=provider,
            account_id=account_id,
            start_date=previous_start.isoformat(),
            end_date=previous_end.isoformat(),
            timezone_name=timezone_name,
            currency=currency,
            facts=facts,
            fact_prefix="previous",
        )
        unknowns.extend(previous_unknowns)

    rows = response.get("rows") if isinstance(response.get("rows"), list) else []
    source_status = "live" if rows and not response.get("preview") else ("empty" if not rows else "preview")
    source_api = str(response.get("source_api") or f"{provider}_api")
    comparison = _comparison(current_totals, previous_totals) if include_previous else {}
    campaigns = _sum_entity_rows(rows, "campaign")
    top_campaign = campaigns[0] if campaigns else None
    current_period = _period(start_date, end_date, timezone_name)
    current_source_ref = _source_ref(response, provider, account_id, start_date, end_date)
    campaign_fact_ids: dict[str, str] = {}
    for index, campaign in enumerate(campaigns, start=1):
        fact_id = f"current_campaign_{index}_spend"
        campaign_fact_ids[str(campaign.get("entity_id") or campaign.get("entity_name") or index)] = fact_id
        facts.append(
            _fact(
                fact_id,
                "spend",
                {"amount": campaign.get("spend"), "currency": currency},
                current_period,
                current_source_ref,
                unit=currency,
                dimensions={
                    "campaign_id": campaign.get("entity_id"),
                    "campaign_name": campaign.get("entity_name"),
                },
            )
        )
    assertions: list[dict[str, Any]] = []
    if current_totals.get("spend") is not None:
        assertions.append({
            "assertion_id": "assertion_spend",
            "text": f"За период расход составил {_pretty_number(current_totals['spend'])} {currency}.",
            "type": "descriptive",
            "evidence_ids": [current_fact_ids["spend"]],
            "limitations": [],
        })
    if current_totals.get("conversions") is not None:
        assertions.append({
            "assertion_id": "assertion_conversions",
            "text": f"За период рекламная платформа зафиксировала {_pretty_number(current_totals['conversions'])} конверсий.",
            "type": "descriptive",
            "evidence_ids": [current_fact_ids["conversions"]],
            "limitations": ["Типы конверсий платформы не объединены с CRM без отдельного определения."],
        })
    if top_campaign:
        spend = current_totals.get("spend")
        share = (top_campaign["spend"] / spend * 100) if spend else None
        top_campaign["spend_share_percent"] = share
        if share is not None:
            assertions.append({
                "assertion_id": "assertion_top_campaign",
                "text": f"Основную долю расхода сформировала кампания «{top_campaign['entity_name']}» — {share:.1f}%.",
                "type": "calculated",
                "evidence_ids": [current_fact_ids["spend"], campaign_fact_ids.get(str(top_campaign.get("entity_id") or top_campaign.get("entity_name")))],
                "limitations": ["Доля рассчитана по строкам, возвращённым рекламной платформой."],
            })

    questions = [
        _question(
            "business_funnel_quality",
            "business_funnel",
            "Сколько обращений за период были признаны целевыми, записались, пришли или купили услугу? Если данных нет, укажите «Неизвестно / данных нет».",
            f"{start_date}/{end_date}",
            ["quality_assessment", "final_recommendations"],
        ),
        _question(
            "business_revenue",
            "business_funnel",
            "Какая выручка относится к рекламным обращениям за этот период? Если выручка не отслеживается, укажите «Неизвестно / данных нет».",
            f"{start_date}/{end_date}",
            ["roi", "romi", "final_recommendations"],
        ),
        _question(
            "change_reasons",
            "change_reason",
            "Какие изменения в кампаниях, офферах, сайте, CRM или расписании были сделаны в этот период и по какой причине? Если изменений не было, укажите это.",
            f"{start_date}/{end_date}",
            ["causal_analysis", "final_recommendations"],
        ),
    ]
    limitations = [
        "Отчёт использует только данные подключённого рекламного аккаунта и не объединяет их с CRM.",
        "Причины динамики не утверждаются без подтверждения клиента или журнала изменений.",
        "ROI и ROMI не рассчитываются без подтверждённой выручки и правил атрибуции.",
    ]
    if source_status != "live":
        limitations.insert(0, "Источник не вернул живые строки за выбранный период; отсутствующие значения показаны как недоступные.")
    recommendations = [
        {
            "text": "Сверить платформенные конверсии с CRM и определить, какие из них считаются целевыми обращениями.",
            "evidence_ids": [current_fact_ids["conversions"]],
            "condition": "До оценки качества лидов и стоимости целевого обращения.",
        },
        {
            "text": "Зафиксировать подтверждённые изменения кампаний и их причины в журнале перед следующим отчётным периодом.",
            "evidence_ids": [current_fact_ids["spend"], current_fact_ids["conversions"]],
            "condition": "Чтобы отделить измеренную динамику от её причин.",
        },
    ]
    return {
        "report_run_id": report_run_id,
        "mode": "draft_with_gaps",
        "report_type": "monthly_ads_report",
        "title": "Месячный отчёт по рекламе",
        "provider": provider,
        "account": {"account_id": account_id, "name": account_name or account_id, "currency": currency},
        "period": _period(start_date, end_date, timezone_name),
        "previous_period": previous_period,
        "source": {
            "source_api": source_api,
            "real_data": source_status == "live",
            "data_status": source_status,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "available_operations": ["get_campaign_performance"],
            "pending_operations": [
                "get_creative_performance",
                "get_change_history",
                "get_business_funnel",
                "get_auction_insights",
            ],
        },
        "metrics": {metric: {"value": current_totals.get(metric), "fact_id": current_fact_ids.get(metric)} for metric in current_totals},
        "comparison": comparison,
        "campaigns": campaigns,
        "top_campaign": top_campaign,
        "facts": facts,
        "changes": [],
        "questions": questions,
        "assertions": assertions,
        "recommendations": recommendations,
        "available_sections": ["campaign_performance", "period_comparison"],
        "pending_sections": ["change_history", "creative_performance", "organic_engagement", "auction_insights", "business_funnel"],
        "limitations": limitations,
        "unknowns": sorted(set(unknowns)),
        "source_refs": sorted({
            _source_ref(response, provider, account_id, start_date, end_date),
            *([_source_ref(previous_response, provider, account_id, previous_period["start"], previous_period["end"])] if previous_response and previous_period else []),
        }),
    }

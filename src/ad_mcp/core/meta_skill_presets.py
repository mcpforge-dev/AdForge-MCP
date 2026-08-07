from __future__ import annotations

from datetime import date
from typing import Any

from ad_mcp.settings import Settings


def _safe_float(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _first_period(periods: list[dict[str, Any]], period: str) -> dict[str, Any]:
    return next((item for item in periods if item.get("period") == period), {})


def _issue_reason(issue: dict[str, Any]) -> str:
    review = str(issue.get("review_feedback") or "").strip()
    if review:
        return review
    status = str(issue.get("status") or "").strip()
    if status and status != "UNKNOWN":
        return f"Проблемный статус: {status}"
    if issue.get("issues_info"):
        return "Meta вернула issues_info для этой сущности."
    return "Сущность требует ручной проверки."


def _status_rows(statuses: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for group_name, group_rows in statuses.items():
        for status, count in sorted(group_rows.items(), key=lambda item: (-item[1], item[0])):
            rows.append({"group": group_name, "status": status, "count": count})
    return rows


def build_clickhouse_contract(settings: Settings | None = None) -> dict[str, Any]:
    resolved = settings or Settings()
    return {
        "database": {
            "engine": "ClickHouse",
            "host": resolved.clickhouse_host,
            "port": resolved.clickhouse_port,
            "database": resolved.clickhouse_database,
            "user": resolved.clickhouse_user,
            "configured": bool(resolved.clickhouse_host and resolved.clickhouse_database),
            "enabled": resolved.clickhouse_enabled,
            "secure": resolved.clickhouse_secure,
            "mode": "runtime_contract",
        },
        "tables": [
            {
                "name": "meta_account_daily_fact",
                "purpose": "Ежедневная агрегация по аккаунту для overview, spend, billing и ключевых KPI.",
                "order_by": ["event_date", "provider", "account_id"],
                "columns": [
                    {"name": "event_date", "type": "Date"},
                    {"name": "provider", "type": "LowCardinality(String)"},
                    {"name": "account_id", "type": "String"},
                    {"name": "account_name", "type": "String"},
                    {"name": "currency", "type": "LowCardinality(String)"},
                    {"name": "spend", "type": "Float64"},
                    {"name": "impressions", "type": "UInt64"},
                    {"name": "clicks", "type": "UInt64"},
                    {"name": "conversions", "type": "Float64"},
                    {"name": "ctr", "type": "Float64"},
                    {"name": "cpm", "type": "Float64"},
                    {"name": "balance_due", "type": "Float64"},
                    {"name": "issue_count", "type": "UInt32"},
                    {"name": "synced_at", "type": "DateTime"},
                ],
            },
            {
                "name": "meta_entity_daily_fact",
                "purpose": "Ежедневная детализация по campaign/adset/ad для ranking, решений по отключению и масштабированию.",
                "order_by": ["event_date", "account_id", "entity_level", "entity_id"],
                "columns": [
                    {"name": "event_date", "type": "Date"},
                    {"name": "account_id", "type": "String"},
                    {"name": "entity_level", "type": "LowCardinality(String)"},
                    {"name": "entity_id", "type": "String"},
                    {"name": "entity_name", "type": "String"},
                    {"name": "effective_status", "type": "LowCardinality(String)"},
                    {"name": "objective", "type": "LowCardinality(String)"},
                    {"name": "spend", "type": "Float64"},
                    {"name": "impressions", "type": "UInt64"},
                    {"name": "reach", "type": "UInt64"},
                    {"name": "clicks", "type": "UInt64"},
                    {"name": "conversions", "type": "Float64"},
                    {"name": "ctr", "type": "Float64"},
                    {"name": "cpc", "type": "Float64"},
                    {"name": "cpm", "type": "Float64"},
                    {"name": "cost_per_result", "type": "Float64"},
                    {"name": "frequency_avg", "type": "Float64"},
                    {"name": "synced_at", "type": "DateTime"},
                ],
            },
            {
                "name": "meta_delivery_issue_log",
                "purpose": "Лог проблем доставки, policy-issues и review-feedback для diagnostics и очереди оператора.",
                "order_by": ["captured_at", "account_id", "object_type", "entity_id"],
                "columns": [
                    {"name": "captured_at", "type": "DateTime"},
                    {"name": "account_id", "type": "String"},
                    {"name": "object_type", "type": "LowCardinality(String)"},
                    {"name": "entity_id", "type": "String"},
                    {"name": "entity_name", "type": "String"},
                    {"name": "status", "type": "LowCardinality(String)"},
                    {"name": "issue_summary", "type": "String"},
                    {"name": "raw_payload", "type": "String"},
                ],
            },
            {
                "name": "meta_preview_action_log",
                "purpose": "История preview-действий из UI/MCP для аудита и перехода к безопасным commit flows.",
                "order_by": ["created_at", "account_id", "object_type", "action"],
                "columns": [
                    {"name": "created_at", "type": "DateTime"},
                    {"name": "account_id", "type": "String"},
                    {"name": "object_type", "type": "LowCardinality(String)"},
                    {"name": "action", "type": "LowCardinality(String)"},
                    {"name": "preview_token", "type": "String"},
                    {"name": "risk_flags", "type": "Array(String)"},
                    {"name": "diff_json", "type": "String"},
                    {"name": "provider_payload_json", "type": "String"},
                ],
            },
        ],
        "ui_outputs": [
            {"section": "overview", "source_tables": ["meta_account_daily_fact"], "keys": ["account_id", "event_date"]},
            {"section": "top_performers", "source_tables": ["meta_entity_daily_fact"], "keys": ["account_id", "entity_level", "entity_id", "event_date"]},
            {"section": "no_result_spend", "source_tables": ["meta_entity_daily_fact"], "keys": ["account_id", "entity_level", "entity_id", "event_date"]},
            {"section": "delivery_issues", "source_tables": ["meta_delivery_issue_log"], "keys": ["account_id", "entity_id", "captured_at"]},
            {"section": "preview_actions", "source_tables": ["meta_preview_action_log"], "keys": ["preview_token", "created_at"]},
        ],
    }


def build_skill_catalog(account_id: str, end_date: str | None = None) -> list[dict[str, Any]]:
    resolved_end_date = end_date or date.today().isoformat()
    return [
        {
            "id": "collect_report",
            "title": "Собери отчет",
            "description": "Собирает проверенный отчёт по рекламному кабинету: KPI, сравнение периодов, кампании, подтверждённые выводы, ограничения и вопросы клиенту.",
            "mcp_tool": "collect_report_skill",
            "web_path": "/api/meta/skills/collect-report",
            "prompt": (
                "Используй MCP server ads и вызови collect_report_skill для проверенного отчёта по provider meta_ads, "
                f"account_id {account_id}, end_date {resolved_end_date}."
            ),
        },
        {
            "id": "budget_summary",
            "title": "Сколько слили бюджета",
            "description": "Показывает расход за today / 7 / 30 дней и базовый billing snapshot.",
            "mcp_tool": "summarize_budget_skill",
            "web_path": "/api/meta/skills/budget-summary",
            "prompt": (
                "Используй MCP server ads и вызови summarize_budget_skill для provider meta_ads, "
                f"account_id {account_id}, end_date {resolved_end_date}."
            ),
        },
        {
            "id": "disable_candidates",
            "title": "Что отключать",
            "description": "Находит сущности с расходом без результата и delivery issues, которые стоит проверить первыми.",
            "mcp_tool": "disable_candidates_skill",
            "web_path": "/api/meta/skills/disable-candidates",
            "prompt": (
                "Используй MCP server ads и вызови disable_candidates_skill для provider meta_ads, "
                f"account_id {account_id}, end_date {resolved_end_date}."
            ),
        },
        {
            "id": "scale_candidates",
            "title": "Что масштабировать",
            "description": "Показывает лучшие сущности по стоимости результата и конверсиям.",
            "mcp_tool": "scale_candidates_skill",
            "web_path": "/api/meta/skills/scale-candidates",
            "prompt": (
                "Используй MCP server ads и вызови scale_candidates_skill для provider meta_ads, "
                f"account_id {account_id}, end_date {resolved_end_date}."
            ),
        },
    ]


def build_budget_skill_summary(
    account_id: str,
    end_date: str,
    spend: dict[str, Any],
    billing: dict[str, Any],
) -> dict[str, Any]:
    periods = spend.get("periods", [])
    today = _first_period(periods, "today")
    week = _first_period(periods, "last_7_days")
    month = _first_period(periods, "last_30_days")
    billing_payload = billing.get("billing", {})
    account_name = billing.get("account_name") or spend.get("account_name") or account_id

    summary = (
        f"Аккаунт {account_name}: сегодня {today.get('spend', 0):.2f} USD, "
        f"за 7 дней {week.get('spend', 0):.2f} USD, за 30 дней {month.get('spend', 0):.2f} USD."
    )
    if _safe_float(billing_payload.get("balance_due")) > 0:
        summary += f" Задолженность по кабинету: {billing_payload.get('balance_due', 0):.2f} USD."

    return {
        "skill": "summarize_budget",
        "title": "Сколько слили бюджета",
        "account_id": account_id,
        "end_date": end_date,
        "summary": summary,
        "periods": periods,
        "billing": billing_payload,
        "next_actions": [
            "Проверьте расход за 7 и 30 дней против количества результатов.",
            "Если balance_due растет, проверьте платежный статус и лимиты аккаунта.",
        ],
    }

def build_disable_candidates_skill(
    account_id: str,
    start_date: str,
    end_date: str,
    issues: dict[str, Any],
    no_result_entities: dict[str, Any],
    min_spend: float,
    max_items: int = 10,
) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()

    for row in no_result_entities.get("rows", []):
        entity_id = str(row.get("entity_id") or row.get("campaign_id") or row.get("ad_id") or row.get("adset_id") or "")
        if not entity_id or entity_id in seen:
            continue
        seen.add(entity_id)
        candidates.append(
            {
                "entity_id": entity_id,
                "entity_name": row.get("entity_name") or "Без названия",
                "spend": round(_safe_float(row.get("spend")), 2),
                "conversions": round(_safe_float(row.get("conversions")), 2),
                "ctr": round(_safe_float(row.get("ctr")), 4),
                "reason": "Есть расход без результата.",
                "source": "no_result_spend",
            }
        )

    for issue in issues.get("issues", []):
        entity_id = str(issue.get("id") or "")
        if not entity_id or entity_id in seen:
            continue
        seen.add(entity_id)
        candidates.append(
            {
                "entity_id": entity_id,
                "entity_name": issue.get("name") or "Без названия",
                "spend": None,
                "conversions": None,
                "ctr": None,
                "reason": _issue_reason(issue),
                "source": "delivery_issues",
            }
        )

    candidates = candidates[:max_items]
    summary = (
        f"Найдено {len(candidates)} кандидатов на проверку/отключение "
        f"за период {start_date} — {end_date} при min spend {min_spend:.2f} USD."
    )
    return {
        "skill": "disable_candidates",
        "title": "Что отключать",
        "account_id": account_id,
        "start_date": start_date,
        "end_date": end_date,
        "summary": summary,
        "candidates": candidates,
        "next_actions": [
            "Сначала проверьте сущности с расходом без результата.",
            "Отдельно проверьте delivery issues и disapproved statuses.",
        ],
    }


def build_scale_candidates_skill(
    account_id: str,
    start_date: str,
    end_date: str,
    top_performers: dict[str, Any],
    max_cost_per_result: float,
    min_conversions: float = 1.0,
    max_items: int = 10,
) -> dict[str, Any]:
    candidates = [
        {
            "entity_id": row.get("entity_id"),
            "entity_name": row.get("entity_name") or "Без названия",
            "spend": round(_safe_float(row.get("spend")), 2),
            "conversions": round(_safe_float(row.get("conversions")), 2),
            "cost_per_result": round(_safe_float(row.get("cost_per_result")), 2),
            "ctr": round(_safe_float(row.get("ctr")), 4),
        }
        for row in top_performers.get("rows", [])
        if _safe_float(row.get("conversions")) >= min_conversions
        and 0 < _safe_float(row.get("cost_per_result")) <= max_cost_per_result
    ][:max_items]

    summary = (
        f"Найдено {len(candidates)} кандидатов на масштабирование "
        f"за период {start_date} — {end_date} при max cost per result {max_cost_per_result:.2f}."
    )
    return {
        "skill": "scale_candidates",
        "title": "Что масштабировать",
        "account_id": account_id,
        "start_date": start_date,
        "end_date": end_date,
        "summary": summary,
        "candidates": candidates,
        "next_actions": [
            "Сначала увеличивайте бюджет на лучших сущностях постепенно.",
            "Проверяйте, не упирается ли ad set в learning, частоту или placement limits.",
        ],
    }


def build_report_skill(
    account_id: str,
    end_date: str,
    budget_summary: dict[str, Any],
    disable_candidates: dict[str, Any],
    scale_candidates: dict[str, Any],
    issues: dict[str, Any],
) -> dict[str, Any]:
    disable_count = len(disable_candidates.get("candidates", []))
    scale_count = len(scale_candidates.get("candidates", []))
    issue_count = len(issues.get("issues", []))
    summary = (
        f"По аккаунту {account_id}: расход за 30 дней "
        f"{(_first_period(budget_summary.get('periods', []), 'last_30_days').get('spend') or 0):.2f} USD, "
        f"кандидатов на отключение {disable_count}, кандидатов на масштабирование {scale_count}, "
        f"активных delivery issues {issue_count}."
    )
    return {
        "skill": "collect_report",
        "title": "Собери отчет",
        "account_id": account_id,
        "end_date": end_date,
        "summary": summary,
        "sections": {
            "budget": budget_summary,
            "disable_candidates": disable_candidates,
            "scale_candidates": scale_candidates,
            "delivery_issues": issues,
        },
        "recommended_actions": [
            "Проверьте сущности из блока 'Что отключать'.",
            "Проверьте сущности из блока 'Что масштабировать'.",
            "Разберите delivery issues до изменения бюджетов.",
        ],
    }


def build_workspace_snapshot(
    *,
    settings: Settings,
    account_id: str,
    end_date: str,
    available_accounts: list[dict[str, Any]],
    dashboard: dict[str, Any],
    structure: dict[str, Any],
    issues: dict[str, Any],
    assets: dict[str, Any],
    performers: dict[str, Any],
    no_result: dict[str, Any],
    config_diagnostics: dict[str, Any],
    auth_diagnostics: dict[str, Any],
    diagnostics_health: dict[str, Any],
    budget_summary: dict[str, Any],
    disable_candidates: dict[str, Any],
    scale_candidates: dict[str, Any],
    report_skill: dict[str, Any],
    persistence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    account = dashboard.get("account", {})
    account_data = account.get("data", {}) if isinstance(account, dict) else {}
    spend_periods = dashboard.get("spend", {}).get("periods", [])
    today = _first_period(spend_periods, "today")
    week = _first_period(spend_periods, "last_7_days")
    month = _first_period(spend_periods, "last_30_days")
    clickhouse = build_clickhouse_contract(settings)
    persistence_payload = persistence or {"status": "skipped", "reason": "not_requested", "tables": {}}

    return {
        "provider": "meta_ads",
        "account_id": account_id,
        "generated_at": date.today().isoformat(),
        "header": {
            "account_name": account_data.get("name") or budget_summary.get("billing", {}).get("account_name") or account_id,
            "account_id": account_id,
            "currency": account_data.get("currency") or dashboard.get("billing", {}).get("billing", {}).get("currency"),
            "timezone": account_data.get("timezone_name"),
            "end_date": end_date,
            "available_accounts": available_accounts,
        },
        "summary": {
            "headline": report_skill.get("summary"),
            "metrics": [
                {"id": "spend_today", "label": "Расход сегодня", "value": _safe_float(today.get("spend")), "format": "currency"},
                {"id": "spend_7d", "label": "Расход за 7 дней", "value": _safe_float(week.get("spend")), "format": "currency"},
                {"id": "spend_30d", "label": "Расход за 30 дней", "value": _safe_float(month.get("spend")), "format": "currency"},
                {"id": "issue_count", "label": "Проблемы доставки", "value": int(issues.get("issue_count", 0) or 0), "format": "number"},
                {"id": "disable_count", "label": "Кандидаты на отключение", "value": len(disable_candidates.get("candidates", [])), "format": "number"},
                {"id": "scale_count", "label": "Кандидаты на масштабирование", "value": len(scale_candidates.get("candidates", [])), "format": "number"},
            ],
            "operator_summary": [
                {"label": "Бюджет", "value": budget_summary.get("summary")},
                {"label": "Отключение", "value": disable_candidates.get("summary")},
                {"label": "Масштабирование", "value": scale_candidates.get("summary")},
                {"label": "ClickHouse", "value": f"Статус синка: {persistence_payload.get('status', 'unknown')}"},
            ],
            "totals": dashboard.get("totals", {}),
            "status_rows": _status_rows(dashboard.get("statuses", {})),
        },
        "sections": {
            "overview": dashboard,
            "structure": structure,
            "issues": issues,
            "assets": assets,
            "performers": performers,
            "no_result": no_result,
            "diagnostics": {
                "config": config_diagnostics,
                "auth": auth_diagnostics,
                "health": diagnostics_health,
                "persistence": persistence_payload,
            },
        },
        "skills": {
            "catalog": build_skill_catalog(account_id, end_date),
            "budget_summary": budget_summary,
            "disable_candidates": disable_candidates,
            "scale_candidates": scale_candidates,
            "collect_report": report_skill,
        },
        "persistence": persistence_payload,
        "data_contract": {
            "clickhouse": clickhouse,
            "ui_outputs": clickhouse.get("ui_outputs", []),
        },
    }

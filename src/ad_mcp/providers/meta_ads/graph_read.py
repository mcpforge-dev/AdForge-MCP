from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import httpx

from ad_mcp.core.redaction import redact_secret_text
from ad_mcp.providers.meta_ads.auth import MetaAccountCredentials
from ad_mcp.providers.meta_ads.provenance import live_meta_payload


class MetaGraphAPIError(RuntimeError):
    def __init__(self, message: str, *, code: int | None = None, subcode: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.subcode = subcode


class MetaGraphClient:
    def __init__(
        self,
        credentials: MetaAccountCredentials,
        http_client: httpx.Client | None = None,
    ) -> None:
        self.credentials = credentials
        self.http_client = http_client

    @property
    def base_url(self) -> str:
        version = self.credentials.api_version.strip() or "v20.0"
        version = version if version.startswith("v") else f"v{version}"
        return f"https://graph.facebook.com/{version}"

    def get(
        self,
        path_or_url: str,
        params: dict[str, Any] | None = None,
        *,
        access_token: str | None = None,
    ) -> dict[str, Any]:
        if path_or_url.startswith("https://"):
            parsed = urlparse(path_or_url)
            if (
                parsed.hostname != "graph.facebook.com"
                or parsed.username
                or parsed.password
                or parsed.fragment
            ):
                raise MetaGraphAPIError("Meta Graph pagination URL is not trusted.")
            url = path_or_url
        else:
            url = f"{self.base_url}/{path_or_url.lstrip('/')}"
        token = access_token or self.credentials.access_token
        client = self.http_client or httpx.Client(timeout=20.0)
        close_client = self.http_client is None
        try:
            response = client.get(url, params=params, headers={"Authorization": f"Bearer {token}"})
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise MetaGraphAPIError(redact_secret_text(f"Meta Graph request failed: {exc}")) from exc
        finally:
            if close_client:
                client.close()
        if not isinstance(payload, dict):
            raise MetaGraphAPIError("Meta Graph returned a non-object payload.")
        if payload.get("error"):
            error = payload["error"] if isinstance(payload["error"], dict) else {"message": str(payload["error"])}
            code = error.get("code")
            subcode = error.get("error_subcode")
            message = redact_secret_text(str(error.get("message") or "Unknown Meta Graph error"))
            suffix = f" code={code}" if code is not None else ""
            suffix += f" subcode={subcode}" if subcode is not None else ""
            raise MetaGraphAPIError(f"Meta Graph error:{suffix} {message}", code=code, subcode=subcode)
        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise MetaGraphAPIError(redact_secret_text(f"Meta Graph request failed: {exc}")) from exc
        return payload

    def post(
        self,
        path: str,
        data: dict[str, Any],
        *,
        access_token: str | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}/{path.lstrip('/')}"
        token = access_token or self.credentials.access_token
        client = self.http_client or httpx.Client(timeout=20.0)
        close_client = self.http_client is None
        try:
            response = client.post(url, data=data, headers={"Authorization": f"Bearer {token}"})
            payload = response.json()
            response.raise_for_status()
        except (httpx.HTTPError, ValueError) as exc:
            raise MetaGraphAPIError(redact_secret_text(f"Meta Graph mutation failed: {exc}")) from exc
        finally:
            if close_client:
                client.close()
        if not isinstance(payload, dict):
            raise MetaGraphAPIError("Meta Graph mutation returned a non-object payload.")
        if payload.get("error"):
            error = payload["error"] if isinstance(payload["error"], dict) else {"message": str(payload["error"])}
            raise MetaGraphAPIError(redact_secret_text(str(error.get("message") or "Meta Graph mutation failed.")))
        return payload

    def list_edge(
        self,
        path: str,
        params: dict[str, Any],
        *,
        access_token: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 100), 500))
        request_params = {**params, "limit": min(safe_limit, 100)}
        path_or_url = path
        rows: list[dict[str, Any]] = []
        for _ in range(10):
            payload = self.get(path_or_url, request_params, access_token=access_token)
            rows.extend(item for item in payload.get("data", []) if isinstance(item, dict))
            if len(rows) >= safe_limit:
                break
            paging = payload.get("paging") if isinstance(payload.get("paging"), dict) else {}
            next_url = paging.get("next")
            if not next_url:
                break
            path_or_url = str(next_url)
            request_params = {}
        return rows[:safe_limit]

    def page_access_token(self, page_id: str) -> str:
        rows = self.list_edge(
            "/me/accounts",
            {"fields": "id,name,access_token"},
            limit=500,
        )
        for row in rows:
            if str(row.get("id") or "") == str(page_id):
                token = str(row.get("access_token") or "").strip()
                if token:
                    return token
        raise MetaGraphAPIError(
            "The connected Meta user did not provide a Page Access Token for this Page. "
            "Reconnect OAuth with pages_show_list and pages_read_engagement."
        )


def _client(
    credentials: MetaAccountCredentials,
    http_client: httpx.Client | None = None,
) -> MetaGraphClient:
    return MetaGraphClient(credentials, http_client)


def list_meta_permissions(credentials: MetaAccountCredentials, http_client: httpx.Client | None = None) -> dict[str, Any]:
    rows = _client(credentials, http_client).list_edge("/me/permissions", {"fields": "permission,status"}, limit=200)
    granted = sorted(str(row["permission"]) for row in rows if row.get("status") == "granted" and row.get("permission"))
    declined = sorted(str(row["permission"]) for row in rows if row.get("status") != "granted" and row.get("permission"))
    return live_meta_payload({"permissions": rows, "granted": granted, "declined": declined, "row_count": len(rows)})


def list_meta_businesses(credentials: MetaAccountCredentials, limit: int = 100, http_client: httpx.Client | None = None) -> dict[str, Any]:
    rows = _client(credentials, http_client).list_edge(
        "/me/businesses",
        {"fields": "id,name,verification_status,created_time"},
        limit=limit,
    )
    return live_meta_payload({"businesses": rows, "row_count": len(rows)})


def get_meta_business(credentials: MetaAccountCredentials, business_id: str, http_client: httpx.Client | None = None) -> dict[str, Any]:
    data = _client(credentials, http_client).get(
        f"/{business_id}",
        {"fields": "id,name,verification_status,created_time,updated_time"},
    )
    return live_meta_payload({"business": data})


def _business_assets(
    credentials: MetaAccountCredentials,
    business_id: str,
    edges: tuple[str, ...],
    fields: str,
    limit: int,
    http_client: httpx.Client | None,
) -> list[dict[str, Any]]:
    graph = _client(credentials, http_client)
    combined: dict[str, dict[str, Any]] = {}
    for edge in edges:
        for row in graph.list_edge(f"/{business_id}/{edge}", {"fields": fields}, limit=limit):
            item_id = str(row.get("id") or "")
            if not item_id:
                continue
            combined.setdefault(item_id, {**row, "business_relationship": edge})
    return list(combined.values())[: max(1, min(int(limit or 100), 500))]


def list_business_ad_accounts(
    credentials: MetaAccountCredentials,
    business_id: str,
    limit: int = 100,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    rows = _business_assets(
        credentials,
        business_id,
        ("owned_ad_accounts", "client_ad_accounts"),
        "id,account_id,name,account_status,currency,timezone_name,business",
        limit,
        http_client,
    )
    return live_meta_payload({"business_id": business_id, "ad_accounts": rows, "row_count": len(rows)})


def list_business_pages(
    credentials: MetaAccountCredentials,
    business_id: str,
    limit: int = 100,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    rows = _business_assets(
        credentials,
        business_id,
        ("owned_pages", "client_pages"),
        "id,name,category,link",
        limit,
        http_client,
    )
    return live_meta_payload({"business_id": business_id, "pages": rows, "row_count": len(rows)})


def list_meta_pages(credentials: MetaAccountCredentials, limit: int = 100, http_client: httpx.Client | None = None) -> dict[str, Any]:
    rows = _client(credentials, http_client).list_edge(
        "/me/accounts",
        {"fields": "id,name,category,link,tasks"},
        limit=limit,
    )
    return live_meta_payload({"pages": rows, "row_count": len(rows)})


def get_meta_page(credentials: MetaAccountCredentials, page_id: str, http_client: httpx.Client | None = None) -> dict[str, Any]:
    graph = _client(credentials, http_client)
    token = graph.page_access_token(page_id)
    data = graph.get(
        f"/{page_id}",
        {"fields": "id,name,category,link,about,fan_count,followers_count"},
        access_token=token,
    )
    return live_meta_payload({"page": data})


def _summary_count(value: Any) -> int | None:
    if not isinstance(value, dict):
        return None
    summary = value.get("summary")
    if not isinstance(summary, dict) or "total_count" not in summary:
        return None
    try:
        return int(summary["total_count"])
    except (TypeError, ValueError):
        return None


def _share_count(value: Any) -> int | None:
    if not isinstance(value, dict) or "count" not in value:
        return None
    try:
        return int(value["count"])
    except (TypeError, ValueError):
        return None


def _attachment_description(post: dict[str, Any]) -> str | None:
    attachments = post.get("attachments")
    rows = attachments.get("data") if isinstance(attachments, dict) else None
    if not isinstance(rows, list):
        return None
    for row in rows:
        if not isinstance(row, dict):
            continue
        description = str(row.get("description") or row.get("title") or "").strip()
        if description:
            return description
    return None


def _normalize_page_post(post: dict[str, Any]) -> dict[str, Any]:
    description = _attachment_description(post)
    text = str(post.get("message") or post.get("story") or description or "").strip() or None
    return {
        **post,
        "post_id": str(post.get("id") or ""),
        "text": text,
        "description": description,
        "permalink": post.get("permalink_url"),
        "engagement": {
            "comments": _summary_count(post.get("comments")),
            "reactions": _summary_count(post.get("reactions")),
            "shares": _share_count(post.get("shares")),
        },
    }


PAGE_POST_CORE_FIELDS = (
    "id,message,story,created_time,permalink_url,full_picture,"
    "attachments{description,title,type,url},shares"
)
PAGE_POST_REACTION_FIELDS = f"{PAGE_POST_CORE_FIELDS},reactions.limit(0).summary(true)"
PAGE_POST_FIELDS = f"{PAGE_POST_REACTION_FIELDS},comments.limit(0).summary(true)"


def _list_published_posts(
    graph: MetaGraphClient,
    page_id: str,
    token: str,
    limit: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    variants = (
        (PAGE_POST_FIELDS, []),
        (PAGE_POST_REACTION_FIELDS, ["comments"]),
        (PAGE_POST_CORE_FIELDS, ["comments", "reactions"]),
    )
    for fields, unavailable_fields in variants:
        try:
            rows = graph.list_edge(
                f"/{page_id}/published_posts",
                {"fields": fields},
                access_token=token,
                limit=limit,
            )
            return rows, unavailable_fields
        except MetaGraphAPIError as exc:
            if exc.code not in {10, 100, 200} or fields == PAGE_POST_CORE_FIELDS:
                raise
    raise MetaGraphAPIError("Meta Graph did not return Page publications.")


def list_page_posts(
    credentials: MetaAccountCredentials,
    page_id: str,
    limit: int = 25,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    graph = _client(credentials, http_client)
    token = graph.page_access_token(page_id)
    rows, unavailable_fields = _list_published_posts(graph, page_id, token, limit)
    posts = [_normalize_page_post(row) for row in rows]
    return live_meta_payload(
        {
            "page_id": page_id,
            "post_source": "page_published_posts",
            "posts": posts,
            "row_count": len(posts),
            "unavailable_engagement_fields": unavailable_fields,
            "partial": bool(unavailable_fields),
        }
    )


def get_page_post(
    credentials: MetaAccountCredentials,
    page_id: str,
    post_id: str,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    graph = _client(credentials, http_client)
    token = graph.page_access_token(page_id)
    variants = (
        (PAGE_POST_FIELDS, []),
        (PAGE_POST_REACTION_FIELDS, ["comments"]),
        (PAGE_POST_CORE_FIELDS, ["comments", "reactions"]),
    )
    data: dict[str, Any] = {}
    unavailable_fields: list[str] = []
    for fields, missing in variants:
        try:
            data = graph.get(
                f"/{post_id}",
                {"fields": f"{fields},updated_time"},
                access_token=token,
            )
            unavailable_fields = missing
            break
        except MetaGraphAPIError as exc:
            if exc.code not in {10, 100, 200} or fields == PAGE_POST_CORE_FIELDS:
                raise
    return live_meta_payload(
        {
            "page_id": page_id,
            "post": _normalize_page_post(data),
            "unavailable_engagement_fields": unavailable_fields,
            "partial": bool(unavailable_fields),
        }
    )


def get_page_post_engagement(
    credentials: MetaAccountCredentials,
    page_id: str,
    post_id: str,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    graph = _client(credentials, http_client)
    token = graph.page_access_token(page_id)
    variants = (
        ("id,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)", []),
        ("id,shares,reactions.limit(0).summary(true)", ["comments"]),
        ("id,shares", ["comments", "reactions"]),
    )
    post: dict[str, Any] = {}
    unavailable_fields: list[str] = []
    for fields, missing in variants:
        try:
            post = graph.get(f"/{post_id}", {"fields": fields}, access_token=token)
            unavailable_fields = missing
            break
        except MetaGraphAPIError as exc:
            if exc.code not in {10, 100, 200} or fields == "id,shares":
                raise
    return live_meta_payload(
        {
            "page_id": page_id,
            "post_id": post_id,
            "engagement": {
                "comments": _summary_count(post.get("comments")),
                "reactions": _summary_count(post.get("reactions")),
                "shares": _share_count(post.get("shares")),
            },
            "insights": [],
            "insights_status": "not_requested",
            "partial": bool(unavailable_fields),
            "unavailable_engagement_fields": unavailable_fields,
            "warnings": [],
        }
    )


def get_page_instagram_account(
    credentials: MetaAccountCredentials,
    page_id: str,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    graph = _client(credentials, http_client)
    token = graph.page_access_token(page_id)
    try:
        page = graph.get(
            f"/{page_id}",
            {"fields": "id,name,instagram_business_account{id}"},
            access_token=token,
        )
    except MetaGraphAPIError as exc:
        if not str(exc).startswith("Meta Graph error:"):
            raise
        return live_meta_payload(
            {
                "page": {"id": page_id, "name": None},
                "instagram_account": None,
                "linked": None,
                "status": "additional_permission_required",
                "additional_permission_required": ["instagram_basic"],
                "message": "Meta did not expose the linked Instagram account with the current Page permissions.",
            },
            real_data=False,
            data_status="additional_permission_required",
        )
    instagram = page.get("instagram_business_account")
    return live_meta_payload(
        {
            "page": {"id": page.get("id"), "name": page.get("name")},
            "instagram_account": instagram if isinstance(instagram, dict) else None,
            "linked": isinstance(instagram, dict),
        }
    )

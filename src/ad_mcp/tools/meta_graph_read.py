from __future__ import annotations

from ad_mcp.core.capability_registry import CapabilityRegistry
from ad_mcp.core.policy import PolicyManager
from ad_mcp.tools._shared import validate_provider_account


def build_meta_graph_read_tools(
    registry: CapabilityRegistry,
    policy_manager: PolicyManager,
) -> dict[str, callable]:
    def _provider(account_id: str):
        validate_provider_account(registry, policy_manager, "meta_ads", account_id)
        return registry.get_provider("meta_ads")

    def get_meta_oauth_permissions(account_id: str) -> dict:
        """Read permissions actually granted to the connected Meta user token."""
        return _provider(account_id).list_meta_permissions(account_id)

    def list_meta_businesses(account_id: str, limit: int = 100) -> dict:
        """List real Meta Business portfolios available to the connected user."""
        return _provider(account_id).list_meta_businesses(account_id, limit)

    def get_meta_business(account_id: str, business_id: str) -> dict:
        """Read a Meta Business portfolio by ID from Graph API."""
        return _provider(account_id).get_meta_business(account_id, business_id)

    def list_business_ad_accounts(account_id: str, business_id: str, limit: int = 100) -> dict:
        """List owned and client ad accounts attached to a Meta Business."""
        return _provider(account_id).list_business_ad_accounts(account_id, business_id, limit)

    def list_business_pages(account_id: str, business_id: str, limit: int = 100) -> dict:
        """List owned and client Facebook Pages attached to a Meta Business."""
        return _provider(account_id).list_business_pages(account_id, business_id, limit)

    def list_meta_pages(account_id: str, limit: int = 100) -> dict:
        """List Facebook Pages available to the connected Meta user."""
        return _provider(account_id).list_meta_pages(account_id, limit)

    def get_meta_page(account_id: str, page_id: str) -> dict:
        """Read a Facebook Page using its Page Access Token."""
        return _provider(account_id).get_meta_page(account_id, page_id)

    def list_page_posts(account_id: str, page_id: str, limit: int = 25) -> dict:
        """List posts created by a connected Facebook Page without reading user comments."""
        return _provider(account_id).list_page_posts(account_id, page_id, limit)

    def get_page_post(account_id: str, page_id: str, post_id: str) -> dict:
        """Read one Facebook Page post and its visible engagement summaries."""
        return _provider(account_id).get_page_post(account_id, page_id, post_id)

    def get_page_post_engagement(account_id: str, page_id: str, post_id: str) -> dict:
        """Read allowed Page engagement and report fields that require additional permissions."""
        return _provider(account_id).get_page_post_engagement(account_id, page_id, post_id)

    def get_page_instagram_account(account_id: str, page_id: str) -> dict:
        """Resolve a linked Instagram ID when current Page permissions expose it."""
        return _provider(account_id).get_page_instagram_account(account_id, page_id)

    return {
        "get_meta_oauth_permissions": get_meta_oauth_permissions,
        "list_meta_businesses": list_meta_businesses,
        "get_meta_business": get_meta_business,
        "list_business_ad_accounts": list_business_ad_accounts,
        "list_business_pages": list_business_pages,
        "list_meta_pages": list_meta_pages,
        "get_meta_page": get_meta_page,
        "list_page_posts": list_page_posts,
        "get_page_post": get_page_post,
        "get_page_post_engagement": get_page_post_engagement,
        "get_page_instagram_account": get_page_instagram_account,
    }

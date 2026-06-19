from __future__ import annotations

from collections.abc import Callable

from ad_mcp.core.errors import ProviderNotFoundError
from ad_mcp.core.models import CapabilityMap, ProviderName
from ad_mcp.providers.base.client import BaseAdsProvider


class CapabilityRegistry:
    def __init__(
        self,
        providers: dict[ProviderName, BaseAdsProvider],
        refresh: Callable[[], None] | None = None,
    ) -> None:
        self.providers = providers
        self._refresh = refresh

    def refresh(self) -> None:
        if self._refresh:
            self._refresh()

    def list_providers(self) -> list[ProviderName]:
        self.refresh()
        return sorted(self.providers.keys())

    def get_provider(self, provider: ProviderName) -> BaseAdsProvider:
        self.refresh()
        try:
            return self.providers[provider]
        except KeyError as exc:
            raise ProviderNotFoundError(f"Unknown provider: {provider}") from exc

    def get_capabilities(self, provider: ProviderName) -> CapabilityMap:
        return self.get_provider(provider).capabilities

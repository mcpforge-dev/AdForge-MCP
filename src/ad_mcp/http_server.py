from __future__ import annotations

from starlette.applications import Starlette

from ad_mcp.server import create_server
from ad_mcp.settings import Settings


def create_http_app(settings: Settings | None = None) -> Starlette:
    return create_server(settings, hosted_http=True).streamable_http_app()


def main() -> None:
    settings = Settings()
    mcp = create_server(settings, hosted_http=True)
    print(f"HolyMedia MCP HTTP transport running at http://{settings.mcp_http_host}:{settings.mcp_http_port}{settings.mcp_route_path}")
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()

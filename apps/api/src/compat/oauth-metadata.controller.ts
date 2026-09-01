import { Controller, Get } from "@nestjs/common";

@Controller()
export class OAuthMetadataController {
  @Get(".well-known/oauth-protected-resource")
  public protectedResource() {
    return {
      resource: "https://mcp.holymedia.kz/mcp",
      authorization_servers: ["https://mcp.holymedia.kz"],
      scopes_supported: ["adforge:mcp:read"],
      bearer_methods_supported: ["header"],
    };
  }

  @Get(".well-known/oauth-protected-resource/mcp")
  public protectedMcpResource() {
    return this.protectedResource();
  }

  @Get(".well-known/oauth-authorization-server")
  public authorizationServer() {
    return {
      issuer: "https://mcp.holymedia.kz",
      authorization_endpoint: "https://mcp.holymedia.kz/oauth/authorize",
      token_endpoint: "https://mcp.holymedia.kz/oauth/token",
      registration_endpoint: "https://mcp.holymedia.kz/oauth/register",
      revocation_endpoint: "https://mcp.holymedia.kz/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["adforge:mcp:read"],
      token_endpoint_auth_methods_supported: [
        "none",
        "client_secret_basic",
        "client_secret_post",
      ],
      client_id_metadata_document_supported: true,
    };
  }
}

import { Controller, Get } from "@nestjs/common";

@Controller()
export class OAuthMetadataController {
  @Get(".well-known/oauth-protected-resource")
  public protectedResource() {
    return {
      resource: "/mcp",
      authorization_servers: ["/"],
      scopes_supported: ["adforge:mcp:read"],
    };
  }

  @Get(".well-known/oauth-authorization-server")
  public authorizationServer() {
    return {
      issuer: "/",
      authorization_endpoint: "/oauth/authorize",
      token_endpoint: "/oauth/token",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["adforge:mcp:read"],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
      ],
    };
  }
}

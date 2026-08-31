import { describe, expect, it } from "vitest";
import {
  isClientMetadataUrl,
  parseClientMetadata,
  registrationMetadata,
} from "./oauth-client-metadata.service.js";

describe("OAuth client metadata documents", () => {
  const clientId = "https://client.example.test/.well-known/oauth-client.json";

  it("accepts an HTTPS CIMD public client with exact identity and PKCE-compatible metadata", () => {
    expect(
      parseClientMetadata(clientId, {
        client_id: clientId,
        client_name: "Anthropic Claude",
        redirect_uris: ["https://claude.example.test/oauth/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "web",
        scope: "adforge:mcp:read",
      }),
    ).toMatchObject({
      client_id: clientId,
      token_endpoint_auth_method: "none",
      application_type: "web",
    });
  });

  it("rejects mismatched identity, private client IDs, confidential metadata, and unsafe redirects", () => {
    expect(isClientMetadataUrl("https://client.example.test/")).toBe(false);
    expect(
      isClientMetadataUrl("http://client.example.test/metadata.json"),
    ).toBe(false);
    expect(() =>
      parseClientMetadata(clientId, {
        client_id: "https://other.example.test/metadata.json",
        client_name: "Claude",
        redirect_uris: ["https://claude.example.test/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    ).toThrow("OAuth client metadata is invalid.");
    expect(() =>
      parseClientMetadata(clientId, {
        client_id: clientId,
        client_name: "Claude",
        redirect_uris: ["http://169.254.169.254/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    ).toThrow("OAuth client metadata is invalid.");
  });

  it("supports RFC 7591 public desktop registrations with a loopback callback", () => {
    expect(
      registrationMetadata({
        client_name: "Claude Desktop",
        redirect_uris: ["http://127.0.0.1:45678/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "native",
      }),
    ).toMatchObject({
      application_type: "native",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
  });
});

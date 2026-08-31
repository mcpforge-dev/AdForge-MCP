import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../infrastructure/database.service.js";

const MAX_METADATA_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 4_000;
const MIN_CACHE_SECONDS = 300;
const MAX_CACHE_SECONDS = 86_400;

type ClientMetadata = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
  application_type: "web" | "native";
  scope: string;
};

@Injectable()
export class OAuthClientMetadataService {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  public async resolve(clientId: string) {
    if (!isClientMetadataUrl(clientId)) return null;
    const existing = await this.database.client.oAuthPublicClient.findFirst({
      where: { clientId, status: "active", revokedAt: null },
    });
    if (
      existing?.registrationSource === "cimd" &&
      existing.metadataExpiresAt &&
      existing.metadataExpiresAt > new Date()
    ) {
      return existing;
    }

    const fetched = await this.fetch(clientId, existing?.metadataEtag ?? null);
    if (fetched.notModified && existing) {
      return this.database.client.oAuthPublicClient.update({
        where: { id: existing.id },
        data: {
          metadataFetchedAt: new Date(),
          metadataExpiresAt: fetched.expiresAt,
        },
      });
    }
    const metadata = parseClientMetadata(clientId, fetched.body);
    return this.database.client.oAuthPublicClient.upsert({
      where: { clientId },
      create: {
        clientId,
        clientName: metadata.client_name,
        redirectUris: metadata.redirect_uris,
        scope: metadata.scope,
        tokenEndpointAuthMethod: metadata.token_endpoint_auth_method,
        applicationType: metadata.application_type,
        registrationSource: "cimd",
        metadataEtag: fetched.etag,
        metadataFetchedAt: new Date(),
        metadataExpiresAt: fetched.expiresAt,
      },
      update: {
        clientName: metadata.client_name,
        redirectUris: metadata.redirect_uris,
        scope: metadata.scope,
        tokenEndpointAuthMethod: metadata.token_endpoint_auth_method,
        applicationType: metadata.application_type,
        registrationSource: "cimd",
        metadataEtag: fetched.etag,
        metadataFetchedAt: new Date(),
        metadataExpiresAt: fetched.expiresAt,
        revokedAt: null,
        status: "active",
      },
    });
  }

  private async fetch(
    clientId: string,
    etag: string | null,
  ): Promise<{
    body: unknown;
    etag: string | null;
    expiresAt: Date;
    notModified: boolean;
  }> {
    const url = new URL(clientId);
    await assertPublicHostname(url.hostname);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(etag ? { "if-none-match": etag } : {}),
        },
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new BadRequestException("OAuth client metadata is unavailable.");
    }
    const expiresAt = metadataExpiry(response.headers.get("cache-control"));
    if (response.status === 304 && etag) {
      return { body: null, etag, expiresAt, notModified: true };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !response.ok ||
      !/application\/(?:[\w.-]+\+)?json\b/i.test(contentType)
    ) {
      throw new BadRequestException("OAuth client metadata is invalid.");
    }
    const body = await limitedJson(response);
    return {
      body,
      etag: response.headers.get("etag"),
      expiresAt,
      notModified: false,
    };
  }
}

export function isClientMetadataUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname !== "/" &&
      !url.pathname
        .split("/")
        .some((segment) => segment === "." || segment === "..") &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function parseClientMetadata(
  clientId: string,
  value: unknown,
): ClientMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("OAuth client metadata is invalid.");
  }
  const input = value as Record<string, unknown>;
  if (input.client_id !== clientId) {
    throw new BadRequestException("OAuth client metadata is invalid.");
  }
  const redirectUris = strings(input.redirect_uris);
  const grants = strings(input.grant_types);
  const responses = strings(input.response_types);
  const authentication = string(input.token_endpoint_auth_method) || "none";
  const applicationType =
    string(input.application_type) || inferApplicationType(redirectUris);
  if (
    !string(input.client_name) ||
    redirectUris.length === 0 ||
    redirectUris.length > 10 ||
    (grants.length > 0 && !grants.includes("authorization_code")) ||
    (responses.length > 0 && !responses.includes("code")) ||
    !responses.every((type) => type === "code") ||
    authentication !== "none" ||
    (applicationType !== "web" && applicationType !== "native") ||
    redirectUris.some((uri) => !validRedirectUri(uri, applicationType))
  ) {
    throw new BadRequestException("OAuth client metadata is invalid.");
  }
  return {
    client_id: clientId,
    client_name: string(input.client_name).slice(0, 160),
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: applicationType,
    scope: normalizeScope(string(input.scope)),
  };
}

export function registrationMetadata(
  input: Record<string, unknown>,
): Omit<ClientMetadata, "client_id"> {
  const redirectUris = strings(input.redirect_uris);
  const applicationType =
    string(input.application_type) || inferApplicationType(redirectUris);
  const grants = strings(input.grant_types);
  const responses = strings(input.response_types);
  const authentication = string(input.token_endpoint_auth_method) || "none";
  if (
    redirectUris.length === 0 ||
    redirectUris.length > 10 ||
    (grants.length > 0 && !grants.includes("authorization_code")) ||
    (responses.length > 0 && !responses.every((type) => type === "code")) ||
    authentication !== "none" ||
    (applicationType !== "web" && applicationType !== "native") ||
    redirectUris.some((uri) => !validRedirectUri(uri, applicationType))
  ) {
    throw new BadRequestException("OAuth client metadata is invalid.");
  }
  return {
    client_name: string(input.client_name).slice(0, 160) || "Public MCP client",
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: applicationType,
    scope: normalizeScope(string(input.scope)),
  };
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

function inferApplicationType(redirectUris: string[]): "web" | "native" {
  return redirectUris.some(isLoopbackRedirect) ? "native" : "web";
}

function validRedirectUri(value: string, applicationType: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return applicationType === "native" && isLoopbackRedirect(value);
  } catch {
    return false;
  }
}

function isLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      Boolean(url.port) &&
      ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function normalizeScope(value: string): string {
  if (!value || value === "adforge:mcp" || value === "adforge:mcp:read") {
    return "adforge:mcp:read";
  }
  throw new BadRequestException("Only read-only MCP scope is available.");
}

async function assertPublicHostname(hostname: string): Promise<void> {
  if (isIP(hostname) || hostname.toLowerCase() === "localhost") {
    throw new BadRequestException("OAuth client metadata is invalid.");
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BadRequestException("OAuth client metadata is unavailable.");
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIp(address))
  ) {
    throw new BadRequestException("OAuth client metadata is invalid.");
  }
}

function isPublicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = -1, b = -1] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }
  const normalized = address.toLowerCase();
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function metadataExpiry(cacheControl: string | null): Date {
  const maxAge = /max-age=(\d+)/i.exec(cacheControl ?? "")?.[1];
  const seconds = Math.max(
    MIN_CACHE_SECONDS,
    Math.min(MAX_CACHE_SECONDS, maxAge ? Number(maxAge) : MIN_CACHE_SECONDS),
  );
  return new Date(Date.now() + seconds * 1_000);
}

async function limitedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_METADATA_BYTES) {
    throw new BadRequestException("OAuth client metadata is invalid.");
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new BadRequestException("OAuth client metadata is invalid.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_METADATA_BYTES) {
      await reader.cancel();
      throw new BadRequestException("OAuth client metadata is invalid.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(new TextDecoder().decode(concat(chunks, total)));
  } catch {
    throw new BadRequestException("OAuth client metadata is invalid.");
  }
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const value = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    value.set(chunk, offset);
    offset += chunk.length;
  }
  return value;
}

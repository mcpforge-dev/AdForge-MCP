import { createHash, createHmac, randomBytes } from "node:crypto";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function digestToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function hashIp(
  value: string | undefined,
  secret: string,
): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(`${secret}:${value}`).digest("hex");
}

export function safeUserAgent(value: string | undefined): string | undefined {
  return value?.slice(0, 512);
}

export function createSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return normalized || `workspace-${randomBytes(5).toString("hex")}`;
}

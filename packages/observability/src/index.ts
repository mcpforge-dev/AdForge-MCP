import { trace } from "@opentelemetry/api";
import { randomUUID } from "node:crypto";
import pino, { type Logger } from "pino";

export type { Logger };

export function createLogger(service: string, level: string = "info"): Logger {
  return pino({
    level,
    base: { service },
    redact: {
      paths: [
        "req.headers.authorization",
        "headers.authorization",
        "accessToken",
        "refreshToken",
        "clientSecret",
        "password",
        "token",
      ],
      censor: "[REDACTED]",
    },
  });
}

export function requestId(value?: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length <= 128 ? normalized : randomUUID();
}

export function tracer(service: string) {
  return trace.getTracer(service);
}

import { z } from "zod";

const environmentSchema = z.enum([
  "development",
  "test",
  "staging",
  "production",
]);

const booleanFromEnv = z.preprocess(
  (value) =>
    typeof value === "string" ? value.trim().toLowerCase() === "true" : value,
  z.boolean(),
);

const rawConfigSchema = z.object({
  NODE_ENV: environmentSchema.default("development"),
  V2_CONFIG_STRICT: booleanFromEnv.default(false),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://holymedia:change-me@localhost:5433/holymedia_v2"),
  REDIS_URL: z.string().url().default("redis://localhost:6380"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  SESSION_HASH_SECRET: z.string().default("dev-session-hash-secret-change-me"),
  PROVIDER_CREDENTIAL_ENCRYPTION_KEYS: z.string().optional(),
  PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION: z.coerce
    .number()
    .int()
    .min(1)
    .default(1),
  PROVIDER_GOOGLE_CLIENT_ID: z.string().optional(),
  PROVIDER_GOOGLE_CLIENT_SECRET: z.string().optional(),
  PROVIDER_GOOGLE_REDIRECT_URI: z.string().url().optional(),
  PROVIDER_META_CLIENT_ID: z.string().optional(),
  PROVIDER_META_CLIENT_SECRET: z.string().optional(),
  PROVIDER_META_REDIRECT_URI: z.string().url().optional(),
  COOKIE_DOMAIN: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  EMAIL_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  ARGON2_MEMORY_KIB: z.coerce
    .number()
    .int()
    .min(8192)
    .max(262144)
    .default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).max(10).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(4).default(1),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

export type AppConfig = {
  environment: AppEnvironment;
  configStrict: boolean;
  apiPort: number;
  webPort: number;
  databaseUrl: string;
  redisUrl: string;
  corsOrigins: string[];
  sessionHashSecret: string;
  providerCredentialEncryptionKeys: string | undefined;
  providerCredentialCurrentKeyVersion: number;
  providerGoogleClientId: string | undefined;
  providerGoogleClientSecret: string | undefined;
  providerGoogleRedirectUri: string | undefined;
  providerMetaClientId: string | undefined;
  providerMetaClientSecret: string | undefined;
  providerMetaRedirectUri: string | undefined;
  cookieDomain: string | undefined;
  sessionTtlDays: number;
  emailTokenTtlMinutes: number;
  argon2MemoryKib: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
  logLevel: z.infer<typeof rawConfigSchema.shape.LOG_LEVEL>;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawConfigSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid v2 configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }

  const value = parsed.data;
  const configStrict =
    value.V2_CONFIG_STRICT || value.NODE_ENV === "production";
  if (
    configStrict &&
    (value.DATABASE_URL.includes("change-me") ||
      value.REDIS_URL.includes("localhost") ||
      value.SESSION_HASH_SECRET.includes("change-me") ||
      value.SESSION_HASH_SECRET.length < 32 ||
      !value.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS)
  ) {
    throw new Error(
      "Production-like v2 configuration requires explicit database, Redis, session and provider credential settings.",
    );
  }

  const corsOrigins = value.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.length === 0) {
    throw new Error("CORS_ORIGINS must contain at least one origin.");
  }

  return {
    environment: value.NODE_ENV,
    configStrict,
    apiPort: value.API_PORT,
    webPort: value.WEB_PORT,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
    corsOrigins,
    sessionHashSecret: value.SESSION_HASH_SECRET,
    providerCredentialEncryptionKeys: value.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS,
    providerCredentialCurrentKeyVersion:
      value.PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION,
    providerGoogleClientId: value.PROVIDER_GOOGLE_CLIENT_ID,
    providerGoogleClientSecret: value.PROVIDER_GOOGLE_CLIENT_SECRET,
    providerGoogleRedirectUri: value.PROVIDER_GOOGLE_REDIRECT_URI,
    providerMetaClientId: value.PROVIDER_META_CLIENT_ID,
    providerMetaClientSecret: value.PROVIDER_META_CLIENT_SECRET,
    providerMetaRedirectUri: value.PROVIDER_META_REDIRECT_URI,
    cookieDomain: value.COOKIE_DOMAIN,
    sessionTtlDays: value.SESSION_TTL_DAYS,
    emailTokenTtlMinutes: value.EMAIL_TOKEN_TTL_MINUTES,
    argon2MemoryKib: value.ARGON2_MEMORY_KIB,
    argon2TimeCost: value.ARGON2_TIME_COST,
    argon2Parallelism: value.ARGON2_PARALLELISM,
    logLevel: value.LOG_LEVEL,
  };
}

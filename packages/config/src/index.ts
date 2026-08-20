import { z } from "zod";

const environmentSchema = z.enum([
  "development",
  "test",
  "staging",
  "production",
]);

const rawConfigSchema = z.object({
  NODE_ENV: environmentSchema.default("development"),
  V2_CONFIG_STRICT: z.coerce.boolean().default(false),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://holymedia:change-me@localhost:5433/holymedia_v2"),
  REDIS_URL: z.string().url().default("redis://localhost:6380"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
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
      value.REDIS_URL.includes("localhost"))
  ) {
    throw new Error(
      "Production-like v2 configuration requires explicit DATABASE_URL and REDIS_URL.",
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
    logLevel: value.LOG_LEVEL,
  };
}

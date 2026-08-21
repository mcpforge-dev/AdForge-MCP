import { createLogger } from "@holymedia/observability";
import {
  HermesGateway,
  loadHermesConfig,
  McpHttpClient,
  OpenAiTextEnhancer,
  TelegramClient,
  validateHermesConfig,
} from "./hermes.js";

export const hermesFoundationStatus = {
  sourceStatus: "unavailable",
  migrationStrategy: "clean-v2-reimplementation",
  implementationPhase: "phase-a",
  readOnlyByDefault: true,
} as const;

const logger = createLogger("holymedia-mcp-v2-hermes");
const config = loadHermesConfig();

const configError = validateHermesConfig(config);
if (configError) {
  logger.error(
    { ...hermesFoundationStatus, errorType: "invalid_configuration" },
    configError,
  );
  process.exitCode = 1;
} else if (!config.enabled) {
  logger.info(hermesFoundationStatus, "Hermes is disabled by configuration.");
} else if (!config.botToken || !config.mcpToken) {
  logger.error(
    hermesFoundationStatus,
    "Hermes requires Telegram and scoped MCP credentials.",
  );
  process.exitCode = 1;
} else {
  const gateway = new HermesGateway(
    config,
    new TelegramClient(config.botToken),
    new McpHttpClient(config.mcpUrl, config.mcpToken),
    config.openAiApiKey
      ? new OpenAiTextEnhancer(config.openAiApiKey, config.openAiModel)
      : undefined,
  );
  const stop = () => gateway.stop();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  void gateway.run().catch(() => {
    logger.error(
      hermesFoundationStatus,
      "Hermes gateway stopped after an unexpected provider error.",
    );
    process.exitCode = 1;
  });
}

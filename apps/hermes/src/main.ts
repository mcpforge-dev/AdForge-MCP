import { createLogger } from "@holymedia/observability";
import {
  HermesGateway,
  loadHermesConfig,
  McpHttpClient,
  TelegramClient,
} from "./hermes.js";

export const hermesFoundationStatus = {
  sourceStatus: "unavailable",
  migrationStrategy: "clean-v2-reimplementation",
  implementationPhase: "phase-a",
  readOnlyByDefault: true,
} as const;

const logger = createLogger("holymedia-mcp-v2-hermes");
const config = loadHermesConfig();

if (!config.enabled) {
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

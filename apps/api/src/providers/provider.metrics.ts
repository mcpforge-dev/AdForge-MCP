import { Injectable } from "@nestjs/common";
import { createLogger } from "@holymedia/observability";
import type { ProviderId } from "@holymedia/contracts";

type ProviderMetric =
  | "oauth_success"
  | "oauth_failure"
  | "token_refresh_success"
  | "token_refresh_failure"
  | "account_discovery_success"
  | "account_discovery_failure";

@Injectable()
export class ProviderMetricsService {
  private readonly logger = createLogger("holymedia-mcp-v2-provider-metrics");

  public record(
    metric: ProviderMetric,
    provider: ProviderId,
    durationMs?: number,
  ): void {
    this.logger.info(
      {
        metric,
        provider,
        ...(durationMs === undefined ? {} : { durationMs }),
      },
      "provider metric",
    );
  }
}

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { ProviderId, ProviderMetricSummary } from "@holymedia/contracts";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { ProviderService } from "../providers/provider.service.js";
import { WorkspaceService } from "../workspaces/workspace.service.js";

type SkillQuery = {
  account_id?: string;
  provider?: string;
  end_date?: string;
  lookback_days?: string;
  min_spend?: string;
  max_cost_per_result?: string;
  min_conversions?: string;
  limit?: string;
};

const providerAliases: Record<string, ProviderId> = {
  google_ads: "GOOGLE_ADS",
  meta_ads: "META_ADS",
  google: "GOOGLE_ADS",
  meta: "META_ADS",
};

@Controller("api/meta/skills")
@UseGuards(AuthenticationGuard)
export class LegacyMetaSkillsController {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProviderService) private readonly providers: ProviderService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  @Get("catalog")
  public async catalog(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query() query: SkillQuery,
  ) {
    const account = await this.account(principal, query);
    const endDate = this.endDate(query.end_date);
    const provider = String(account.provider).toLowerCase();
    return {
      account_id: account.externalAccountId,
      provider,
      end_date: endDate,
      skills: [
        {
          id: "collect_report",
          title: "Собери отчёт",
          mcp_tool: "collect_report_skill",
          web_path: "/api/meta/skills/collect-report",
        },
        {
          id: "budget_summary",
          title: "Сколько потратили",
          mcp_tool: "summarize_budget_skill",
          web_path: "/api/meta/skills/budget-summary",
        },
        {
          id: "disable_candidates",
          title: "Что проверить на отключение",
          mcp_tool: "disable_candidates_skill",
          web_path: "/api/meta/skills/disable-candidates",
        },
        {
          id: "scale_candidates",
          title: "Что проверить для масштабирования",
          mcp_tool: "scale_candidates_skill",
          web_path: "/api/meta/skills/scale-candidates",
        },
      ],
      source_api: "v2_provider_framework",
      real_data: true,
      data_status: "live",
      fetched_at: new Date().toISOString(),
    };
  }

  @Get("budget-summary")
  public async budgetSummary(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query() query: SkillQuery,
  ) {
    const account = await this.account(principal, query);
    const end = this.endDate(query.end_date);
    const periods = [
      { key: "today", startDate: end, endDate: end },
      { key: "last_7_days", ...this.range(end, 7) },
      { key: "last_30_days", ...this.range(end, 30) },
    ];
    const results = await Promise.all(
      periods.map(async (period) => ({
        period: period.key,
        start_date: period.startDate,
        end_date: period.endDate,
        metrics: await this.providers.readMetrics(
          account.workspaceId,
          account.connectionId,
          account.id,
          { startDate: period.startDate, endDate: period.endDate },
        ),
      })),
    );
    return this.livePayload(account, {
      skill: "summarize_budget",
      periods: results,
    });
  }

  @Get("disable-candidates")
  public async disableCandidates(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query() query: SkillQuery,
  ) {
    const account = await this.account(principal, query);
    const end = this.endDate(query.end_date);
    const days = this.number(query.lookback_days, 7, 1, 90);
    const minSpend = this.number(query.min_spend, 20, 0, 1_000_000);
    const campaigns = await this.providers.readCampaigns(
      account.workspaceId,
      account.connectionId,
      account.id,
      this.range(end, days),
      this.number(query.limit, 10, 1, 100),
    );
    const items = campaigns.items
      .filter((campaign) => this.money(campaign.metrics?.spend) >= minSpend)
      .filter((campaign) => (campaign.metrics?.conversions ?? 0) === 0)
      .map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        spend: campaign.metrics?.spend ?? null,
        conversions: campaign.metrics?.conversions ?? null,
        reason: "Есть расход, но нет зарегистрированных конверсий за период.",
        provenance: campaign.provenance,
      }));
    return this.livePayload(account, {
      skill: "disable_candidates",
      period: this.range(end, days),
      items,
      data_status: campaigns.items.length ? "live" : "empty",
    });
  }

  @Get("scale-candidates")
  public async scaleCandidates(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query() query: SkillQuery,
  ) {
    const account = await this.account(principal, query);
    const end = this.endDate(query.end_date);
    const days = this.number(query.lookback_days, 7, 1, 90);
    const maxCost = this.number(query.max_cost_per_result, 20, 0, 1_000_000);
    const minConversions = this.number(query.min_conversions, 1, 0, 1_000_000);
    const campaigns = await this.providers.readCampaigns(
      account.workspaceId,
      account.connectionId,
      account.id,
      this.range(end, days),
      this.number(query.limit, 10, 1, 100),
    );
    const items = campaigns.items
      .filter(
        (campaign) => (campaign.metrics?.conversions ?? 0) >= minConversions,
      )
      .filter((campaign) => {
        const cost = this.money(campaign.metrics?.costPerConversion);
        return cost > 0 && cost <= maxCost;
      })
      .sort(
        (left, right) =>
          (right.metrics?.conversions ?? 0) - (left.metrics?.conversions ?? 0),
      )
      .map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        conversions: campaign.metrics?.conversions ?? null,
        cost_per_conversion: campaign.metrics?.costPerConversion ?? null,
        reason:
          "Есть конверсии и стоимость конверсии не выше заданного порога.",
        provenance: campaign.provenance,
      }));
    return this.livePayload(account, {
      skill: "scale_candidates",
      period: this.range(end, days),
      items,
      data_status: campaigns.items.length ? "live" : "empty",
    });
  }

  private async account(principal: HumanPrincipal, query: SkillQuery) {
    const workspace = (await this.workspaces.listForUser(principal))[0];
    if (!workspace)
      throw new BadRequestException("Workspace is not available.");
    const provider = query.provider
      ? providerAliases[query.provider.toLowerCase()]
      : undefined;
    if (query.provider && !provider)
      throw new BadRequestException("Unsupported provider.");
    const requested = query.account_id?.trim();
    const account = await this.database.client.providerAccount.findFirst({
      where: {
        workspaceId: workspace.id,
        enabled: true,
        ...(provider ? { provider } : {}),
        ...(requested
          ? { OR: [{ id: requested }, { externalAccountId: requested }] }
          : {}),
        connection: { status: "CONNECTED" },
      },
    });
    if (!account) throw new BadRequestException("Рекламный кабинет не найден.");
    return account;
  }

  private livePayload(
    account: { provider: string; workspaceId: string },
    value: Record<string, unknown>,
  ) {
    return {
      ...value,
      provider: account.provider.toLowerCase(),
      source_api: "v2_provider_framework",
      real_data: true,
      data_status: value.data_status ?? "live",
      fetched_at: new Date().toISOString(),
    };
  }

  private endDate(value?: string) {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  }

  private range(endDate: string, days: number) {
    const end = new Date(`${endDate}T00:00:00Z`);
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    return { startDate: start.toISOString().slice(0, 10), endDate };
  }

  private number(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
  }

  private money(value: ProviderMetricSummary["spend"] | null | undefined) {
    const parsed = Number(value?.amount ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

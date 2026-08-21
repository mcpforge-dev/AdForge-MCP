import { IsIn, IsObject, IsOptional } from "class-validator";

export const CLIENT_PRODUCT_EVENTS = [
  "onboarding.started",
  "onboarding.step_completed",
  "provider.connect_clicked",
  "provider.account_selected",
  "mcp.setup_viewed",
  "report.downloaded",
  "plan.selected",
  "checkout.started",
] as const;

export class RecordProductEventDto {
  @IsIn(CLIENT_PRODUCT_EVENTS)
  public event_name!: (typeof CLIENT_PRODUCT_EVENTS)[number];

  @IsOptional()
  @IsObject()
  public properties?: Record<string, unknown>;
}

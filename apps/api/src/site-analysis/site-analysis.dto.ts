import { IsUrl } from "class-validator";

export class SiteAnalysisDto {
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  public url!: string;
}

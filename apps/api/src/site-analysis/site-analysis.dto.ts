import { IsIn, IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

export class SiteAnalysisDto {
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  public url!: string;

  @IsOptional()
  @IsIn(["quick", "full"])
  public mode?: "quick" | "full";

  @IsOptional()
  @IsString()
  @MaxLength(80)
  public siteType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  public goal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  public audience?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  public region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  public competitor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  public concern?: string;
}

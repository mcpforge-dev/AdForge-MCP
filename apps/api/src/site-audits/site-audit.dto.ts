import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from "class-validator";

export class CreateSiteAuditDto {
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  public url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  public companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  public industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  public targetAudience?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  public primaryGoal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  public mainProblem?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  public primaryAction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  public market?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsUrl(
    { protocols: ["http", "https"], require_protocol: true },
    { each: true },
  )
  public competitors?: string[];
}

export class SiteAuditArtifactDto {
  @IsIn(["desktop", "mobile", "annotated"])
  public kind!: "desktop" | "mobile" | "annotated";
}

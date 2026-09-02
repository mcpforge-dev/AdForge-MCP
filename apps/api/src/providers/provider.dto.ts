import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class AccountSelectionDto {
  @IsBoolean()
  public enabled!: boolean;
}

export class AccountSelectionBatchDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  // Migrated provider-account IDs can be UUIDv5; accept any RFC UUID version.
  @IsUUID(undefined, { each: true })
  public accountIds!: string[];
}

export class OAuthCallbackDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  public state!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  public code!: string;
}

export class ProviderDateRangeDto {
  @IsDateString()
  public startDate!: string;

  @IsDateString()
  public endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  public campaignId?: string;

  @IsOptional()
  @Min(1)
  @Max(500)
  public limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  public cursor?: string;
}

import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateManualMetaConnectionRequestDto {
  @IsOptional()
  @IsUUID()
  public workspace_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  public company_name?: string;

  @IsOptional()
  @Matches(/^\d{1,32}$/)
  public business_id?: string;

  @Matches(/^(?:act_)?\d{1,32}$/)
  public ad_account_id!: string;

  @IsOptional()
  @Matches(/^\d{1,32}$/)
  public page_id?: string;

  @IsOptional()
  @Matches(/^@?[a-z0-9._]{1,80}$/i)
  public instagram_username?: string;

  @IsOptional()
  @IsIn(["email", "telegram", "whatsapp"])
  public contact_preference?: "email" | "telegram" | "whatsapp";

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  public client_note?: string;
}

export class UpdateManualConnectionRequestDto {
  @IsIn([
    "new",
    "in_progress",
    "waiting_for_client",
    "ready_for_connection",
    "completed",
    "cancelled",
  ])
  public status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  public specialist_note?: string;
}

export class UpdateManualConnectionRequestRequestDto extends UpdateManualConnectionRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  public request_id!: string;
}

export class ManualConnectionRequestIdDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  public request_id!: string;
}

export class SelectManualConnectionAccountDto extends ManualConnectionRequestIdDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  public pending_id!: string;
}

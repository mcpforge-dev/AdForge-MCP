import {
  IsIn,
  IsInt,
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export class AdminLoginDto {
  @IsString()
  @MaxLength(80)
  public login!: string;

  @IsString()
  @MaxLength(256)
  public password!: string;
}

export class AdminCompanyQueryDto {
  @IsOptional()
  @IsIn(["PENDING", "ACTIVE", "SUSPENDED"])
  public status?: "PENDING" | "ACTIVE" | "SUSPENDED";

  @IsOptional()
  @IsString()
  @MaxLength(160)
  public q?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  public page?: number;
}

export class AdminAccessStatusDto {
  @IsIn(["PENDING", "ACTIVE", "SUSPENDED"])
  public status!: "PENDING" | "ACTIVE" | "SUSPENDED";
}

export class AdminUserStatusDto {
  @IsIn(["active", "disabled"])
  public status!: "active" | "disabled";
}

export class AdminPlanDto {
  @IsString()
  @MaxLength(80)
  public planKey!: string;

  @IsOptional()
  @IsIn(["TRIAL", "ACTIVE"])
  public mode?: "TRIAL" | "ACTIVE";
}

export class AdminTrialExtensionDto {
  @IsInt()
  @Min(1)
  public days!: number;
}

export class AdminEntitlementDto {
  @IsString()
  @MaxLength(120)
  public featureKey!: string;

  @IsDefined()
  public value!: boolean | number | string;
}

export class AdminInvitationActionDto {
  @IsIn(["resend", "cancel"])
  public action!: "resend" | "cancel";
}

export class AdminSupportStatusDto {
  @IsIn([
    "NEW",
    "IN_PROGRESS",
    "WAITING_FOR_CLIENT",
    "READY_FOR_CONNECTION",
    "COMPLETED",
    "CANCELED",
  ])
  public status!:
    | "NEW"
    | "IN_PROGRESS"
    | "WAITING_FOR_CLIENT"
    | "READY_FOR_CONNECTION"
    | "COMPLETED"
    | "CANCELED";

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  public note?: string;
}

export class AdminTariffRequestStatusDto {
  @IsIn(["PENDING", "IN_REVIEW", "APPROVED", "DECLINED", "CANCELED"])
  public status!:
    "PENDING" | "IN_REVIEW" | "APPROVED" | "DECLINED" | "CANCELED";
}

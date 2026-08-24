import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class SignupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  public name!: string;

  @IsEmail()
  @MaxLength(320)
  public email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  public password!: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(320)
  public email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public password!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(320)
  public email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  public token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  public password!: string;
}

export class VerifyEmailDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  public token!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public currentPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  public newPassword!: string;
}

export class UpdateProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  public name!: string;
}

export class UpdateAvatarDto {
  @IsString()
  @MaxLength(2_900_000)
  public dataUrl!: string;
}

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  public name!: string;
}

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  public name?: string;
}

export class UpdateMemberRoleDto {
  @IsString()
  public role!: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
}

export class CreateInvitationDto {
  @IsEmail()
  @MaxLength(320)
  public email!: string;

  @IsOptional()
  @IsString()
  public role?: "ADMIN" | "MEMBER" | "VIEWER";
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  public token!: string;
}

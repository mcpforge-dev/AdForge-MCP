import { IsBoolean, IsString, MaxLength, MinLength } from "class-validator";

export class AccountSelectionDto {
  @IsBoolean()
  public enabled!: boolean;
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

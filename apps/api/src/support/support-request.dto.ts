import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateSupportRequestDto {
  @IsIn(["SUGGESTION", "PROBLEM", "QUESTION"])
  public category!: "SUGGESTION" | "PROBLEM" | "QUESTION";

  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  public message!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\/[A-Za-z0-9_./?=&-]{0,255}$/)
  public sourceRoute?: string;

  @IsOptional()
  @IsIn(["ru", "en"])
  public locale?: "ru" | "en";

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{16,80}$/)
  public idempotencyKey?: string;
}

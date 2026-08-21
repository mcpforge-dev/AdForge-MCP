import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class SearchConsoleQueryDto {
  @IsOptional()
  @IsString()
  public site_url?: string;

  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(90)
  @Transform(({ value }) => Number(value))
  public days = 28;
}

import { IsDateString, IsString, MaxLength, MinLength } from "class-validator";

export class PerformanceReportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  public accountId!: string;

  @IsDateString()
  public startDate!: string;

  @IsDateString()
  public endDate!: string;
}

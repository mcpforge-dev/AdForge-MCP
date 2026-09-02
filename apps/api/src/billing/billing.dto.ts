import { IsString, MaxLength } from "class-validator";

export class CreateTariffRequestDto {
  @IsString()
  @MaxLength(80)
  public planKey!: string;
}

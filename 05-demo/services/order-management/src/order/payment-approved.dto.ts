import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class PaymentApprovedItemDto {
  @IsString()
  @Length(1, 80)
  item_id!: string;

  @IsString()
  @Length(1, 120)
  seller_sku!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @Min(0.01)
  unit_price!: number;
}

export class PaymentApprovedDto {
  @IsString()
  @Length(1, 80)
  payment_id!: string;

  @IsString()
  @Length(1, 80)
  cart_id!: string;

  @IsString()
  @Length(1, 80)
  buyer_id!: string;

  @IsString()
  @Length(1, 80)
  seller_id!: string;

  @IsString()
  @Length(2, 8)
  site_id!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsNumber()
  @Min(0.01)
  gross_amount!: number;

  @IsString()
  @IsOptional()
  payment_approved_at?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentApprovedItemDto)
  items!: PaymentApprovedItemDto[];
}

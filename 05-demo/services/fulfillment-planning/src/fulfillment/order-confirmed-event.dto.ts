import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  Equals,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderConfirmedItemDto {
  @IsString()
  @IsNotEmpty()
  item_id!: string;

  @IsString()
  @IsNotEmpty()
  seller_sku!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unit_price!: number;
}

export class OrderConfirmedPayloadDto {
  @IsString()
  @IsNotEmpty()
  order_id!: string;

  @IsString()
  @IsNotEmpty()
  payment_id!: string;

  @IsString()
  @IsOptional()
  payment_approved_at?: string;

  @IsString()
  @IsNotEmpty()
  buyer_id!: string;

  @IsString()
  @IsNotEmpty()
  seller_id!: string;

  @IsString()
  @IsNotEmpty()
  site_id!: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsNumber()
  @Min(0)
  gross_amount!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderConfirmedItemDto)
  items!: OrderConfirmedItemDto[];

  @IsString()
  @IsNotEmpty()
  confirmed_at!: string;
}

export class OrderConfirmedEventDto {
  @IsString()
  @IsNotEmpty()
  event_id!: string;

  @Equals('orders.order_confirmed.v1')
  event_name!: 'orders.order_confirmed.v1';

  @IsString()
  @IsNotEmpty()
  event_version!: string;

  @IsString()
  @IsNotEmpty()
  occurred_at!: string;

  @IsString()
  @IsNotEmpty()
  producer!: string;

  @IsString()
  @IsNotEmpty()
  correlation_id!: string;

  @IsString()
  @IsNotEmpty()
  causation_id!: string;

  @IsString()
  @IsNotEmpty()
  idempotency_key!: string;

  @ValidateNested()
  @Type(() => OrderConfirmedPayloadDto)
  payload!: OrderConfirmedPayloadDto;
}

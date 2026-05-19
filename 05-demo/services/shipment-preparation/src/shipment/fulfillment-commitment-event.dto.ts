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

export class ReservedItemDto {
  @IsString()
  @IsNotEmpty()
  seller_sku!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  reservation_id!: string;
}

export class FulfillmentCommitmentPayloadDto {
  @IsString()
  @IsNotEmpty()
  order_id!: string;

  @IsString()
  @IsOptional()
  payment_id?: string;

  @IsString()
  @IsOptional()
  buyer_id?: string;

  @IsString()
  @IsOptional()
  payment_approved_at?: string;

  @IsString()
  @IsNotEmpty()
  fulfillment_commitment_id!: string;

  @IsString()
  @IsNotEmpty()
  seller_id!: string;

  @IsString()
  @IsNotEmpty()
  fulfillment_model!: string;

  @IsString()
  @IsNotEmpty()
  origin_type!: string;

  @IsString()
  @IsOptional()
  estimated_delivery_date?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReservedItemDto)
  reserved_items!: ReservedItemDto[];

  @IsString()
  @IsOptional()
  committed_at?: string;
}

export class FulfillmentCommitmentEventDto {
  @IsString()
  @IsNotEmpty()
  event_id!: string;

  @Equals('fulfillment.commitment_confirmed.v1')
  event_name!: 'fulfillment.commitment_confirmed.v1';

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
  @Type(() => FulfillmentCommitmentPayloadDto)
  payload!: FulfillmentCommitmentPayloadDto;
}

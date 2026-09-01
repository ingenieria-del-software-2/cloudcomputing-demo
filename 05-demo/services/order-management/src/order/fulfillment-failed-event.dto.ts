import {
  Equals,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

export class FulfillmentFailedPayloadDto {
  @IsString()
  @IsNotEmpty()
  order_id!: string;

  @IsString()
  @IsOptional()
  payment_approved_at?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class FulfillmentFailedEventDto {
  @IsString()
  @IsNotEmpty()
  event_id!: string;

  @Equals('fulfillment.commitment_failed.v1')
  event_name!: 'fulfillment.commitment_failed.v1';

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

  @IsObject()
  @HasPayloadOrderId({ message: 'payload.order_id must be a non-empty string' })
  payload!: FulfillmentFailedPayloadDto & Record<string, unknown>;
}

function HasPayloadOrderId(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'hasPayloadOrderId',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'object' || value === null) {
            return false;
          }

          const orderId = (value as Record<string, unknown>).order_id;
          return typeof orderId === 'string' && orderId.length > 0;
        },
      },
    });
  };
}

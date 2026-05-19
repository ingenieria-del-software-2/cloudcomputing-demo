import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

export const TRACKING_EVENT_NAMES = [
  'orders.order_confirmed.v1',
  'fulfillment.commitment_confirmed.v1',
  'fulfillment.commitment_failed.v1',
  'fulfillment.commitment_at_risk.v1',
  'shipping.shipment_ready_to_dispatch.v1',
  'shipping.dispatch_blocked.v1',
] as const;

export type TrackingEventName = (typeof TRACKING_EVENT_NAMES)[number];

export class TrackingEventPayloadDto {
  @IsString()
  @IsNotEmpty()
  order_id!: string;
}

export class TrackingEventDto {
  @IsString()
  @IsNotEmpty()
  event_id!: string;

  @IsIn(TRACKING_EVENT_NAMES)
  event_name!: TrackingEventName;

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
  payload!: TrackingEventPayloadDto & Record<string, unknown>;
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

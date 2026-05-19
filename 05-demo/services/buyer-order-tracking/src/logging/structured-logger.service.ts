import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

type LogLevel = 'info' | 'error';

export interface LogFields {
  request_id?: string;
  event_id?: string;
  event_name?: string;
  correlation_id?: string;
  causation_id?: string;
  idempotency_key?: string;
  order_id?: string;
  buyer_id?: string;
  payment_id?: string;
  fulfillment_commitment_id?: string;
  shipment_id?: string;
  queue?: string;
  table?: string;
  index?: string;
  duration_ms?: number;
  freshness_seconds?: number;
  status?: number;
  status_before?: string;
  status_after?: string;
  business_error_code?: string;
  result?: string;
  detail?: string;
  error_message?: string;
  dynamodb?: string;
  sqs?: string;
}

@Injectable()
export class StructuredLoggerService {
  constructor(
    private readonly config: ConfigService,
    @InjectPinoLogger(StructuredLoggerService.name)
    private readonly logger: PinoLogger,
  ) {}

  info(event: string, fields: LogFields): void {
    this.write('info', event, fields);
  }

  error(event: string, fields: LogFields): void {
    this.write('error', event, fields);
  }

  private write(level: LogLevel, event: string, fields: LogFields): void {
    const entry = {
      version: this.config.get<string>('SERVICE_VERSION', 'v1'),
      event,
      ...fields,
    };

    if (level === 'error') {
      this.logger.error(entry, event);
    } else {
      this.logger.info(entry, event);
    }
  }
}

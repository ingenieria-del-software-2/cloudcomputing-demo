import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

type LogLevel = 'info' | 'error';

export interface LogFields {
  request_id?: string;
  operation_id?: string;
  event_id?: string;
  event_name?: string;
  correlation_id?: string;
  order_id?: string;
  payment_id?: string;
  fulfillment_commitment_id?: string;
  shipment_id?: string;
  queue?: string;
  producer_version?: string;
  idempotency_key?: string;
  duration_ms?: number;
  error_type?: string;
  status?: number;
  status_before?: string;
  status_after?: string;
  business_error_code?: string;
  result?: string;
  feature_promesa_express?: boolean;
  detail?: string;
  error_message?: string;
  db?: string;
  sqs?: string;
  s3?: string;
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

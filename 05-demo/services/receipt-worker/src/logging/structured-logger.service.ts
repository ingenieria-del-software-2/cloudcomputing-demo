import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

type LogFields = Record<string, string | number | boolean | undefined>;

@Injectable()
export class StructuredLoggerService {
  constructor(private readonly logger: PinoLogger) {}

  info(message: string, fields: LogFields = {}): void {
    this.logger.info(fields, message);
  }

  warn(message: string, fields: LogFields = {}): void {
    this.logger.warn(fields, message);
  }

  error(message: string, fields: LogFields = {}): void {
    this.logger.error(fields, message);
  }
}

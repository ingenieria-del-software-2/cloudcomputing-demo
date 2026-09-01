import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { StructuredLoggerService } from './structured-logger.service';

describe('StructuredLoggerService', () => {
  it('writes info logs through Pino with base fields', () => {
    const { logger: pino, info } = pinoMock();
    const logger = new StructuredLoggerService(
      new ConfigService({
        SERVICE_VERSION: 'v1',
      }),
      pino,
    );

    logger.info('fulfillment_event_received', {
      request_id: 'req_001',
      operation_id: 'op_001',
    });

    expect(info).toHaveBeenCalledWith(
      {
        version: 'v1',
        event: 'fulfillment_event_received',
        request_id: 'req_001',
        operation_id: 'op_001',
      },
      'fulfillment_event_received',
    );
  });

  it('writes error logs through Pino', () => {
    const { logger: pino, info, error } = pinoMock();
    const logger = new StructuredLoggerService(new ConfigService(), pino);

    logger.error('fulfillment_failed', {
      request_id: 'req_001',
      error_type: 'receipt_queue_failed',
      status: 503,
    });

    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      {
        version: 'v1',
        event: 'fulfillment_failed',
        request_id: 'req_001',
        error_type: 'receipt_queue_failed',
        status: 503,
      },
      'fulfillment_failed',
    );
  });
});

function pinoMock(): {
  logger: PinoLogger;
  info: jest.Mock;
  error: jest.Mock;
} {
  const info = jest.fn();
  const error = jest.fn();

  return {
    logger: {
      info,
      error,
    } as unknown as PinoLogger,
    info,
    error,
  };
}

import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StructuredLoggerService } from '../../logging/structured-logger.service';
import { MetricsService } from '../../metrics/metrics.service';
import { TransactionError } from '../application/transaction.errors';
import { TransactionOutcomeFilter } from './transaction-outcome.filter';

describe('TransactionOutcomeFilter', () => {
  it('preserves ProblemResponse shape and records invalid outcomes', () => {
    const recordTransaction = jest.fn();
    const logError = jest.fn();
    const metrics = {
      recordTransaction,
    } as unknown as jest.Mocked<MetricsService>;
    const logger = {
      error: logError,
    } as unknown as jest.Mocked<StructuredLoggerService>;
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const filter = new TransactionOutcomeFilter(
      metrics,
      logger,
      new ConfigService({ SERVICE_VERSION: 'v1' }),
    );

    filter.catch(
      new BadRequestException({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'amount must be greater than 0',
      }),
      {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            path: '/transactions',
            header: (name: string) =>
              name === 'x-request-id' ? 'req_filter' : undefined,
          }),
          getResponse: () => response,
        }),
      } as unknown as ArgumentsHost,
    );

    expect(recordTransaction).toHaveBeenCalledWith('invalid', 'v1');
    expect(logError).toHaveBeenCalledWith(
      'transaction_invalid',
      expect.objectContaining({
        request_id: 'req_filter',
        status: 400,
        detail: 'amount must be greater than 0',
      }),
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'amount must be greater than 0',
      request_id: 'req_filter',
      operation_id: undefined,
    });
  });

  it('records injected failures for transaction requests', () => {
    const recordTransaction = jest.fn();
    const logError = jest.fn();
    const metrics = {
      recordTransaction,
    } as unknown as jest.Mocked<MetricsService>;
    const logger = {
      error: logError,
    } as unknown as jest.Mocked<StructuredLoggerService>;
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const filter = new TransactionOutcomeFilter(
      metrics,
      logger,
      new ConfigService({ SERVICE_VERSION: 'v2' }),
    );

    filter.catch(
      new HttpException(
        {
          status: 500,
          code: 'INJECTED_FAILURE',
          message: 'Service error automatically injected',
        },
        500,
      ),
      host(response),
    );

    expect(recordTransaction).toHaveBeenCalledWith('injected_failure', 'v2');
    expect(logError).toHaveBeenCalledWith(
      'transaction_failed',
      expect.objectContaining({
        request_id: 'req_filter',
        status: 500,
        error_type: 'injected_failure',
      }),
    );
  });

  it('maps application transaction errors to problem responses', () => {
    const recordTransaction = jest.fn();
    const logError = jest.fn();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const filter = new TransactionOutcomeFilter(
      { recordTransaction } as unknown as jest.Mocked<MetricsService>,
      { error: logError } as unknown as jest.Mocked<StructuredLoggerService>,
      new ConfigService({ SERVICE_VERSION: 'v1' }),
    );

    filter.catch(
      new TransactionError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Idempotency-Key already used with a different payload',
        'req_filter',
        'op_filter',
      ),
      host(response),
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Idempotency-Key already used with a different payload',
      request_id: 'req_filter',
      operation_id: 'op_filter',
    });
    expect(recordTransaction).toHaveBeenCalledWith(
      'idempotency_conflict',
      'v1',
    );
    expect(logError).toHaveBeenCalledWith(
      'idempotency_conflict',
      expect.objectContaining({
        request_id: 'req_filter',
        operation_id: 'op_filter',
        status: 409,
        detail: 'Idempotency-Key already used with a different payload',
      }),
    );
  });
});

function host(response: { status: jest.Mock; json: jest.Mock }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        path: '/transactions',
        header: (name: string) =>
          name === 'x-request-id' ? 'req_filter' : undefined,
      }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

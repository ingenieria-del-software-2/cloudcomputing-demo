import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { StructuredLoggerService } from '../../logging/structured-logger.service';
import { MetricsService } from '../../metrics/metrics.service';
import { TransactionError } from '../application/transaction.errors';

type ExceptionBody = {
  status?: number;
  statusCode?: number;
  code?: string;
  message?: string | string[];
  request_id?: string;
  operation_id?: string;
};

type ProblemResponse = {
  status: number;
  code: string;
  message: string;
  request_id?: string;
  operation_id?: string;
};

@Catch(HttpException, TransactionError)
export class TransactionOutcomeFilter implements ExceptionFilter<
  HttpException | TransactionError
> {
  private readonly version: string;

  constructor(
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
    config: ConfigService,
  ) {
    this.version = config.get<string>('SERVICE_VERSION', 'v1');
  }

  catch(
    exception: HttpException | TransactionError,
    host: ArgumentsHost,
  ): void {
    const httpHost = host.switchToHttp();
    const req = httpHost.getRequest<Request>();
    const res = httpHost.getResponse<Response>();

    const status =
      exception instanceof TransactionError
        ? exception.status
        : exception.getStatus();

    const problem = this.toProblem(exception, status);

    if (req.method === 'POST' && req.path === '/transactions') {
      problem.request_id ??= req.header('x-request-id');
      this.recordOutcome(problem, status);
    }

    res.status(status).json(problem);
  }

  private toProblem(
    exception: HttpException | TransactionError,
    status: number,
  ): ProblemResponse {
    if (exception instanceof TransactionError) {
      const {
        code,
        message,
        requestId: request_id,
        operationId: operation_id,
      } = exception;
      return { status, code, message, request_id, operation_id };
    }

    const response = exception.getResponse();
    if (typeof response === 'string') {
      return { status, code: 'HTTP_EXCEPTION', message: response };
    }

    const error = response as ExceptionBody;
    const msg = error.message;

    return {
      status: error.status ?? error.statusCode ?? status,
      code: error.code ?? 'HTTP_EXCEPTION',
      message: Array.isArray(msg) ? msg.join(', ') : (msg ?? exception.message),
      request_id: error.request_id,
      operation_id: error.operation_id,
    };
  }

  private recordOutcome(problem: ProblemResponse, status: number): void {
    const { code, request_id, operation_id, message } = problem;

    if (status === 400 && code === 'INVALID_REQUEST') {
      this.metrics.recordTransaction('invalid', this.version);
      this.logger.error('transaction_invalid', {
        request_id,
        status,
        detail: message,
      });
    } else if (status === 409 && code === 'IDEMPOTENCY_CONFLICT') {
      this.metrics.recordTransaction('idempotency_conflict', this.version);
      this.logger.error('idempotency_conflict', {
        request_id,
        operation_id,
        status,
        detail: message,
      });
    } else if (status >= 500 && code === 'INJECTED_FAILURE') {
      this.metrics.recordTransaction('injected_failure', this.version);
      this.logger.error('transaction_failed', {
        request_id,
        status,
        error_type: 'injected_failure',
      });
    }
  }
}

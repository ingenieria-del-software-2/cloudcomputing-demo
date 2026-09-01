import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Observable, catchError, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

interface RoutedRequest {
  method: string;
  path?: string;
  route?: {
    path?: string;
  };
}

interface HttpStatusError {
  getStatus: () => number;
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<RoutedRequest>();
    const response = http.getResponse<Response>();
    const route = request.route?.path;

    if (route === '/metrics') {
      return next.handle();
    }

    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      tap(() => {
        this.record(request, response, startedAt);
      }),
      catchError((error: unknown) => {
        this.record(request, response, startedAt, statusFromError(error));
        throw error;
      }),
    );
  }

  private record(
    request: RoutedRequest,
    response: Response,
    startedAt: bigint,
    status = response.statusCode,
  ): void {
    this.metrics.recordHttpRequest({
      route: normalizedRoute(request),
      method: request.method,
      status: String(status),
      version: this.config.get<string>('SERVICE_VERSION', 'v1'),
      durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1e9,
    });
  }
}

function normalizedRoute(request: RoutedRequest): string {
  return request.route?.path ?? 'unknown';
}

function statusFromError(error: unknown): number {
  if (isHttpStatusError(error)) {
    return error.getStatus();
  }

  return 500;
}

function isHttpStatusError(error: unknown): error is HttpStatusError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'getStatus' in error &&
    typeof (error as Partial<HttpStatusError>).getStatus === 'function'
  );
}

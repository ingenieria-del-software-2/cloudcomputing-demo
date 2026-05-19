import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

type HttpRequest = {
  method: string;
  route?: { path?: string };
  url: string;
};

type HttpResponse = {
  statusCode: number;
};

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const startedAt = process.hrtime.bigint();
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const response = context.switchToHttp().getResponse<HttpResponse>();

    return next.handle().pipe(
      tap({
        next: () => this.record(startedAt, request, response),
        error: () => this.record(startedAt, request, response),
      }),
    );
  }

  private record(
    startedAt: bigint,
    request: HttpRequest,
    response: HttpResponse,
  ): void {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

    this.metrics.recordHttpRequest({
      route: request.route?.path ?? routeName(request.url),
      method: request.method,
      status: String(response.statusCode),
      version: this.metrics.version(),
      durationSeconds,
    });
  }
}

function routeName(url: string): string {
  const path = url.split('?')[0];

  switch (path) {
    case '/healthz':
    case '/readyz':
    case '/version':
    case '/metrics':
      return path;
    default:
      return 'unknown';
  }
}

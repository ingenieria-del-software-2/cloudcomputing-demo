import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, mergeMap } from 'rxjs';
import { FaultInjector, InjectedFaultError } from './config-fault.injector';

const OPERATIONAL_PATHS = new Set([
  '/healthz',
  '/readyz',
  '/version',
  '/metrics',
]);

interface RoutedRequest {
  path?: string;
  route?: {
    path?: string;
  };
}

@Injectable()
export class FaultInjectionInterceptor implements NestInterceptor {
  constructor(
    @Inject(FaultInjector)
    private readonly faultInjector: FaultInjector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RoutedRequest>();

    if (isOperationalPath(request)) {
      return next.handle();
    }

    const startedAt = process.hrtime.bigint();

    try {
      await this.faultInjector.beforeRequest();
    } catch (error) {
      if (error instanceof InjectedFaultError) {
        throw new HttpException(
          {
            status: error.statusCode,
            code: 'INJECTED_FAILURE',
            message: error.message,
          },
          error.statusCode,
        );
      }

      throw error;
    }

    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        await this.faultInjector.afterSuccessfulRequest(
          Number(process.hrtime.bigint() - startedAt) / 1e6,
        );

        return value;
      }),
    );
  }
}

function isOperationalPath(request: RoutedRequest): boolean {
  return OPERATIONAL_PATHS.has(
    normalizedPath(request.route?.path ?? request.path),
  );
}

function normalizedPath(path: string | undefined): string {
  if (!path) {
    return '';
  }

  return path.startsWith('/') ? path : `/${path}`;
}

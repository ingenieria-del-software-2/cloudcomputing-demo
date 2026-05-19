import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom, Observable, of, throwError } from 'rxjs';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsService } from './metrics.service';

type TestResponse = { ok: boolean };

type MockCallHandler<T> = CallHandler<T> & {
  handle: jest.Mock<Observable<T>, []>;
};

describe('HttpMetricsInterceptor', () => {
  it('records HTTP requests by route template', async () => {
    const { metrics, recordHttpRequest } = metricsMock();
    const interceptor = new HttpMetricsInterceptor(
      metrics,
      new ConfigService({ SERVICE_VERSION: 'v1' }),
    );

    const result = interceptor.intercept(
      httpContext('/transactions', 202),
      nextHandler(),
    );

    await expect(lastValueFrom(result)).resolves.toEqual({ ok: true });
    expect(recordHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        route: '/transactions',
        method: 'POST',
        status: '202',
        version: 'v1',
      }),
    );
  });

  it('uses unknown instead of the raw request path when route metadata is missing', async () => {
    const { metrics, recordHttpRequest } = metricsMock();
    const interceptor = new HttpMetricsInterceptor(
      metrics,
      new ConfigService(),
    );

    await lastValueFrom(
      interceptor.intercept(httpContext(undefined, 200), nextHandler()),
    );

    expect(recordHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        route: 'unknown',
      }),
    );
  });

  it('does not inspect non HTTP contexts', async () => {
    const { metrics, recordHttpRequest } = metricsMock();
    const interceptor = new HttpMetricsInterceptor(
      metrics,
      new ConfigService(),
    );

    const result = interceptor.intercept(nonHttpContext(), nextHandler());

    await expect(lastValueFrom(result)).resolves.toEqual({ ok: true });
    expect(recordHttpRequest).not.toHaveBeenCalled();
  });

  it('records the status from thrown HTTP exceptions', async () => {
    const { metrics, recordHttpRequest } = metricsMock();
    const interceptor = new HttpMetricsInterceptor(
      metrics,
      new ConfigService(),
    );
    const error = {
      getStatus: () => 503,
    };

    const result = interceptor.intercept(
      httpContext('/transactions', 200),
      nextHandler(throwError(() => error)),
    );

    await expect(lastValueFrom(result)).rejects.toBe(error);
    expect(recordHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        status: '503',
      }),
    );
  });
});

function metricsMock(): {
  metrics: MetricsService;
  recordHttpRequest: jest.Mock;
} {
  const recordHttpRequest = jest.fn();

  return {
    metrics: {
      recordHttpRequest,
    } as unknown as MetricsService,
    recordHttpRequest,
  };
}

function nextHandler(
  result: Observable<TestResponse> = of({ ok: true }),
): MockCallHandler<TestResponse> {
  return {
    handle: jest.fn(() => result),
  };
}

function httpContext(
  routePath: string | undefined,
  statusCode: number,
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        route: routePath ? { path: routePath } : undefined,
      }),
      getResponse: () => ({
        statusCode,
      }),
    }),
  } as unknown as ExecutionContext;
}

function nonHttpContext(): ExecutionContext {
  return {
    getType: () => 'rpc',
  } as unknown as ExecutionContext;
}

import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { lastValueFrom, Observable, of } from 'rxjs';
import { FaultInjector, InjectedFaultError } from './config-fault.injector';
import { FaultInjectionInterceptor } from './fault-injection.interceptor';

type TestResponse = { ok: boolean };

type MockCallHandler<T> = CallHandler<T> & {
  result: Observable<T>;
  handle: jest.Mock<Observable<T>, []>;
};

describe('FaultInjectionInterceptor', () => {
  it('runs generic request faults before the route handler and timing after success', async () => {
    const faultInjector = faultInjectorMock();
    const next = nextHandler();
    const interceptor = new FaultInjectionInterceptor(faultInjector);

    const result = await interceptor.intercept(
      httpContext('/transactions'),
      next,
    );

    await expect(lastValueFrom(result)).resolves.toEqual({ ok: true });

    expect(faultInjector.beforeRequest.mock.calls).toHaveLength(1);
    expect(next.handle.mock.calls).toHaveLength(1);
    expect(faultInjector.afterSuccessfulRequest.mock.calls).toHaveLength(1);
  });

  it('maps injected faults to generic HTTP problem responses', async () => {
    const faultInjector = faultInjectorMock();
    faultInjector.beforeRequest.mockRejectedValueOnce(
      new InjectedFaultError(502),
    );
    const next = nextHandler();
    const interceptor = new FaultInjectionInterceptor(faultInjector);

    try {
      await interceptor.intercept(httpContext('/transactions'), next);
      throw new Error('Expected injected fault');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toEqual({
        status: 502,
        code: 'INJECTED_FAILURE',
        message: 'Service error automatically injected',
      });
    }

    expect(next.handle.mock.calls).toHaveLength(0);
    expect(faultInjector.afterSuccessfulRequest.mock.calls).toHaveLength(0);
  });

  it.each([
    ['Service delay automatically injected'],
    ['Service exceeded rate limit'],
  ])('keeps injected fault message "%s" in the response', async (message) => {
    const faultInjector = faultInjectorMock();
    faultInjector.beforeRequest.mockRejectedValueOnce(
      new InjectedFaultError(503, message),
    );
    const next = nextHandler();
    const interceptor = new FaultInjectionInterceptor(faultInjector);

    try {
      await interceptor.intercept(httpContext('/transactions'), next);
      throw new Error('Expected injected fault');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'INJECTED_FAILURE',
        message,
      });
    }
  });

  it('does not inject faults into operational endpoints', async () => {
    const faultInjector = faultInjectorMock();
    const next = nextHandler();
    const interceptor = new FaultInjectionInterceptor(faultInjector);

    const result = await interceptor.intercept(httpContext('/healthz'), next);

    await expect(lastValueFrom(result)).resolves.toEqual({ ok: true });

    expect(faultInjector.beforeRequest.mock.calls).toHaveLength(0);
    expect(faultInjector.afterSuccessfulRequest.mock.calls).toHaveLength(0);
    expect(next.handle.mock.calls).toHaveLength(1);
  });

  it('ignores non HTTP execution contexts', async () => {
    const faultInjector = faultInjectorMock();
    const next = nextHandler();
    const interceptor = new FaultInjectionInterceptor(faultInjector);

    const result = await interceptor.intercept(nonHttpContext(), next);

    await expect(lastValueFrom(result)).resolves.toEqual({ ok: true });

    expect(faultInjector.beforeRequest.mock.calls).toHaveLength(0);
    expect(faultInjector.afterSuccessfulRequest.mock.calls).toHaveLength(0);
    expect(next.handle.mock.calls).toHaveLength(1);
  });
});

function faultInjectorMock(): jest.Mocked<FaultInjector> {
  return {
    beforeRequest: jest.fn(() => Promise.resolve()),
    afterSuccessfulRequest: jest.fn<
      ReturnType<FaultInjector['afterSuccessfulRequest']>,
      Parameters<FaultInjector['afterSuccessfulRequest']>
    >(() => Promise.resolve()),
    beforeOperation: jest.fn(),
  };
}

function nextHandler(): MockCallHandler<TestResponse> {
  const result: Observable<TestResponse> = of({ ok: true });

  return {
    result,
    handle: jest.fn(() => result),
  };
}

function httpContext(path: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        path,
        route: { path },
      }),
    }),
  } as unknown as ExecutionContext;
}

function nonHttpContext(): ExecutionContext {
  return {
    getType: () => 'rpc',
  } as unknown as ExecutionContext;
}

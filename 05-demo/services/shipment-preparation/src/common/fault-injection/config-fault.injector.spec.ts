import { ConfigService } from '@nestjs/config';
import {
  ConfigFaultInjector,
  InjectedFaultError,
} from './config-fault.injector';

describe('ConfigFaultInjector', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('applies TIMING_50_PERCENTILE after successful requests', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const injector = new ConfigFaultInjector(
      new ConfigService({ TIMING_50_PERCENTILE: '20ms' }),
    );
    const startedAt = performance.now();

    await injector.afterSuccessfulRequest(0);

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(15);
  });

  it('uses TIMING_50_PERCENTILE as TIMING_90_PERCENTILE fallback', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.95);
    const injector = new ConfigFaultInjector(
      new ConfigService({ TIMING_50_PERCENTILE: '20ms' }),
    );
    const startedAt = performance.now();

    await injector.afterSuccessfulRequest(0);

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(15);
  });

  it('uses TIMING_90_PERCENTILE as TIMING_99_PERCENTILE fallback', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.995);
    const injector = new ConfigFaultInjector(
      new ConfigService({ TIMING_90_PERCENTILE: '20ms' }),
    );
    const startedAt = performance.now();

    await injector.afterSuccessfulRequest(0);

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(15);
  });

  it('subtracts elapsed request time from successful timing', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const injector = new ConfigFaultInjector(
      new ConfigService({ TIMING_50_PERCENTILE: '20ms' }),
    );
    const startedAt = performance.now();

    await injector.afterSuccessfulRequest(15);

    expect(performance.now() - startedAt).toBeLessThan(15);
  });

  it('adds TIMING_VARIANCE to successful timing', async () => {
    jest
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.5);
    const injector = new ConfigFaultInjector(
      new ConfigService({
        TIMING_50_PERCENTILE: '20ms',
        TIMING_VARIANCE: '100',
      }),
    );
    const startedAt = performance.now();

    await injector.afterSuccessfulRequest(0);

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(25);
  });

  it('injects generic request failures from ERROR_RATE', async () => {
    const injector = new ConfigFaultInjector(
      new ConfigService({
        ERROR_RATE: '10',
        ERROR_CODE: '502',
      }),
    );

    await expect(injector.beforeRequest()).rejects.toMatchObject({
      statusCode: 502,
      message: 'Service error automatically injected',
    } satisfies Partial<InjectedFaultError>);
  });

  it('treats ERROR_RATE as failures out of ten requests', async () => {
    const injector = new ConfigFaultInjector(
      new ConfigService({
        ERROR_RATE: '2',
      }),
    );
    const outcomes: boolean[] = [];

    for (let request = 0; request < 10; request += 1) {
      try {
        await injector.beforeRequest();
        outcomes.push(false);
      } catch (error) {
        expect(error).toBeInstanceOf(InjectedFaultError);
        outcomes.push(true);
      }
    }

    expect(outcomes).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('defaults ERROR_TYPE to http_error', async () => {
    const injector = new ConfigFaultInjector(
      new ConfigService({
        ERROR_RATE: '10',
      }),
    );

    await expect(injector.beforeRequest()).rejects.toMatchObject({
      statusCode: 500,
      message: 'Service error automatically injected',
    } satisfies Partial<InjectedFaultError>);
  });

  it('injects delayed request failures from ERROR_TYPE delay', async () => {
    const injector = new ConfigFaultInjector(
      new ConfigService({
        ERROR_RATE: '10',
        ERROR_TYPE: 'delay',
        ERROR_DELAY: '20ms',
        ERROR_CODE: '504',
      }),
    );
    const startedAt = performance.now();

    await expect(injector.beforeRequest()).rejects.toMatchObject({
      statusCode: 504,
      message: 'Service delay automatically injected',
    } satisfies Partial<InjectedFaultError>);
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(15);
  });

  it('ignores invalid ERROR_DELAY values before delayed failures', async () => {
    const injector = new ConfigFaultInjector(
      new ConfigService({
        ERROR_RATE: '10',
        ERROR_TYPE: 'delay',
        ERROR_DELAY: 'soon',
      }),
    );
    const startedAt = performance.now();

    await expect(injector.beforeRequest()).rejects.toMatchObject({
      message: 'Service delay automatically injected',
    } satisfies Partial<InjectedFaultError>);
    expect(performance.now() - startedAt).toBeLessThan(15);
  });

  it('rate limits requests before the request flow', async () => {
    const injector = new ConfigFaultInjector(
      new ConfigService({
        RATE_LIMIT: '1',
        RATE_LIMIT_CODE: '429',
      }),
    );

    await expect(injector.beforeRequest()).resolves.toBeUndefined();
    await expect(injector.beforeRequest()).rejects.toMatchObject({
      statusCode: 429,
      message: 'Service exceeded rate limit',
    } satisfies Partial<InjectedFaultError>);
  });

  it('does not fail unrelated operations', () => {
    const injector = new ConfigFaultInjector(new ConfigService());

    expect(() => injector.beforeOperation('event-publish')).not.toThrow();
  });
});

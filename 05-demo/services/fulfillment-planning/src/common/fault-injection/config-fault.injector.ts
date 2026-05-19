import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class InjectedFaultError extends Error {
  constructor(
    readonly statusCode: number,
    message = 'Service error automatically injected',
  ) {
    super(message);
  }
}

const ERROR_INJECTION_MESSAGE = 'Service error automatically injected';
const ERROR_DELAY_MESSAGE = 'Service delay automatically injected';
const ERROR_RATE_LIMIT_MESSAGE = 'Service exceeded rate limit';
const ERROR_RATE_WINDOW = 10;

export abstract class FaultInjector {
  abstract beforeRequest(): Promise<void>;
  abstract afterSuccessfulRequest(elapsedMs: number): Promise<void>;
  abstract beforeOperation(operation: string): void;
}

@Injectable()
export class ConfigFaultInjector implements FaultInjector {
  private requestCount = 0;
  private rateLimitTokens = 0;
  private rateLimitLastRefillMs = 0;
  private rateLimitRps = 0;
  private rateLimitCapacity = 0;

  constructor(private readonly config: ConfigService) {}

  async beforeRequest(): Promise<void> {
    this.injectRateLimit();
    await this.injectRequestFailure();
  }

  async afterSuccessfulRequest(elapsedMs: number): Promise<void> {
    const durationMs = this.calculateRequestDurationMs();
    const remainingMs = durationMs - elapsedMs;

    if (remainingMs <= 0) {
      return;
    }

    await sleep(remainingMs);
  }

  beforeOperation(operation: string): void {
    void operation;
  }

  private injectRateLimit(): void {
    const rateLimit = this.numberConfig('RATE_LIMIT');

    if (rateLimit <= 0) {
      return;
    }

    const capacity = Math.max(1, Math.floor(rateLimit));
    const now = Date.now();

    if (
      this.rateLimitRps !== rateLimit ||
      this.rateLimitCapacity !== capacity ||
      this.rateLimitLastRefillMs === 0
    ) {
      this.rateLimitRps = rateLimit;
      this.rateLimitCapacity = capacity;
      this.rateLimitTokens = capacity;
      this.rateLimitLastRefillMs = now;
    }

    const elapsedSeconds = (now - this.rateLimitLastRefillMs) / 1000;
    this.rateLimitTokens = Math.min(
      capacity,
      this.rateLimitTokens + elapsedSeconds * rateLimit,
    );
    this.rateLimitLastRefillMs = now;

    if (this.rateLimitTokens >= 1) {
      this.rateLimitTokens -= 1;
      return;
    }

    throw new InjectedFaultError(
      this.statusCodeConfig('RATE_LIMIT_CODE', 503),
      ERROR_RATE_LIMIT_MESSAGE,
    );
  }

  private async injectRequestFailure(): Promise<void> {
    const errorRate = this.numberConfig('ERROR_RATE');

    if (errorRate <= 0 || !this.shouldInject(errorRate)) {
      return;
    }

    if (this.config.get<string>('ERROR_TYPE', 'http_error') === 'delay') {
      await this.injectErrorDelay();
      throw new InjectedFaultError(
        this.statusCodeConfig('ERROR_CODE', 500),
        ERROR_DELAY_MESSAGE,
      );
    }

    throw new InjectedFaultError(
      this.statusCodeConfig('ERROR_CODE', 500),
      ERROR_INJECTION_MESSAGE,
    );
  }

  private shouldInject(errorRate: number): boolean {
    this.requestCount += 1;
    const failuresPerWindow = Math.floor(
      Math.min(ERROR_RATE_WINDOW, Math.max(0, errorRate)),
    );

    if (failuresPerWindow <= 0) {
      return false;
    }

    if (failuresPerWindow >= ERROR_RATE_WINDOW) {
      return true;
    }

    return (
      (this.requestCount * failuresPerWindow) % ERROR_RATE_WINDOW <
      failuresPerWindow
    );
  }

  private async injectErrorDelay(): Promise<void> {
    const delayMs = this.durationConfigMs('ERROR_DELAY');

    if (delayMs <= 0) {
      return;
    }

    await sleep(delayMs);
  }

  private statusCodeConfig(key: string, defaultValue: number): number {
    const value = this.numberConfig(key, defaultValue);

    if (!Number.isInteger(value) || value < 400 || value > 599) {
      return defaultValue;
    }

    return value;
  }

  private durationConfigMs(key: string): number {
    const value = this.config.get<string>(key, '').trim();
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);

    if (!match) {
      return 0;
    }

    const amount = Number(match[1]);
    const unit = match[2];

    if (!Number.isFinite(amount)) {
      return 0;
    }

    switch (unit) {
      case 'ms':
        return amount;
      case 's':
        return amount * 1000;
      case 'm':
        return amount * 60_000;
      case 'h':
        return amount * 3_600_000;
      default:
        return 0;
    }
  }

  private numberConfig(key: string, defaultValue = 0): number {
    const value = Number(this.config.get<string>(key, String(defaultValue)));

    if (!Number.isFinite(value)) {
      return defaultValue;
    }

    return value;
  }

  private calculateRequestDurationMs(): number {
    const p50 = this.durationConfigMs('TIMING_50_PERCENTILE');
    let p90 = this.durationConfigMs('TIMING_90_PERCENTILE');
    let p99 = this.durationConfigMs('TIMING_99_PERCENTILE');

    if (p50 > 0 && p90 === 0) {
      p90 = p50;
    }

    if (p90 > 0 && p99 === 0) {
      p99 = p90;
    }

    const percentile = randomInt(100);
    let durationMs: number;

    if (percentile < 90) {
      durationMs = p50;
    } else if (percentile < 99) {
      durationMs = p90;
    } else {
      durationMs = p99;
    }

    if (durationMs <= 0) {
      return 0;
    }

    const variance = Math.max(
      0,
      Math.floor(this.numberConfig('TIMING_VARIANCE')),
    );

    if (variance <= 0) {
      return durationMs;
    }

    return durationMs + (durationMs * randomInt(variance)) / 100;
  }
}

function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

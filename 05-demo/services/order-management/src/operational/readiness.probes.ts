import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const LEDGER_READINESS_PROBE = Symbol('LEDGER_READINESS_PROBE');
export const SQS_READINESS_PROBE = Symbol('SQS_READINESS_PROBE');

export interface ReadinessProbe {
  isReady(): Promise<boolean>;
}

@Injectable()
export class HttpLedgerReadinessProbe implements ReadinessProbe {
  constructor(private readonly config: ConfigService) {}

  async isReady(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.timeoutMilliseconds(),
    );

    try {
      const response = await fetch(`${this.baseUrl()}/readyz`, {
        method: 'GET',
        signal: controller.signal,
      });

      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private baseUrl(): string {
    return this.config
      .get<string>('LEDGER_BASE_URL', 'http://localhost:3001')
      .replace(/\/$/, '');
  }

  private timeoutMilliseconds(): number {
    const value = Number(
      this.config.get<string>('READY_CHECK_TIMEOUT_MS', '300'),
    );

    if (!Number.isFinite(value) || value < 1) {
      return 300;
    }

    return value;
  }
}

@Injectable()
export class SqsReadinessProbe implements ReadinessProbe {
  private sqsClient?: SQSClient;

  constructor(private readonly config: ConfigService) {}

  async isReady(): Promise<boolean> {
    try {
      await this.client().send(
        new GetQueueAttributesCommand({
          QueueUrl: this.queueUrl(),
          AttributeNames: ['QueueArn'],
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private client(): SQSClient {
    if (!this.sqsClient) {
      this.sqsClient = new SQSClient({
        region: this.config.get<string>('AWS_REGION', 'us-east-1'),
        endpoint: this.endpoint(),
        credentials: this.credentials(),
      });
    }

    return this.sqsClient;
  }

  private queueUrl(): string {
    return this.config.get<string>(
      'SQS_QUEUE_URL',
      'http://localhost:4566/000000000000/orders-confirmed-intake',
    );
  }

  private endpoint(): string | undefined {
    const endpoint =
      this.config.get<string>('SQS_ENDPOINT') ??
      this.config.get<string>('AWS_ENDPOINT_URL');

    if (endpoint) {
      return endpoint;
    }

    return this.queueUrl().startsWith('http://localhost:4566')
      ? 'http://localhost:4566'
      : undefined;
  }

  private credentials():
    | { accessKeyId: string; secretAccessKey: string }
    | undefined {
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');

    if (accessKeyId && secretAccessKey) {
      return { accessKeyId, secretAccessKey };
    }

    if (this.endpoint()) {
      return { accessKeyId: 'test', secretAccessKey: 'test' };
    }

    return undefined;
  }
}

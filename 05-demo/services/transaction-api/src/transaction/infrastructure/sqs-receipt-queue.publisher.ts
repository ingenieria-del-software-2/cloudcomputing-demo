import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FaultInjector } from '../../common/fault-injection/config-fault.injector';
import {
  ReceiptCommand,
  ReceiptPublisherPort,
} from '../application/transaction.ports';

@Injectable()
export class SqsReceiptQueuePublisher implements ReceiptPublisherPort {
  private sqsClient?: SQSClient;

  constructor(
    private readonly config: ConfigService,
    private readonly faultInjector: FaultInjector,
  ) {}

  async publish(command: ReceiptCommand): Promise<void> {
    this.faultInjector.beforeOperation('receipt-publish');

    const queueUrl = this.queueUrl();
    const message = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(command),
    });
    const maxAttempts = this.positiveIntegerConfig(
      'SQS_PUBLISH_MAX_ATTEMPTS',
      3,
    );
    const retryDelayMs = this.nonNegativeIntegerConfig(
      'SQS_PUBLISH_RETRY_DELAY_MS',
      25,
    );
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.client().send(message);
        return;
      } catch (error) {
        lastError = error;

        if (attempt < maxAttempts && retryDelayMs > 0) {
          await sleep(retryDelayMs);
        }
      }
    }

    throw lastError;
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
      'http://localhost:4566/000000000000/receipt-commands',
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

  private positiveIntegerConfig(key: string, defaultValue: number): number {
    const value = Number(this.config.get<string>(key, String(defaultValue)));

    if (!Number.isInteger(value) || value < 1) {
      return defaultValue;
    }

    return value;
  }

  private nonNegativeIntegerConfig(key: string, defaultValue: number): number {
    const value = Number(this.config.get<string>(key, String(defaultValue)));

    if (!Number.isInteger(value) || value < 0) {
      return defaultValue;
    }

    return value;
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

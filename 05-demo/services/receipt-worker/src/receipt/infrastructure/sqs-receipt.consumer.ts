import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../metrics/metrics.service';
import {
  ReceiptEventSink,
  ReceiptProcessor,
} from '../application/receipt.ports';
import {
  InvalidReceiptCommandError,
  parseReceiptCommand,
} from '../domain/receipt-command';

@Injectable()
export class SqsReceiptConsumer implements OnModuleInit, OnModuleDestroy {
  private sqsClient?: SQSClient;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly processor: ReceiptProcessor,
    private readonly events: ReceiptEventSink,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    if (!this.pollingEnabled()) {
      return;
    }

    this.running = true;
    void this.poll();
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  async consumeOnce(): Promise<number> {
    const response = await this.client().send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl(),
        MaxNumberOfMessages: this.maxMessages(),
        WaitTimeSeconds: this.waitTimeSeconds(),
        VisibilityTimeout: this.visibilityTimeoutSeconds(),
      }),
    );
    const messages = response.Messages ?? [];

    if (messages.length === 0) {
      this.metrics.recordSqsConsume('empty');
      return 0;
    }

    for (const message of messages) {
      await this.handleMessage(message);
    }

    return messages.length;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        await this.consumeOnce();
      } catch (error) {
        this.events.publish({
          type: 'receipt_failed',
          reason: errorMessage(error),
        });
        await sleep(this.pollErrorDelayMs());
      }
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    try {
      const command = parseReceiptCommand(message.Body);
      const result = await this.processor.process(command);

      if (await this.deleteMessage(message)) {
        this.metrics.recordSqsDelete('success', command.producer_version);
      }

      if (result.status === 'duplicate') {
        return;
      }
    } catch (error) {
      if (error instanceof InvalidReceiptCommandError) {
        this.events.publish({
          type: 'receipt_invalid_discarded',
          reason: error.message,
        });
        if (await this.deleteMessage(message)) {
          this.metrics.recordSqsDelete('success');
        }
        return;
      }

      this.events.publish({
        type: 'receipt_failed',
        reason: errorMessage(error),
      });
    }
  }

  private async deleteMessage(message: Message): Promise<boolean> {
    if (!message.ReceiptHandle) {
      return true;
    }

    try {
      await this.client().send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl(),
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
      return true;
    } catch (error) {
      this.events.publish({
        type: 'sqs_delete_failed',
        reason: errorMessage(error),
      });
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

  private pollingEnabled(): boolean {
    return this.config.get<string>('SQS_POLLING_ENABLED', 'true') !== 'false';
  }

  private maxMessages(): number {
    return integerConfig(this.config, 'SQS_MAX_MESSAGES', 5, 1, 10);
  }

  private waitTimeSeconds(): number {
    return integerConfig(this.config, 'SQS_WAIT_TIME_SECONDS', 2, 0, 20);
  }

  private visibilityTimeoutSeconds(): number {
    return integerConfig(
      this.config,
      'SQS_VISIBILITY_TIMEOUT_SECONDS',
      30,
      1,
      43200,
    );
  }

  private pollErrorDelayMs(): number {
    return integerConfig(this.config, 'SQS_POLL_ERROR_DELAY_MS', 500, 0, 60000);
  }
}

function integerConfig(
  config: ConfigService,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(config.get<string>(key, String(defaultValue)));

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    return defaultValue;
  }

  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

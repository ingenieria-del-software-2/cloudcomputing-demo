import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const DB_READINESS_PROBE = Symbol('DB_READINESS_PROBE');
export const SQS_READINESS_PROBE = Symbol('SQS_READINESS_PROBE');

export interface ReadinessProbe {
  isReady(): Promise<boolean>;
}

@Injectable()
export class PostgresReadinessProbe implements ReadinessProbe {
  constructor(private readonly config: ConfigService) {}

  async isReady(): Promise<boolean> {
    const pool = new Pool({ connectionString: this.databaseUrl() });

    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  private databaseUrl(): string {
    return this.config.get<string>(
      'DATABASE_URL',
      'postgresql://order:order@localhost:15432/order_management',
    );
  }
}

@Injectable()
export class SqsReadinessProbe implements ReadinessProbe {
  private sqsClient?: SQSClient;

  constructor(private readonly config: ConfigService) {}

  async isReady(): Promise<boolean> {
    try {
      await Promise.all(
        this.queueUrls().map((queueUrl) =>
          this.client().send(
            new GetQueueAttributesCommand({
              QueueUrl: queueUrl,
              AttributeNames: ['QueueArn'],
            }),
          ),
        ),
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

  private queueUrls(): string[] {
    return [
      this.queueUrl(),
      this.config.get<string>('TRACKING_SQS_QUEUE_URL'),
      this.config.get<string>('FULFILLMENT_FAILED_INTAKE_SQS_QUEUE_URL'),
    ].filter((queueUrl): queueUrl is string => Boolean(queueUrl));
  }

  private endpoint(): string | undefined {
    const endpoint =
      this.config.get<string>('SQS_ENDPOINT') ??
      this.config.get<string>('AWS_ENDPOINT_URL');

    if (endpoint) {
      return endpoint;
    }

    return this.queueUrls().some((queueUrl) =>
      queueUrl.startsWith('http://localhost:4566'),
    )
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

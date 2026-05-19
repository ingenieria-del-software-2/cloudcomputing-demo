import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const DB_READINESS_PROBE = Symbol('DB_READINESS_PROBE');
export const SQS_READINESS_PROBE = Symbol('SQS_READINESS_PROBE');
export const S3_READINESS_PROBE = Symbol('S3_READINESS_PROBE');

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
      'postgresql://shipment:shipment@localhost:15434/shipment_preparation',
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
        region: this.region(),
        endpoint: this.awsEndpoint(),
        credentials: this.credentials(),
      });
    }

    return this.sqsClient;
  }

  private queueUrls(): string[] {
    return [
      this.config.get<string>(
        'INPUT_SQS_QUEUE_URL',
        'http://localhost:4566/000000000000/fulfillment-commitment-intake',
      ),
      this.config.get<string>(
        'SQS_QUEUE_URL',
        'http://localhost:4566/000000000000/buyer-tracking-events',
      ),
    ];
  }

  private region(): string {
    return this.config.get<string>('AWS_REGION', 'us-east-1');
  }

  private awsEndpoint(): string | undefined {
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

    if (this.awsEndpoint()) {
      return { accessKeyId: 'test', secretAccessKey: 'test' };
    }

    return undefined;
  }
}

@Injectable()
export class S3ReadinessProbe implements ReadinessProbe {
  private s3Client?: S3Client;

  constructor(private readonly config: ConfigService) {}

  async isReady(): Promise<boolean> {
    try {
      await this.client().send(
        new HeadBucketCommand({ Bucket: this.bucketName() }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private client(): S3Client {
    if (!this.s3Client) {
      this.s3Client = new S3Client({
        region: this.region(),
        endpoint: this.s3Endpoint(),
        forcePathStyle: true,
        credentials: this.credentials(),
      });
    }

    return this.s3Client;
  }

  private bucketName(): string {
    return this.config.get<string>(
      'SHIPMENT_DOCUMENTS_BUCKET',
      'seller-dispatch-documents-lab',
    );
  }

  private region(): string {
    return this.config.get<string>('AWS_REGION', 'us-east-1');
  }

  private s3Endpoint(): string | undefined {
    return (
      this.config.get<string>('S3_ENDPOINT') ??
      this.config.get<string>('AWS_ENDPOINT_URL') ??
      undefined
    );
  }

  private credentials():
    | { accessKeyId: string; secretAccessKey: string }
    | undefined {
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');

    if (accessKeyId && secretAccessKey) {
      return { accessKeyId, secretAccessKey };
    }

    if (this.s3Endpoint()) {
      return { accessKeyId: 'test', secretAccessKey: 'test' };
    }

    return undefined;
  }
}

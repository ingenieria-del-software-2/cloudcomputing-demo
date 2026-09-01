import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const DYNAMODB_READINESS_PROBE = Symbol('DYNAMODB_READINESS_PROBE');
export const SQS_READINESS_PROBE = Symbol('SQS_READINESS_PROBE');

export interface ReadinessProbe {
  isReady(): Promise<boolean>;
}

@Injectable()
export class DynamoDbReadinessProbe implements ReadinessProbe {
  private dynamodbClient?: DynamoDBClient;

  constructor(private readonly config: ConfigService) {}

  async isReady(): Promise<boolean> {
    try {
      await this.client().send(
        new DescribeTableCommand({ TableName: this.tableName() }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private client(): DynamoDBClient {
    if (!this.dynamodbClient) {
      this.dynamodbClient = new DynamoDBClient({
        region: this.region(),
        endpoint: this.dynamodbEndpoint(),
        credentials: this.credentials(),
      });
    }

    return this.dynamodbClient;
  }

  private tableName(): string {
    return this.config.get<string>(
      'TRACKING_TABLE_NAME',
      'buyer-visible-order-state',
    );
  }

  private region(): string {
    return this.config.get<string>('AWS_REGION', 'us-east-1');
  }

  private dynamodbEndpoint(): string | undefined {
    return (
      this.config.get<string>('DYNAMODB_ENDPOINT') ??
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

    if (this.dynamodbEndpoint()) {
      return { accessKeyId: 'test', secretAccessKey: 'test' };
    }

    return undefined;
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
        'http://localhost:4566/000000000000/buyer-tracking-events',
      ),
      this.config.get<string>(
        'SQS_QUEUE_URL',
        'http://localhost:4566/000000000000/customer-experience-events',
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

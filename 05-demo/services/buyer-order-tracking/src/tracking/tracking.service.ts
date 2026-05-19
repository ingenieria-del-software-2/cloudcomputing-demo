import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  TRACKING_EVENT_NAMES,
  TrackingEventDto,
  TrackingEventName,
} from './tracking-event.dto';

type VisibleStatus =
  | 'ORDER_CONFIRMED'
  | 'FULFILLMENT_IN_PROGRESS'
  | 'FULFILLMENT_COMMITTED'
  | 'FULFILLMENT_AT_RISK'
  | 'READY_TO_DISPATCH'
  | 'DISPATCH_BLOCKED'
  | 'CANCELLED';

interface EventEnvelope<TPayload> {
  event_id: string;
  event_name: string;
  event_version: '1.0';
  occurred_at: string;
  producer: 'buyer-order-tracking';
  correlation_id: string;
  causation_id: string;
  idempotency_key: string;
  payload: TPayload;
}

interface RawEventEnvelope {
  event_id: string;
  event_name: string;
  event_version: string;
  occurred_at: string;
  producer: string;
  correlation_id: string;
  causation_id: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
}

interface HandleTrackingEventCommand {
  event: TrackingEventDto;
  requestId: string;
}

export interface TimelineEntry {
  status: VisibleStatus;
  event_id: string;
  event_name: TrackingEventName;
  correlation_id: string;
  occurred_at: string;
  applied_at: string;
  reason?: string;
}

export interface TrackingRecord {
  order_id: string;
  buyer_id: string;
  visible_status: VisibleStatus;
  last_event_name: TrackingEventName;
  last_event_occurred_at: string;
  correlation_id: string;
  seller_id?: string;
  payment_id?: string;
  fulfillment_commitment_id?: string;
  shipment_id?: string;
  estimated_delivery_date?: string;
  updated_at: string;
  created_at: string;
  timeline: TimelineEntry[];
  processed_event_ids: string[];
  journey_started_at?: string;
  critical_journey_recorded_at?: string;
}

export interface TrackingAcceptedResponse {
  order_id: string;
  buyer_id: string;
  visible_status: VisibleStatus;
  duplicate: boolean;
  version: string;
  timeline_length: number;
}

interface TrackingUpdateResult {
  record: TrackingRecord;
  duplicate: boolean;
  previousStatus?: VisibleStatus;
  criticalJourneyDurationSeconds?: number;
}

class TrackingEventPublishError extends Error {
  constructor(readonly cause: unknown) {
    super('Tracking update event could not be published');
  }
}

const TRACKING_EVENT_NAME_SET = new Set<string>(TRACKING_EVENT_NAMES);

@Injectable()
export class TrackingService implements OnModuleInit, OnModuleDestroy {
  private dynamodbClient?: DynamoDBClient;
  private documentClient?: DynamoDBDocumentClient;
  private sqsClient?: SQSClient;
  private stopping = false;
  private workers: Promise<void>[] = [];
  private queueMetricsTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTable();
    this.startQueueMetricsRefresh();
    this.startWorkers();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.queueMetricsTimer) {
      clearInterval(this.queueMetricsTimer);
    }
    this.sqsClient?.destroy();
    this.dynamodbClient?.destroy();
    await Promise.allSettled(this.workers);
  }

  async handleEvent(
    command: HandleTrackingEventCommand,
  ): Promise<TrackingAcceptedResponse> {
    const startedAt = performance.now();
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');

    try {
      const result = await this.upsertTracking(command.event);

      if (result.duplicate) {
        return this.acceptDuplicate(command, result.record, version, startedAt);
      }

      await this.publishTrackingUpdated(command.event, result.record, version);
      this.recordSuccessfulUpdate(command, result, version, startedAt);
      return response(result.record, false, version);
    } catch (error) {
      this.metrics.recordTrackingEvent(
        'processing_failed',
        command.event.event_name,
        version,
      );
      this.metrics.observeTrackingDuration(
        'processing_failed',
        version,
        durationSeconds(startedAt),
      );
      this.logger.error('tracking_processing_failed', {
        request_id: command.requestId,
        event_id: command.event.event_id,
        event_name: command.event.event_name,
        correlation_id: command.event.correlation_id,
        order_id: command.event.payload.order_id,
        status_before: 'UNKNOWN',
        status_after: 'TRACKING_UPDATE_FAILED',
        business_error_code: processingFailureCode(error),
        duration_ms: durationMs(startedAt),
        result: 'TRACKING_UPDATE_FAILED',
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
      throw new ServiceUnavailableException({
        status: 503,
        code: 'TRACKING_UPDATE_FAILED',
        message: 'Buyer tracking could not be updated',
      });
    }
  }

  async findTrackingByOrderId(
    orderId: string,
  ): Promise<TrackingRecord | undefined> {
    const startedAt = performance.now();
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');

    try {
      const result = await this.document().send(
        new GetCommand({
          TableName: this.tableName(),
          Key: { order_id: orderId },
        }),
      );

      this.recordDynamoDbDuration('get_item', 'success', version, startedAt);
      return result.Item ? toTrackingRecord(result.Item) : undefined;
    } catch (error) {
      this.recordDynamoDbDuration('get_item', 'failure', version, startedAt);
      throw error;
    }
  }

  async findOrdersByBuyerId(buyerId: string): Promise<TrackingRecord[]> {
    const startedAt = performance.now();
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');

    try {
      const result = await this.document().send(
        new QueryCommand({
          TableName: this.tableName(),
          IndexName: this.buyerOrdersIndexName(),
          KeyConditionExpression: 'buyer_id = :buyer_id',
          ExpressionAttributeValues: {
            ':buyer_id': buyerId,
          },
        }),
      );

      this.recordDynamoDbDuration('query', 'success', version, startedAt);
      return (result.Items ?? [])
        .map(toTrackingRecord)
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    } catch (error) {
      this.recordDynamoDbDuration('query', 'failure', version, startedAt);
      throw error;
    }
  }

  private async upsertTracking(
    event: TrackingEventDto,
  ): Promise<TrackingUpdateResult> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await this.findTrackingByOrderId(event.payload.order_id);

      if (existing?.processed_event_ids.includes(event.event_id)) {
        return { record: existing, duplicate: true };
      }

      const now = new Date().toISOString();
      const next = nextTrackingRecord(existing, event, now);
      const record = next.record;
      const putStartedAt = performance.now();

      try {
        await this.document().send(
          new PutCommand({
            TableName: this.tableName(),
            Item: record,
            ConditionExpression: existing
              ? 'updated_at = :previous_updated_at AND NOT contains(processed_event_ids, :event_id)'
              : 'attribute_not_exists(order_id)',
            ExpressionAttributeValues: existing
              ? {
                  ':event_id': event.event_id,
                  ':previous_updated_at': existing.updated_at,
                }
              : undefined,
          }),
        );
        this.recordDynamoDbDuration(
          'put_item',
          'success',
          this.config.get<string>('SERVICE_VERSION', 'v1'),
          putStartedAt,
        );
        return {
          record,
          duplicate: false,
          previousStatus: existing?.visible_status,
          criticalJourneyDurationSeconds: next.criticalJourneyDurationSeconds,
        };
      } catch (error) {
        this.recordDynamoDbDuration(
          'put_item',
          'failure',
          this.config.get<string>('SERVICE_VERSION', 'v1'),
          putStartedAt,
        );

        if (!isConditionalCheckFailed(error)) {
          throw error;
        }
      }
    }

    const current = await this.findTrackingByOrderId(event.payload.order_id);
    if (current?.processed_event_ids.includes(event.event_id)) {
      return { record: current, duplicate: true };
    }

    throw new Error('tracking optimistic lock retry exhausted');
  }

  private acceptDuplicate(
    command: HandleTrackingEventCommand,
    record: TrackingRecord,
    version: string,
    startedAt: number,
  ): TrackingAcceptedResponse {
    this.metrics.recordTrackingEvent(
      'duplicate_event_ignored',
      command.event.event_name,
      version,
    );
    this.metrics.observeTrackingDuration(
      'duplicate_event_ignored',
      version,
      durationSeconds(startedAt),
    );
    this.logger.info('duplicate_tracking_event_ignored', {
      request_id: command.requestId,
      event_id: command.event.event_id,
      event_name: command.event.event_name,
      correlation_id: command.event.correlation_id,
      order_id: record.order_id,
      buyer_id: record.buyer_id,
      status_before: record.visible_status,
      status_after: record.visible_status,
      duration_ms: durationMs(startedAt),
      result: 'DUPLICATE_EVENT_IGNORED',
    });

    return response(record, true, version);
  }

  private recordSuccessfulUpdate(
    command: HandleTrackingEventCommand,
    result: TrackingUpdateResult,
    version: string,
    startedAt: number,
  ): void {
    const freshnessSeconds = eventFreshnessSeconds(command.event.occurred_at);
    this.metrics.recordTrackingEvent(
      'updated',
      command.event.event_name,
      version,
    );
    this.metrics.observeTrackingDuration(
      'updated',
      version,
      durationSeconds(startedAt),
    );
    this.metrics.observeFreshness({
      eventName: command.event.event_name,
      visibleStatus: result.record.visible_status,
      version,
      freshnessSeconds,
    });
    if (result.criticalJourneyDurationSeconds !== undefined) {
      this.metrics.observeCriticalJourney({
        visibleStatus: result.record.visible_status,
        version,
        durationSeconds: result.criticalJourneyDurationSeconds,
      });
    }
    this.logger.info('buyer_tracking_updated', {
      request_id: command.requestId,
      event_id: command.event.event_id,
      event_name: command.event.event_name,
      correlation_id: command.event.correlation_id,
      order_id: result.record.order_id,
      buyer_id: result.record.buyer_id,
      fulfillment_commitment_id: result.record.fulfillment_commitment_id,
      shipment_id: result.record.shipment_id,
      status_before: result.previousStatus ?? 'NONE',
      status_after: result.record.visible_status,
      freshness_seconds: freshnessSeconds,
      duration_ms: durationMs(startedAt),
      result: 'TRACKING_UPDATED',
    });
  }

  private async publishTrackingUpdated(
    source: TrackingEventDto,
    record: TrackingRecord,
    version: string,
  ): Promise<void> {
    const event = this.trackingUpdatedEvent(source, record);

    try {
      await this.sqs().send(
        new SendMessageCommand({
          QueueUrl: this.outputQueueUrl(),
          MessageBody: JSON.stringify(event),
        }),
      );
      this.metrics.recordSqsPublish('success', version, this.outputQueueName());
      void this.refreshQueueDepthMetrics(version);
    } catch (error) {
      this.metrics.recordSqsPublish('failure', version, this.outputQueueName());
      void this.refreshQueueDepthMetrics(version);
      this.logger.error('tracking_event_publish_failed', {
        event_id: event.event_id,
        event_name: event.event_name,
        correlation_id: event.correlation_id,
        order_id: record.order_id,
        buyer_id: record.buyer_id,
        business_error_code: 'TRACKING_EVENT_QUEUE_FAILED',
        result: 'TRACKING_EVENT_QUEUE_FAILED',
        error_message: error instanceof Error ? error.message : 'unknown error',
      });
      throw new TrackingEventPublishError(error);
    }
  }

  private trackingUpdatedEvent(
    source: TrackingEventDto,
    record: TrackingRecord,
  ): EventEnvelope<Record<string, unknown>> {
    const occurredAt = new Date().toISOString();

    return {
      event_id: newId('evt'),
      event_name: 'customer_experience.order_tracking_updated.v1',
      event_version: '1.0',
      occurred_at: occurredAt,
      producer: 'buyer-order-tracking',
      correlation_id: source.correlation_id,
      causation_id: source.event_id,
      idempotency_key: `order_id:${record.order_id}:tracking`,
      payload: {
        order_id: record.order_id,
        buyer_id: record.buyer_id,
        visible_status: record.visible_status,
        last_event_name: record.last_event_name,
        estimated_delivery_date: record.estimated_delivery_date,
        updated_at: record.updated_at,
        timeline_length: record.timeline.length,
      },
    };
  }

  private startWorkers(): void {
    if (!this.workerEnabled()) {
      return;
    }

    for (let index = 0; index < this.workerConcurrency(); index += 1) {
      this.workers.push(this.workerLoop(index));
    }
  }

  private async workerLoop(workerIndex: number): Promise<void> {
    while (!this.stopping) {
      try {
        const response = await this.sqs().send(
          new ReceiveMessageCommand({
            QueueUrl: this.inputQueueUrl(),
            MaxNumberOfMessages: this.maxMessagesPerPoll(),
            WaitTimeSeconds: this.waitTimeSeconds(),
          }),
        );

        for (const message of prioritizeMessages(response.Messages ?? [])) {
          await this.processMessage(workerIndex, message);
        }
      } catch (error) {
        if (!this.stopping) {
          this.logger.error('tracking_worker_poll_failed', {
            queue: this.inputQueueName(),
            business_error_code: 'TRACKING_WORKER_POLL_FAILED',
            result: 'TRACKING_WORKER_POLL_FAILED',
            error_message:
              error instanceof Error ? error.message : 'unknown error',
          });
          await sleep(250);
        }
      }
    }
  }

  private async processMessage(
    workerIndex: number,
    message: { Body?: string; MessageId?: string; ReceiptHandle?: string },
  ): Promise<void> {
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');
    const rawEvent = parseEvent(message.Body);

    if (!rawEvent || !isTrackingEventName(rawEvent.event_name)) {
      this.metrics.recordTrackingEvent(
        'unsupported_event_ignored',
        rawEvent?.event_name ?? 'unknown',
        version,
      );
      this.metrics.recordSqsConsume('success', version, this.inputQueueName());
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    const event = rawEvent as TrackingEventDto;

    try {
      const delayMs = this.trackingConsumerDelayMs();
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      await this.handleEvent({
        event,
        requestId: message.MessageId ?? event.event_id,
      });
      await this.deleteMessage(message.ReceiptHandle);
      this.metrics.recordSqsConsume('success', version, this.inputQueueName());
      void this.refreshQueueDepthMetrics(version);
      this.logger.info('tracking_worker_message_processed', {
        event_id: event.event_id,
        event_name: event.event_name,
        correlation_id: event.correlation_id,
        order_id: event.payload.order_id,
        buyer_id: stringValue(event.payload.buyer_id),
        queue: this.inputQueueName(),
        result: 'MESSAGE_PROCESSED',
        detail: `worker:${workerIndex}`,
      });
    } catch {
      this.metrics.recordSqsConsume('failure', version, this.inputQueueName());
      void this.refreshQueueDepthMetrics(version);
      // Leave the message in SQS so the queue redrive policy can move it to DLQ.
    }
  }

  private async refreshQueueDepthMetrics(version: string): Promise<void> {
    await Promise.all(
      uniqueQueueUrls([this.inputQueueUrl(), this.outputQueueUrl()]).map(
        async (queueUrl) => this.refreshQueueDepthMetric(queueUrl, version),
      ),
    );
  }

  private startQueueMetricsRefresh(): void {
    const version = this.config.get<string>('SERVICE_VERSION', 'v1');
    void this.refreshQueueDepthMetrics(version);

    const intervalMs = this.queueMetricsPollIntervalMs();
    if (intervalMs <= 0) {
      return;
    }

    this.queueMetricsTimer = setInterval(() => {
      void this.refreshQueueDepthMetrics(version);
    }, intervalMs);
  }

  private async refreshQueueDepthMetric(
    queueUrl: string,
    version: string,
  ): Promise<void> {
    try {
      const response = await this.sqs().send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
            'ApproximateNumberOfMessagesDelayed',
            'RedrivePolicy',
          ],
        }),
      );
      this.metrics.recordEventBacklogDepth(
        queueNameFromUrl(queueUrl),
        version,
        queueDepth(response.Attributes),
      );

      const dlqUrl = deadLetterQueueUrl(
        queueUrl,
        response.Attributes?.RedrivePolicy,
      );
      if (!dlqUrl) {
        return;
      }

      const dlqResponse = await this.sqs().send(
        new GetQueueAttributesCommand({
          QueueUrl: dlqUrl,
          AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
            'ApproximateNumberOfMessagesDelayed',
          ],
        }),
      );
      this.metrics.recordEventDlqDepth(
        queueNameFromUrl(dlqUrl),
        version,
        queueDepth(dlqResponse.Attributes),
      );
    } catch {
      // Queue depth metrics are best-effort and must not affect event handling.
    }
  }

  private async deleteMessage(
    receiptHandle: string | undefined,
  ): Promise<void> {
    if (!receiptHandle) {
      return;
    }

    await this.sqs().send(
      new DeleteMessageCommand({
        QueueUrl: this.inputQueueUrl(),
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private async ensureTable(): Promise<void> {
    try {
      await this.dynamodb().send(
        new DescribeTableCommand({ TableName: this.tableName() }),
      );
      return;
    } catch (error) {
      if (!isResourceNotFound(error)) {
        throw error;
      }
    }

    await this.dynamodb().send(
      new CreateTableCommand({
        TableName: this.tableName(),
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'order_id', AttributeType: 'S' },
          { AttributeName: 'buyer_id', AttributeType: 'S' },
        ],
        KeySchema: [{ AttributeName: 'order_id', KeyType: 'HASH' }],
        GlobalSecondaryIndexes: [
          {
            IndexName: this.buyerOrdersIndexName(),
            KeySchema: [
              { AttributeName: 'buyer_id', KeyType: 'HASH' },
              { AttributeName: 'order_id', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }),
    );
    await this.waitForTable();
  }

  private async waitForTable(): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await this.dynamodb().send(
        new DescribeTableCommand({ TableName: this.tableName() }),
      );

      if (response.Table?.TableStatus === 'ACTIVE') {
        return;
      }

      await sleep(100);
    }
  }

  private recordDynamoDbDuration(
    operation: string,
    status: 'success' | 'failure',
    version: string,
    startedAt: number,
  ): void {
    this.metrics.observeDynamoDbDuration({
      operation,
      status,
      table: this.tableName(),
      version,
      durationSeconds: durationSeconds(startedAt),
    });
  }

  private dynamodb(): DynamoDBClient {
    if (!this.dynamodbClient) {
      this.dynamodbClient = new DynamoDBClient({
        region: this.region(),
        endpoint: this.dynamodbEndpoint(),
        credentials: this.credentials(this.dynamodbEndpoint()),
      });
    }

    return this.dynamodbClient;
  }

  private document(): DynamoDBDocumentClient {
    if (!this.documentClient) {
      this.documentClient = DynamoDBDocumentClient.from(this.dynamodb(), {
        marshallOptions: { removeUndefinedValues: true },
      });
    }

    return this.documentClient;
  }

  private sqs(): SQSClient {
    if (!this.sqsClient) {
      this.sqsClient = new SQSClient({
        region: this.region(),
        endpoint: this.sqsEndpoint(),
        credentials: this.credentials(this.sqsEndpoint()),
      });
    }

    return this.sqsClient;
  }

  private tableName(): string {
    return this.config.get<string>(
      'TRACKING_TABLE_NAME',
      'buyer-visible-order-state',
    );
  }

  private buyerOrdersIndexName(): string {
    return this.config.get<string>(
      'BUYER_ORDERS_INDEX_NAME',
      'buyer_id-order_id-index',
    );
  }

  private inputQueueUrl(): string {
    return this.config.get<string>(
      'INPUT_SQS_QUEUE_URL',
      'http://localhost:4566/000000000000/buyer-tracking-events',
    );
  }

  private outputQueueUrl(): string {
    return this.config.get<string>(
      'SQS_QUEUE_URL',
      'http://localhost:4566/000000000000/customer-experience-events',
    );
  }

  private inputQueueName(): string {
    return this.inputQueueUrl().split('/').pop() ?? 'buyer-tracking-events';
  }

  private outputQueueName(): string {
    return (
      this.outputQueueUrl().split('/').pop() ?? 'customer-experience-events'
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

  private sqsEndpoint(): string | undefined {
    const endpoint =
      this.config.get<string>('SQS_ENDPOINT') ??
      this.config.get<string>('AWS_ENDPOINT_URL');

    if (endpoint) {
      return endpoint;
    }

    return [this.inputQueueUrl(), this.outputQueueUrl()].some((queueUrl) =>
      queueUrl.startsWith('http://localhost:4566'),
    )
      ? 'http://localhost:4566'
      : undefined;
  }

  private credentials(
    endpoint: string | undefined,
  ): { accessKeyId: string; secretAccessKey: string } | undefined {
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');

    if (accessKeyId && secretAccessKey) {
      return { accessKeyId, secretAccessKey };
    }

    if (endpoint) {
      return { accessKeyId: 'test', secretAccessKey: 'test' };
    }

    return undefined;
  }

  private workerEnabled(): boolean {
    return (
      this.config.get<string>('TRACKING_CONSUMER_ENABLED', 'true') !==
        'false' && this.config.get<string>('WORKER_ENABLED', 'true') !== 'false'
    );
  }

  private workerConcurrency(): number {
    const value = Number(this.config.get<string>('WORKER_CONCURRENCY', '1'));

    if (!Number.isInteger(value) || value < 1) {
      return 1;
    }

    return Math.min(value, 10);
  }

  private waitTimeSeconds(): number {
    const value = Number(this.config.get<string>('SQS_WAIT_TIME_SECONDS', '1'));

    if (!Number.isInteger(value) || value < 0) {
      return 1;
    }

    return Math.min(value, 20);
  }

  private trackingConsumerDelayMs(): number {
    const value = Number(
      this.config.get<string>('TRACKING_CONSUMER_DELAY_MS', '0'),
    );

    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }

    return Math.min(value, 300_000);
  }

  private maxMessagesPerPoll(): number {
    const value = Number(
      this.config.get<string>('TRACKING_MAX_MESSAGES_PER_POLL', '10'),
    );

    if (!Number.isInteger(value) || value < 1) {
      return 1;
    }

    return Math.min(value, 10);
  }

  private queueMetricsPollIntervalMs(): number {
    const value = Number(
      this.config.get<string>('QUEUE_METRICS_POLL_INTERVAL_MS', '5000'),
    );

    if (!Number.isFinite(value)) {
      return 5000;
    }

    return Math.max(0, Math.floor(value));
  }
}

function response(
  record: TrackingRecord,
  duplicate: boolean,
  version: string,
): TrackingAcceptedResponse {
  return {
    order_id: record.order_id,
    buyer_id: record.buyer_id,
    visible_status: record.visible_status,
    duplicate,
    version,
    timeline_length: record.timeline.length,
  };
}

function nextTrackingRecord(
  existing: TrackingRecord | undefined,
  event: TrackingEventDto,
  now: string,
): { record: TrackingRecord; criticalJourneyDurationSeconds?: number } {
  const incomingStatus = statusForEvent(event.event_name);
  const nextStatus = chooseVisibleStatus(
    existing?.visible_status,
    incomingStatus,
  );
  const replaceLastEvent = shouldReplaceLastEvent(existing, event);
  const timeline = appendTimelineEntry(existing?.timeline ?? [], event, now);
  const record: TrackingRecord = {
    order_id: event.payload.order_id,
    buyer_id:
      stringValue(event.payload.buyer_id) ?? existing?.buyer_id ?? 'unknown',
    visible_status: nextStatus,
    last_event_name: replaceLastEvent
      ? event.event_name
      : (existing?.last_event_name ?? event.event_name),
    last_event_occurred_at: replaceLastEvent
      ? eventOccurredAt(event)
      : (existing?.last_event_occurred_at ?? eventOccurredAt(event)),
    correlation_id: existing?.correlation_id ?? event.correlation_id,
    seller_id: stringValue(event.payload.seller_id) ?? existing?.seller_id,
    payment_id: stringValue(event.payload.payment_id) ?? existing?.payment_id,
    fulfillment_commitment_id:
      stringValue(event.payload.fulfillment_commitment_id) ??
      existing?.fulfillment_commitment_id,
    shipment_id:
      stringValue(event.payload.shipment_id) ?? existing?.shipment_id,
    estimated_delivery_date:
      stringValue(event.payload.estimated_delivery_date) ??
      existing?.estimated_delivery_date,
    updated_at: now,
    created_at: existing?.created_at ?? now,
    timeline,
    processed_event_ids: [
      ...(existing?.processed_event_ids ?? []),
      event.event_id,
    ],
    journey_started_at:
      existing?.journey_started_at ?? journeyStartedAtForEvent(event),
    critical_journey_recorded_at: existing?.critical_journey_recorded_at,
  };
  const criticalJourneyDurationSeconds = terminalJourneyDurationSeconds(
    record,
    now,
  );

  if (criticalJourneyDurationSeconds !== undefined) {
    record.critical_journey_recorded_at = now;
  }

  return { record, criticalJourneyDurationSeconds };
}

function appendTimelineEntry(
  timeline: TimelineEntry[],
  event: TrackingEventDto,
  appliedAt: string,
): TimelineEntry[] {
  const next = [
    ...timeline,
    {
      status: statusForEvent(event.event_name),
      event_id: event.event_id,
      event_name: event.event_name,
      correlation_id: event.correlation_id,
      occurred_at: eventOccurredAt(event),
      applied_at: appliedAt,
      reason: stringValue(event.payload.reason),
    },
  ];

  return next.sort(
    (left, right) =>
      Date.parse(left.occurred_at) - Date.parse(right.occurred_at),
  );
}

function statusForEvent(eventName: TrackingEventName): VisibleStatus {
  switch (eventName) {
    case 'orders.order_confirmed.v1':
      return 'ORDER_CONFIRMED';
    case 'orders.order_cancelled.v1':
      return 'CANCELLED';
    case 'fulfillment.commitment_confirmed.v1':
      return 'FULFILLMENT_COMMITTED';
    case 'fulfillment.commitment_at_risk.v1':
      return 'FULFILLMENT_AT_RISK';
    case 'fulfillment.commitment_failed.v1':
      return 'CANCELLED';
    case 'shipping.shipment_ready_to_dispatch.v1':
      return 'READY_TO_DISPATCH';
    case 'shipping.dispatch_blocked.v1':
      return 'DISPATCH_BLOCKED';
  }
}

function chooseVisibleStatus(
  current: VisibleStatus | undefined,
  incoming: VisibleStatus,
): VisibleStatus {
  if (!current) {
    return incoming;
  }

  return statusRank(incoming) >= statusRank(current) ? incoming : current;
}

function shouldReplaceLastEvent(
  existing: TrackingRecord | undefined,
  event: TrackingEventDto,
): boolean {
  if (!existing) {
    return true;
  }

  const incomingStatus = statusForEvent(event.event_name);
  const incomingRank = statusRank(incomingStatus);
  const currentRank = statusRank(existing.visible_status);

  if (incomingRank !== currentRank) {
    return incomingRank > currentRank;
  }

  return (
    Date.parse(eventOccurredAt(event)) >=
    Date.parse(existing.last_event_occurred_at)
  );
}

function terminalJourneyDurationSeconds(
  record: TrackingRecord,
  now: string,
): number | undefined {
  if (
    record.critical_journey_recorded_at ||
    !isTerminal(record.visible_status)
  ) {
    return undefined;
  }

  const orderConfirmed = record.timeline.find(
    (entry) => entry.status === 'ORDER_CONFIRMED',
  );
  const journeyStartedAt =
    record.journey_started_at ?? orderConfirmed?.occurred_at;
  const startedAtMs = journeyStartedAt
    ? Date.parse(journeyStartedAt)
    : Number.NaN;
  const visibleAtMs = Date.parse(now);

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(visibleAtMs)) {
    return undefined;
  }

  return Math.max(0, (visibleAtMs - startedAtMs) / 1000);
}

function isTerminal(status: VisibleStatus): boolean {
  return (
    status === 'READY_TO_DISPATCH' ||
    status === 'DISPATCH_BLOCKED' ||
    status === 'CANCELLED'
  );
}

function statusRank(status: VisibleStatus): number {
  switch (status) {
    case 'ORDER_CONFIRMED':
      return 10;
    case 'FULFILLMENT_IN_PROGRESS':
      return 20;
    case 'FULFILLMENT_COMMITTED':
      return 30;
    case 'FULFILLMENT_AT_RISK':
      return 40;
    case 'READY_TO_DISPATCH':
      return 70;
    case 'DISPATCH_BLOCKED':
      return 80;
    case 'CANCELLED':
      return 90;
  }
}

function eventOccurredAt(event: TrackingEventDto): string {
  return (
    stringValue(event.payload.confirmed_at) ??
    stringValue(event.payload.committed_at) ??
    stringValue(event.payload.failed_at) ??
    stringValue(event.payload.at_risk_at) ??
    stringValue(event.payload.ready_to_dispatch_at) ??
    stringValue(event.payload.blocked_at) ??
    stringValue(event.payload.cancelled_at) ??
    event.occurred_at
  );
}

function journeyStartedAtForEvent(event: TrackingEventDto): string | undefined {
  const explicit = validIsoOrUndefined(
    stringValue(event.payload.payment_approved_at),
  );

  if (explicit) {
    return explicit;
  }

  if (event.event_name === 'orders.order_confirmed.v1') {
    return eventOccurredAt(event);
  }

  return undefined;
}

function eventFreshnessSeconds(occurredAt: string): number {
  const occurredAtMs = Date.parse(occurredAt);

  if (!Number.isFinite(occurredAtMs)) {
    return 0;
  }

  return Math.max(0, (Date.now() - occurredAtMs) / 1000);
}

function isTrackingEventName(
  eventName: string,
): eventName is TrackingEventName {
  return TRACKING_EVENT_NAME_SET.has(eventName);
}

function parseEvent(body: string | undefined): RawEventEnvelope | undefined {
  if (!body) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(body);

    if (!isRawEventEnvelope(parsed)) {
      return undefined;
    }

    return parsed;
  } catch {
    return undefined;
  }
}

function isRawEventEnvelope(value: unknown): value is RawEventEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<RawEventEnvelope>;
  return (
    typeof candidate.event_id === 'string' &&
    typeof candidate.event_name === 'string' &&
    typeof candidate.event_version === 'string' &&
    typeof candidate.occurred_at === 'string' &&
    typeof candidate.producer === 'string' &&
    typeof candidate.correlation_id === 'string' &&
    typeof candidate.causation_id === 'string' &&
    typeof candidate.idempotency_key === 'string' &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null &&
    typeof candidate.payload.order_id === 'string'
  );
}

function toTrackingRecord(item: Record<string, unknown>): TrackingRecord {
  return {
    order_id: stringValue(item.order_id) ?? '',
    buyer_id: stringValue(item.buyer_id) ?? 'unknown',
    visible_status: visibleStatusValue(item.visible_status),
    last_event_name: trackingEventNameValue(item.last_event_name),
    last_event_occurred_at: stringValue(item.last_event_occurred_at) ?? '',
    correlation_id: stringValue(item.correlation_id) ?? '',
    seller_id: stringValue(item.seller_id),
    payment_id: stringValue(item.payment_id),
    fulfillment_commitment_id: stringValue(item.fulfillment_commitment_id),
    shipment_id: stringValue(item.shipment_id),
    estimated_delivery_date: stringValue(item.estimated_delivery_date),
    updated_at: stringValue(item.updated_at) ?? '',
    created_at: stringValue(item.created_at) ?? '',
    timeline: Array.isArray(item.timeline)
      ? item.timeline.map((entry) => toTimelineEntry(entry))
      : [],
    processed_event_ids: Array.isArray(item.processed_event_ids)
      ? item.processed_event_ids.flatMap((eventId) =>
          typeof eventId === 'string' ? [eventId] : [],
        )
      : [],
    journey_started_at: stringValue(item.journey_started_at),
    critical_journey_recorded_at: stringValue(
      item.critical_journey_recorded_at,
    ),
  };
}

function toTimelineEntry(value: unknown): TimelineEntry {
  const entry =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};

  return {
    status: visibleStatusValue(entry.status),
    event_id: stringValue(entry.event_id) ?? '',
    event_name: trackingEventNameValue(entry.event_name),
    correlation_id: stringValue(entry.correlation_id) ?? '',
    occurred_at: stringValue(entry.occurred_at) ?? '',
    applied_at: stringValue(entry.applied_at) ?? '',
    reason: stringValue(entry.reason),
  };
}

function visibleStatusValue(value: unknown): VisibleStatus {
  const status = stringValue(value);

  if (
    status === 'ORDER_CONFIRMED' ||
    status === 'FULFILLMENT_IN_PROGRESS' ||
    status === 'FULFILLMENT_COMMITTED' ||
    status === 'FULFILLMENT_AT_RISK' ||
    status === 'READY_TO_DISPATCH' ||
    status === 'DISPATCH_BLOCKED' ||
    status === 'CANCELLED'
  ) {
    return status;
  }

  return 'ORDER_CONFIRMED';
}

function prioritizeMessages<T extends { Body?: string }>(messages: T[]): T[] {
  return [...messages].sort(
    (left, right) => messagePriority(right) - messagePriority(left),
  );
}

function messagePriority(message: { Body?: string }): number {
  const event = parseEvent(message.Body);
  return event ? eventPriority(event.event_name) : 0;
}

function eventPriority(eventName: string): number {
  switch (eventName) {
    case 'shipping.dispatch_blocked.v1':
    case 'shipping.shipment_ready_to_dispatch.v1':
    case 'orders.order_cancelled.v1':
    case 'fulfillment.commitment_failed.v1':
      return 100;
    case 'fulfillment.commitment_at_risk.v1':
      return 90;
    case 'fulfillment.commitment_confirmed.v1':
      return 60;
    case 'orders.order_confirmed.v1':
      return 50;
    default:
      return 0;
  }
}

function validIsoOrUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function trackingEventNameValue(value: unknown): TrackingEventName {
  const eventName = stringValue(value);

  if (eventName && isTrackingEventName(eventName)) {
    return eventName;
  }

  return 'orders.order_confirmed.v1';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function uniqueQueueUrls(queueUrls: string[]): string[] {
  return Array.from(new Set(queueUrls));
}

function queueNameFromUrl(queueUrl: string): string {
  return queueUrl.split('/').pop() ?? queueUrl;
}

function queueDepth(attributes: Record<string, string> | undefined): number {
  return (
    numberAttribute(attributes, 'ApproximateNumberOfMessages') +
    numberAttribute(attributes, 'ApproximateNumberOfMessagesNotVisible') +
    numberAttribute(attributes, 'ApproximateNumberOfMessagesDelayed')
  );
}

function numberAttribute(
  attributes: Record<string, string> | undefined,
  name: string,
): number {
  const value = Number(attributes?.[name] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function deadLetterQueueUrl(
  sourceQueueUrl: string,
  redrivePolicy: string | undefined,
): string | undefined {
  if (!redrivePolicy) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(redrivePolicy) as {
      deadLetterTargetArn?: string;
    };
    const queueName = parsed.deadLetterTargetArn?.split(':').pop();

    if (!queueName) {
      return undefined;
    }

    return `${sourceQueueUrl.slice(0, sourceQueueUrl.lastIndexOf('/') + 1)}${queueName}`;
  } catch {
    return undefined;
  }
}

function durationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function durationSeconds(startedAt: number): number {
  return (performance.now() - startedAt) / 1000;
}

function processingFailureCode(error: unknown): string {
  if (error instanceof TrackingEventPublishError) {
    return 'TRACKING_EVENT_QUEUE_FAILED';
  }

  return 'TRACKING_UPDATE_FAILED';
}

function isResourceNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === 'ResourceNotFoundException';
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

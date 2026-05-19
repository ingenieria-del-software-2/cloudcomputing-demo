import {
  CreateQueueCommand,
  DeleteQueueCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FaultInjectionModule } from '../common/fault-injection/fault-injection.module';
import { CreateTransactionUseCase } from './application/create-transaction.use-case';
import { TransactionError } from './application/transaction.errors';
import type {
  CreateTransactionInput,
  TransactionAcceptedResponse,
} from './domain/transaction';
import { TransactionModule } from './transaction.module';

describe('TransactionModule integration', () => {
  const originalEnv = process.env;
  const payload = {
    amount: 100,
    currency: 'ARS',
    description: 'demo',
  };

  let moduleRef: TestingModule;
  let useCase: CreateTransactionUseCase;
  let sqs: SQSClient;
  let queueUrl: string;

  beforeEach(async () => {
    sqs = createSqsClient();
    queueUrl = await createQueue(sqs);
    process.env = {
      ...originalEnv,
      AWS_ACCESS_KEY_ID: 'test',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
      AWS_REGION: 'us-east-1',
      AWS_SECRET_ACCESS_KEY: 'test',
      LEDGER_BASE_URL: originalEnv.LEDGER_BASE_URL ?? 'http://127.0.0.1:3001',
      LEDGER_TIMEOUT_MS: '500',
      SERVICE_VERSION: 'v1',
      SQS_PUBLISH_MAX_ATTEMPTS: '2',
      SQS_PUBLISH_RETRY_DELAY_MS: '0',
      SQS_QUEUE_URL: queueUrl,
    };

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
        }),
        FaultInjectionModule,
        TransactionModule,
      ],
    }).compile();
    useCase = moduleRef.get(CreateTransactionUseCase);
  }, 30000);

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }

    if (queueUrl) {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    }

    process.env = originalEnv;
  }, 30000);

  it('creates a transaction through real module providers', async () => {
    const accepted = await execute(payload, 'key-1', 'req_001');

    expect(accepted).toMatchObject({
      receipt_status: 'queued',
      version: 'v1',
    } satisfies Partial<TransactionAcceptedResponse>);
    expect(accepted.ledger_entry_id).toBe(
      `led_${accepted.operation_id.slice(3)}`,
    );
    expect(await receiveReceiptCommand(sqs, queueUrl)).toMatchObject({
      type: 'GenerateReceiptCommand',
      operation_id: accepted.operation_id,
      transaction_id: accepted.transaction_id,
      ledger_entry_id: accepted.ledger_entry_id,
      amount: 100,
      currency: 'ARS',
      request_id: 'req_001',
      producer_service: 'transaction-api',
      producer_version: 'v1',
    });
  });

  it('replays accepted transactions without calling external providers again', async () => {
    const first = await execute(payload, 'key-replay', 'req_001');
    const second = await execute(payload, 'key-replay', 'req_002');

    expect(second).toEqual(first);
    expect(await receiveReceiptCommand(sqs, queueUrl)).toMatchObject({
      operation_id: first.operation_id,
    });
    await expectNoReceiptCommand(sqs, queueUrl);
  });

  it('rejects idempotency key reuse with a different payload', async () => {
    const accepted = await execute(payload, 'key-conflict', 'req_001');

    await expectProblem(
      execute({ ...payload, amount: 200 }, 'key-conflict', 'req_002'),
      {
        status: 409,
        code: 'IDEMPOTENCY_CONFLICT',
        operationId: accepted.operation_id,
      },
    );
    expect(await receiveReceiptCommand(sqs, queueUrl)).toMatchObject({
      operation_id: accepted.operation_id,
    });
    await expectNoReceiptCommand(sqs, queueUrl);
  });

  it('maps ledger failures before publishing to SQS', async () => {
    process.env.LEDGER_BASE_URL = 'http://127.0.0.1:1';

    await expectProblem(
      execute(payload, 'key-ledger-fail', 'req_ledger_fail'),
      {
        status: 502,
        code: 'LEDGER_FAILED',
        requestId: 'req_ledger_fail',
      },
    );
    await expectNoReceiptCommand(sqs, queueUrl);
  });

  it('retries receipt publish without creating another ledger entry', async () => {
    const missingQueueUrl = `${queueUrl}-missing`;
    process.env.SQS_QUEUE_URL = missingQueueUrl;

    await expectProblem(execute(payload, 'key-sqs-retry', 'req_sqs_1'), {
      status: 503,
      code: 'RECEIPT_QUEUE_FAILED',
    });

    process.env.SQS_QUEUE_URL = queueUrl;
    const accepted = await execute(payload, 'key-sqs-retry', 'req_sqs_2');

    expect(accepted.operation_id).toMatch(/^op_/);
    expect(accepted.ledger_entry_id).toBe(
      `led_${accepted.operation_id.slice(3)}`,
    );
    expect(await receiveReceiptCommand(sqs, queueUrl)).toMatchObject({
      operation_id: accepted.operation_id,
      request_id: 'req_sqs_1',
    });
  });

  function execute(
    body: CreateTransactionInput,
    idempotencyKey: string,
    requestId: string,
  ): Promise<TransactionAcceptedResponse> {
    return useCase.execute({
      body,
      idempotencyKey,
      requestId,
      version: 'v1',
    });
  }
});

function createSqsClient(): SQSClient {
  return new SQSClient({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
  });
}

async function createQueue(client: SQSClient): Promise<string> {
  const response = await client.send(
    new CreateQueueCommand({
      QueueName: `transaction-api-integration-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,
    }),
  );

  if (!response.QueueUrl) {
    throw new Error('MiniStack did not return a QueueUrl');
  }

  return response.QueueUrl;
}

async function receiveReceiptCommand(
  client: SQSClient,
  queue: string,
): Promise<Record<string, unknown>> {
  const response = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: queue,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 2,
    }),
  );
  const message = response.Messages?.[0];

  if (!message?.Body) {
    throw new Error('Expected a receipt command in SQS');
  }

  return parseMessage(message);
}

async function expectNoReceiptCommand(
  client: SQSClient,
  queue: string,
): Promise<void> {
  const response = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: queue,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 1,
    }),
  );

  expect(response.Messages ?? []).toHaveLength(0);
}

function parseMessage(message: Message): Record<string, unknown> {
  return JSON.parse(message.Body ?? '{}') as Record<string, unknown>;
}

async function expectProblem(
  promise: Promise<unknown>,
  expected: Partial<TransactionError>,
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected transaction failure');
  } catch (error) {
    expect(error).toBeInstanceOf(TransactionError);
    expect(error).toMatchObject(expected);
  }
}

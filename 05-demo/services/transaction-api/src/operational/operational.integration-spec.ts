import {
  CreateQueueCommand,
  DeleteQueueCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { OperationalModule } from './operational.module';
import { ReadinessService } from './readiness.service';

describe('OperationalModule integration', () => {
  const originalEnv = process.env;

  let moduleRef: TestingModule;
  let service: ReadinessService;
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
      READY_CHECK_TIMEOUT_MS: '500',
      SERVICE_VERSION: 'v1',
      SQS_QUEUE_URL: queueUrl,
    };
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

  it('returns ready when real probes can reach their dependencies', async () => {
    await compileModule();

    await expect(service.check()).resolves.toEqual({
      status: 'ready',
      dependencies: {
        ledger_service: 'ready',
        sqs: 'ready',
      },
    });
  });

  it('returns not_ready when ledger readiness fails', async () => {
    process.env.LEDGER_BASE_URL = 'http://127.0.0.1:1';
    await compileModule();

    await expect(service.check()).resolves.toEqual({
      status: 'not_ready',
      dependencies: {
        ledger_service: 'not_ready',
        sqs: 'ready',
      },
    });
  });

  it('returns not_ready when SQS readiness fails', async () => {
    process.env.SQS_QUEUE_URL = `${queueUrl}-missing`;
    await compileModule();

    await expect(service.check()).resolves.toEqual({
      status: 'not_ready',
      dependencies: {
        ledger_service: 'ready',
        sqs: 'not_ready',
      },
    });
  });

  async function compileModule(): Promise<void> {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
        }),
        OperationalModule,
      ],
    }).compile();
    service = moduleRef.get(ReadinessService);
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
      QueueName: `operational-integration-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,
    }),
  );

  if (!response.QueueUrl) {
    throw new Error('MiniStack did not return a QueueUrl');
  }

  return response.QueueUrl;
}

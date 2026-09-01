import {
  CreateQueueCommand,
  DeleteQueueCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { OperationalModule } from './operational.module';
import { DB_READINESS_PROBE } from './readiness.probes';
import type { ReadinessProbe } from './readiness.probes';
import { ReadinessService } from './readiness.service';

describe('OperationalModule integration', () => {
  const originalEnv = process.env;

  let moduleRef: TestingModule;
  let service: ReadinessService;
  let sqs: SQSClient;
  let inputQueueUrl: string;
  let outputQueueUrl: string;

  beforeEach(async () => {
    sqs = createSqsClient();
    inputQueueUrl = await createQueue(sqs, 'fulfillment-input');
    outputQueueUrl = await createQueue(sqs, 'fulfillment-output');
    process.env = {
      ...originalEnv,
      AWS_ACCESS_KEY_ID: 'test',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
      AWS_REGION: 'us-east-1',
      AWS_SECRET_ACCESS_KEY: 'test',
      INPUT_SQS_QUEUE_URL: inputQueueUrl,
      READY_CHECK_TIMEOUT_MS: '500',
      SERVICE_VERSION: 'v1',
      SQS_QUEUE_URL: outputQueueUrl,
    };
  }, 30000);

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }

    for (const queueUrl of [inputQueueUrl, outputQueueUrl]) {
      if (queueUrl) {
        await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
      }
    }

    process.env = originalEnv;
  }, 30000);

  it('returns ready when real probes can reach their dependencies', async () => {
    await compileModule();

    await expect(service.check()).resolves.toEqual({
      status: 'ready',
      dependencies: {
        db: 'ready',
        sqs: 'ready',
      },
    });
  });

  it('returns not_ready when SQS readiness fails', async () => {
    process.env.SQS_QUEUE_URL = `${outputQueueUrl}-missing`;
    await compileModule();

    await expect(service.check()).resolves.toEqual({
      status: 'not_ready',
      dependencies: {
        db: 'ready',
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
    })
      .overrideProvider(DB_READINESS_PROBE)
      .useValue(readyProbe())
      .compile();
    service = moduleRef.get(ReadinessService);
  }
});

function readyProbe(): ReadinessProbe {
  return {
    isReady: () => Promise.resolve(true),
  };
}

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

async function createQueue(client: SQSClient, prefix: string): Promise<string> {
  const response = await client.send(
    new CreateQueueCommand({
      QueueName: `${prefix}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,
    }),
  );

  if (!response.QueueUrl) {
    throw new Error('MiniStack did not return a QueueUrl');
  }

  return response.QueueUrl;
}

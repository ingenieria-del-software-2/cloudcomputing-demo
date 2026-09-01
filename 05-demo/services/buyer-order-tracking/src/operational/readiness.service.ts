import { Inject, Injectable } from '@nestjs/common';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import {
  DYNAMODB_READINESS_PROBE,
  SQS_READINESS_PROBE,
} from './readiness.probes';
import type { ReadinessProbe } from './readiness.probes';

export type DependencyReadiness = 'ready' | 'not_ready';

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  dependencies: {
    dynamodb: DependencyReadiness;
    sqs: DependencyReadiness;
  };
}

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DYNAMODB_READINESS_PROBE)
    private readonly dynamodbProbe: ReadinessProbe,
    @Inject(SQS_READINESS_PROBE)
    private readonly sqsProbe: ReadinessProbe,
    private readonly logger: StructuredLoggerService,
  ) {}

  async check(): Promise<ReadinessResponse> {
    const [dynamodbReady, sqsReady] = await Promise.all([
      this.dynamodbProbe.isReady(),
      this.sqsProbe.isReady(),
    ]);
    const response: ReadinessResponse = {
      status: dynamodbReady && sqsReady ? 'ready' : 'not_ready',
      dependencies: {
        dynamodb: readiness(dynamodbReady),
        sqs: readiness(sqsReady),
      },
    };

    if (response.status === 'not_ready') {
      this.logger.error('readiness_failed', {
        status: 503,
        dynamodb: response.dependencies.dynamodb,
        sqs: response.dependencies.sqs,
      });
    }

    return response;
  }
}

function readiness(isReady: boolean): DependencyReadiness {
  return isReady ? 'ready' : 'not_ready';
}

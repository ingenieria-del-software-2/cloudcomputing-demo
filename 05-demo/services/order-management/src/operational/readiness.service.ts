import { Inject, Injectable } from '@nestjs/common';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import { SQS_READINESS_PROBE } from './readiness.probes';
import type { ReadinessProbe } from './readiness.probes';

export type DependencyReadiness = 'ready' | 'not_ready';

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  dependencies: {
    sqs: DependencyReadiness;
  };
}

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(SQS_READINESS_PROBE)
    private readonly sqsProbe: ReadinessProbe,
    private readonly logger: StructuredLoggerService,
  ) {}

  async check(): Promise<ReadinessResponse> {
    const sqsReady = await this.sqsProbe.isReady();
    const response: ReadinessResponse = {
      status: sqsReady ? 'ready' : 'not_ready',
      dependencies: {
        sqs: readiness(sqsReady),
      },
    };

    if (response.status === 'not_ready') {
      this.logger.error('readiness_failed', {
        status: 503,
        sqs: response.dependencies.sqs,
      });
    }

    return response;
  }
}

function readiness(isReady: boolean): DependencyReadiness {
  return isReady ? 'ready' : 'not_ready';
}

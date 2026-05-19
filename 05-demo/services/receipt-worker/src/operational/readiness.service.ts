import { Injectable } from '@nestjs/common';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import { SqsReadinessProbe } from './sqs-readiness.probe';

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  dependencies: {
    sqs: 'ready' | 'not_ready';
  };
}

@Injectable()
export class ReadinessService {
  constructor(
    private readonly sqsProbe: SqsReadinessProbe,
    private readonly logger: StructuredLoggerService,
  ) {}

  async check(): Promise<ReadinessResponse> {
    const sqsReady = await this.sqsProbe.isReady();
    const response: ReadinessResponse = {
      status: sqsReady ? 'ready' : 'not_ready',
      dependencies: {
        sqs: sqsReady ? 'ready' : 'not_ready',
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

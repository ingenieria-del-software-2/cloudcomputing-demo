import { Inject, Injectable } from '@nestjs/common';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import {
  DB_READINESS_PROBE,
  S3_READINESS_PROBE,
  SQS_READINESS_PROBE,
} from './readiness.probes';
import type { ReadinessProbe } from './readiness.probes';

export type DependencyReadiness = 'ready' | 'not_ready';

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  dependencies: {
    db: DependencyReadiness;
    sqs: DependencyReadiness;
    s3: DependencyReadiness;
  };
}

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DB_READINESS_PROBE)
    private readonly dbProbe: ReadinessProbe,
    @Inject(SQS_READINESS_PROBE)
    private readonly sqsProbe: ReadinessProbe,
    @Inject(S3_READINESS_PROBE)
    private readonly s3Probe: ReadinessProbe,
    private readonly logger: StructuredLoggerService,
  ) {}

  async check(): Promise<ReadinessResponse> {
    const [dbReady, sqsReady, s3Ready] = await Promise.all([
      this.dbProbe.isReady(),
      this.sqsProbe.isReady(),
      this.s3Probe.isReady(),
    ]);
    const response: ReadinessResponse = {
      status: dbReady && sqsReady && s3Ready ? 'ready' : 'not_ready',
      dependencies: {
        db: readiness(dbReady),
        sqs: readiness(sqsReady),
        s3: readiness(s3Ready),
      },
    };

    if (response.status === 'not_ready') {
      this.logger.error('readiness_failed', {
        status: 503,
        db: response.dependencies.db,
        sqs: response.dependencies.sqs,
        s3: response.dependencies.s3,
      });
    }

    return response;
  }
}

function readiness(isReady: boolean): DependencyReadiness {
  return isReady ? 'ready' : 'not_ready';
}

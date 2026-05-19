import { Inject, Injectable } from '@nestjs/common';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import {
  LEDGER_READINESS_PROBE,
  SQS_READINESS_PROBE,
} from './readiness.probes';
import type { ReadinessProbe } from './readiness.probes';

export type DependencyReadiness = 'ready' | 'not_ready';

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  dependencies: {
    ledger_service: DependencyReadiness;
    sqs: DependencyReadiness;
  };
}

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(LEDGER_READINESS_PROBE)
    private readonly ledgerProbe: ReadinessProbe,
    @Inject(SQS_READINESS_PROBE)
    private readonly sqsProbe: ReadinessProbe,
    private readonly logger: StructuredLoggerService,
  ) {}

  async check(): Promise<ReadinessResponse> {
    const [ledgerReady, sqsReady] = await Promise.all([
      this.ledgerProbe.isReady(),
      this.sqsProbe.isReady(),
    ]);
    const response: ReadinessResponse = {
      status: ledgerReady && sqsReady ? 'ready' : 'not_ready',
      dependencies: {
        ledger_service: readiness(ledgerReady),
        sqs: readiness(sqsReady),
      },
    };

    if (response.status === 'not_ready') {
      this.logger.error('readiness_failed', {
        status: 503,
        ledger_service: response.dependencies.ledger_service,
        sqs: response.dependencies.sqs,
      });
    }

    return response;
  }
}

function readiness(isReady: boolean): DependencyReadiness {
  return isReady ? 'ready' : 'not_ready';
}

import { StructuredLoggerService } from '../logging/structured-logger.service';
import { ReadinessProbe } from './readiness.probes';
import { ReadinessService } from './readiness.service';

describe('ReadinessService', () => {
  it('returns ready when all dependencies are ready', async () => {
    const logger = loggerMock();
    const service = new ReadinessService(readyProbe(), readyProbe(), logger);

    await expect(service.check()).resolves.toEqual({
      status: 'ready',
      dependencies: {
        ledger_service: 'ready',
        sqs: 'ready',
      },
    });
    expect(logger.error.mock.calls).toHaveLength(0);
  });

  it('returns not_ready and logs failed dependencies', async () => {
    const logError = jest.fn();
    const logger = loggerMock();
    logger.error = logError;
    const service = new ReadinessService(notReadyProbe(), readyProbe(), logger);

    await expect(service.check()).resolves.toEqual({
      status: 'not_ready',
      dependencies: {
        ledger_service: 'not_ready',
        sqs: 'ready',
      },
    });
    expect(logError).toHaveBeenCalledWith('readiness_failed', {
      status: 503,
      ledger_service: 'not_ready',
      sqs: 'ready',
    });
  });
});

function readyProbe(): ReadinessProbe {
  return {
    isReady: () => Promise.resolve(true),
  };
}

function notReadyProbe(): ReadinessProbe {
  return {
    isReady: () => Promise.resolve(false),
  };
}

function loggerMock(): jest.Mocked<StructuredLoggerService> {
  return {
    info: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<StructuredLoggerService>;
}

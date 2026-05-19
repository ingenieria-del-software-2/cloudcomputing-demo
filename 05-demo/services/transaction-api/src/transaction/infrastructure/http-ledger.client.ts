import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LedgerEntryRequest,
  LedgerEntryResponse,
  LedgerPort,
  LedgerPortError,
} from '../application/transaction.ports';

@Injectable()
export class HttpLedgerClient implements LedgerPort {
  constructor(private readonly config: ConfigService) {}

  async createEntry(request: LedgerEntryRequest): Promise<LedgerEntryResponse> {
    const timeoutMs = this.config.get<number>('LEDGER_TIMEOUT_MS', 500);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl()}/ledger/entries`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotencyKey,
          'x-request-id': request.requestId,
        },
        body: JSON.stringify({
          operation_id: request.operationId,
          amount: request.amount,
          currency: request.currency,
        }),
      });

      if (!response.ok) {
        throw new LedgerPortError('failed');
      }

      const body = (await response.json()) as unknown;
      return this.parseResponse(body);
    } catch (error) {
      if (error instanceof LedgerPortError) {
        throw error;
      }

      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw new LedgerPortError('timeout');
      }

      throw new LedgerPortError('failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  private baseUrl(): string {
    return this.config
      .get<string>('LEDGER_BASE_URL', 'http://localhost:3001')
      .replace(/\/$/, '');
  }

  private parseResponse(body: unknown): LedgerEntryResponse {
    if (!isLedgerResponseBody(body)) {
      throw new LedgerPortError('failed');
    }

    return {
      ledgerEntryId: body.ledger_entry_id,
      status: body.status,
    };
  }
}

interface LedgerResponseBody {
  ledger_entry_id: string;
  operation_id: string;
  status: 'created' | 'replayed';
}

function isLedgerResponseBody(body: unknown): body is LedgerResponseBody {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const candidate = body as Partial<LedgerResponseBody>;

  return (
    typeof candidate.ledger_entry_id === 'string' &&
    typeof candidate.operation_id === 'string' &&
    (candidate.status === 'created' || candidate.status === 'replayed')
  );
}

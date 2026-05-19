import { ConfigService } from '@nestjs/config';
import { ReceiptCommand } from '../domain/receipt-command';
import { GenerateReceiptProcessor } from './generate-receipt.processor';
import {
  ProcessedReceiptStore,
  ReceiptEvent,
  ReceiptEventSink,
} from './receipt.ports';

class MemoryStore implements ProcessedReceiptStore {
  private readonly processed = new Map<string, string>();

  has(operationId: string): boolean {
    return this.processed.has(operationId);
  }

  markProcessed(operationId: string, receiptId: string): void {
    this.processed.set(operationId, receiptId);
  }
}

class Events implements ReceiptEventSink {
  readonly events: ReceiptEvent[] = [];

  publish(event: ReceiptEvent): void {
    this.events.push(event);
  }
}

describe('GenerateReceiptProcessor', () => {
  const command: ReceiptCommand = {
    type: 'GenerateReceiptCommand',
    schema_version: '1',
    command_id: 'cmd_001',
    operation_id: 'op_001',
    transaction_id: 'tx_001',
    ledger_entry_id: 'led_001',
    amount: 100,
    currency: 'ARS',
    request_id: 'req_001',
    idempotency_key_hash: 'sha256:abc',
    producer_service: 'transaction-api',
    producer_version: 'v1',
    created_at: '2026-05-04T00:00:00.000Z',
  };

  it('generates a receipt once and dedupes by operation_id', async () => {
    const store = new MemoryStore();
    const events = new Events();
    const processor = new GenerateReceiptProcessor(
      store,
      events,
      new ConfigService({ RECEIPT_PROCESSING_DELAY_MS: '0' }),
    );

    const firstResult = await processor.process(command);

    expect(firstResult.status).toBe('success');
    expect(firstResult.receiptId).toMatch(/^rcpt_/);
    await expect(processor.process(command)).resolves.toEqual({
      status: 'duplicate',
    });

    expect(events.events.map((event) => event.type)).toEqual([
      'receipt_command_received',
      'receipt_generated',
      'receipt_command_received',
      'receipt_duplicate_ignored',
    ]);
  });
});

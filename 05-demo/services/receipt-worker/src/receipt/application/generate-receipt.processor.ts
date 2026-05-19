import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { ReceiptCommand } from '../domain/receipt-command';
import {
  ProcessedReceiptStore,
  ReceiptEventSink,
  ReceiptProcessResult,
  ReceiptProcessor,
} from './receipt.ports';

@Injectable()
export class GenerateReceiptProcessor implements ReceiptProcessor {
  constructor(
    private readonly store: ProcessedReceiptStore,
    private readonly events: ReceiptEventSink,
    private readonly config: ConfigService,
  ) {}

  async process(command: ReceiptCommand): Promise<ReceiptProcessResult> {
    this.events.publish({
      type: 'receipt_command_received',
      requestId: command.request_id,
      operationId: command.operation_id,
      commandId: command.command_id,
      producerVersion: command.producer_version,
    });

    if (this.store.has(command.operation_id)) {
      this.events.publish({
        type: 'receipt_duplicate_ignored',
        requestId: command.request_id,
        operationId: command.operation_id,
        commandId: command.command_id,
        producerVersion: command.producer_version,
      });
      return { status: 'duplicate' };
    }

    await sleep(this.processingDelayMs());

    const receiptId = receiptID(command.operation_id);
    this.store.markProcessed(command.operation_id, receiptId);
    this.events.publish({
      type: 'receipt_generated',
      requestId: command.request_id,
      operationId: command.operation_id,
      commandId: command.command_id,
      receiptId,
      producerVersion: command.producer_version,
    });

    return { status: 'success', receiptId };
  }

  private processingDelayMs(): number {
    const value = Number(
      this.config.get<string>('RECEIPT_PROCESSING_DELAY_MS', '0'),
    );

    if (!Number.isInteger(value) || value < 0) {
      return 0;
    }

    return value;
  }
}

function receiptID(operationId: string): string {
  const digest = createHash('sha256').update(operationId).digest('hex');
  return `rcpt_${digest.slice(0, 16)}`;
}

function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

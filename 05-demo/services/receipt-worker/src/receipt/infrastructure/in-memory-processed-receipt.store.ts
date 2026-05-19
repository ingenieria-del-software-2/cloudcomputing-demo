import { Injectable } from '@nestjs/common';
import { ProcessedReceiptStore } from '../application/receipt.ports';

@Injectable()
export class InMemoryProcessedReceiptStore implements ProcessedReceiptStore {
  private readonly processed = new Map<string, string>();

  has(operationId: string): boolean {
    return this.processed.has(operationId);
  }

  markProcessed(operationId: string, receiptId: string): void {
    this.processed.set(operationId, receiptId);
  }
}

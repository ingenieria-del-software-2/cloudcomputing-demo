import { Injectable } from '@nestjs/common';
import { IdempotencyStore } from '../application/transaction.ports';
import type { IdempotencyRecord } from '../domain/transaction';

@Injectable()
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  get(idempotencyKey: string): IdempotencyRecord | undefined {
    return this.records.get(idempotencyKey);
  }

  set(idempotencyKey: string, record: IdempotencyRecord): void {
    this.records.set(idempotencyKey, record);
  }
}

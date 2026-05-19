import { InMemoryIdempotencyStore } from './in-memory-idempotency.store';
import type { IdempotencyRecord } from '../domain/transaction';

describe('InMemoryIdempotencyStore', () => {
  it('stores records by idempotency key', () => {
    const store = new InMemoryIdempotencyStore();
    const record: IdempotencyRecord = {
      fingerprint: 'fp',
      operationId: 'op_001',
      transactionId: 'tx_001',
      commandId: 'cmd_001',
    };

    store.set('key-1', record);

    expect(store.get('key-1')).toBe(record);
    expect(store.get('missing')).toBeUndefined();
  });
});

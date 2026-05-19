import {
  InvalidReceiptCommandError,
  parseReceiptCommand,
  ReceiptCommand,
} from './receipt-command';

describe('parseReceiptCommand', () => {
  const validCommand: ReceiptCommand = {
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

  it('parses a valid GenerateReceiptCommand', () => {
    expect(parseReceiptCommand(JSON.stringify(validCommand))).toEqual(
      validCommand,
    );
  });

  it('rejects malformed JSON', () => {
    expect(() => parseReceiptCommand('{')).toThrow(InvalidReceiptCommandError);
  });

  it('rejects invalid currency', () => {
    expect(() =>
      parseReceiptCommand(
        JSON.stringify({
          ...validCommand,
          currency: 'ars',
        }),
      ),
    ).toThrow('currency must be a 3-letter uppercase code');
  });
});

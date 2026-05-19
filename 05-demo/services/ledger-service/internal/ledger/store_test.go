package ledger

import (
	"context"
	"errors"
	"testing"
)

func TestMemoryStoreCreateEntryAndReplay(t *testing.T) {
	store := NewMemoryStore()
	command := CreateEntryCommand{
		OperationID:    "op_123",
		Amount:         100,
		Currency:       "ARS",
		IdempotencyKey: "idem-1",
		RequestID:      "req-1",
	}

	created, err := store.CreateEntry(context.Background(), command)
	if err != nil {
		t.Fatalf("create entry: %v", err)
	}
	if created.Replay {
		t.Fatal("first request should not be replay")
	}
	if created.Entry.LedgerEntryID != "led_123" {
		t.Fatalf("unexpected ledger entry id: %s", created.Entry.LedgerEntryID)
	}

	replayed, err := store.CreateEntry(context.Background(), command)
	if err != nil {
		t.Fatalf("replay entry: %v", err)
	}
	if !replayed.Replay {
		t.Fatal("second request should be replay")
	}
	if replayed.Entry != created.Entry {
		t.Fatalf("replay changed entry: %#v != %#v", replayed.Entry, created.Entry)
	}
}

func TestMemoryStoreRejectsIdempotencyConflict(t *testing.T) {
	store := NewMemoryStore()
	command := CreateEntryCommand{
		OperationID:    "op_123",
		Amount:         100,
		Currency:       "ARS",
		IdempotencyKey: "idem-1",
	}

	if _, err := store.CreateEntry(context.Background(), command); err != nil {
		t.Fatalf("create entry: %v", err)
	}

	command.Amount = 200
	_, err := store.CreateEntry(context.Background(), command)
	if !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("expected idempotency conflict, got %v", err)
	}
}

func TestCreateEntryCommandValidation(t *testing.T) {
	tests := []struct {
		name    string
		command CreateEntryCommand
		wantErr error
	}{
		{
			name: "missing idempotency key",
			command: CreateEntryCommand{
				OperationID: "op_123",
				Amount:      100,
				Currency:    "ARS",
			},
			wantErr: ErrMissingIdempotencyKey,
		},
		{
			name: "invalid amount",
			command: CreateEntryCommand{
				OperationID:    "op_123",
				Amount:         0,
				Currency:       "ARS",
				IdempotencyKey: "idem-1",
			},
			wantErr: ErrInvalidInput,
		},
		{
			name: "invalid currency",
			command: CreateEntryCommand{
				OperationID:    "op_123",
				Amount:         100,
				Currency:       "ars",
				IdempotencyKey: "idem-1",
			},
			wantErr: ErrInvalidInput,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.command.Validate()
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("expected %v, got %v", tt.wantErr, err)
			}
		})
	}
}

package ledger

import (
	"context"
	"sync"
	"time"
)

type Store interface {
	CreateEntry(ctx context.Context, command CreateEntryCommand) (Result, error)
}

type MemoryStore struct {
	mu      sync.RWMutex
	records map[string]idempotencyRecord
}

type idempotencyRecord struct {
	fingerprint string
	entry       Entry
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{records: make(map[string]idempotencyRecord)}
}

func (s *MemoryStore) CreateEntry(_ context.Context, command CreateEntryCommand) (Result, error) {
	if err := command.Validate(); err != nil {
		return Result{}, err
	}

	fingerprint := command.Fingerprint()

	s.mu.Lock()
	defer s.mu.Unlock()

	if record, ok := s.records[command.IdempotencyKey]; ok {
		if record.fingerprint != fingerprint {
			return Result{}, ErrIdempotencyConflict
		}
		return Result{Entry: record.entry, Replay: true}, nil
	}

	entry := Entry{
		LedgerEntryID: newLedgerEntryID(command.OperationID),
		OperationID:   command.OperationID,
		Amount:        command.Amount,
		Currency:      command.Currency,
		Status:        "created",
		CreatedAt:     time.Now().UTC(),
	}
	s.records[command.IdempotencyKey] = idempotencyRecord{fingerprint: fingerprint, entry: entry}

	return Result{Entry: entry}, nil
}

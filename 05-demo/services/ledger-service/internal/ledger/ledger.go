package ledger

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

type CreateEntryCommand struct {
	OperationID    string
	Amount         float64
	Currency       string
	IdempotencyKey string
	RequestID      string
}

type Entry struct {
	LedgerEntryID string
	OperationID   string
	Amount        float64
	Currency      string
	Status        string
	CreatedAt     time.Time
}

type Result struct {
	Entry  Entry
	Replay bool
}

func (c CreateEntryCommand) Validate() error {
	if strings.TrimSpace(c.IdempotencyKey) == "" {
		return ErrMissingIdempotencyKey
	}
	if strings.TrimSpace(c.OperationID) == "" {
		return fmt.Errorf("operation_id is required: %w", ErrInvalidInput)
	}
	if c.Amount <= 0 {
		return fmt.Errorf("amount must be greater than zero: %w", ErrInvalidInput)
	}
	if !validCurrency(c.Currency) {
		return fmt.Errorf("currency must be a 3-letter uppercase code: %w", ErrInvalidInput)
	}
	return nil
}

func (c CreateEntryCommand) Fingerprint() string {
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s|%.8f|%s", c.OperationID, c.Amount, c.Currency)))
	return hex.EncodeToString(hash[:])
}

func newLedgerEntryID(operationID string) string {
	clean := strings.TrimSpace(operationID)
	if strings.HasPrefix(clean, "op_") && len(clean) > 3 {
		return "led_" + strings.TrimPrefix(clean, "op_")
	}

	hash := sha256.Sum256([]byte(clean))
	return "led_" + hex.EncodeToString(hash[:8])
}

func validCurrency(value string) bool {
	if len(value) != 3 {
		return false
	}
	for _, r := range value {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}

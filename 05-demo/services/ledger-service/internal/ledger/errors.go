package ledger

import "errors"

var (
	ErrInvalidInput          = errors.New("invalid input")
	ErrMissingIdempotencyKey = errors.New("missing idempotency key")
	ErrIdempotencyConflict   = errors.New("idempotency conflict")
)

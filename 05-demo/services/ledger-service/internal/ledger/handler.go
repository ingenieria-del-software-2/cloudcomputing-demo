package ledger

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/eduardocusihuaman/belo/services/ledger-service/internal/platform/fault"
	"github.com/eduardocusihuaman/belo/services/ledger-service/internal/platform/httperr"
)

type FaultInjector interface {
	BeforeRequest(ctx context.Context) error
}

type DurationCalculator interface {
	Calculate() time.Duration
}

type HandlerConfig struct {
	ServiceVersion  string
	GitCommit       string
	FaultInjector   FaultInjector
	RequestDuration DurationCalculator
}

type Handler struct {
	store   Store
	metrics *Metrics
	logger  *slog.Logger
	cfg     HandlerConfig
}

type createEntryRequest struct {
	OperationID string  `json:"operation_id"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
}

type ledgerEntryResponse struct {
	LedgerEntryID string `json:"ledger_entry_id"`
	OperationID   string `json:"operation_id"`
	Status        string `json:"status"`
}

func NewHandler(store Store, metrics *Metrics, logger *slog.Logger, cfg HandlerConfig) *Handler {
	if cfg.FaultInjector == nil {
		cfg.FaultInjector = noFaultInjector{}
	}
	if cfg.RequestDuration == nil {
		cfg.RequestDuration = noDuration{}
	}

	return &Handler{store: store, metrics: metrics, logger: logger, cfg: cfg}
}

func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", h.health)
	mux.HandleFunc("GET /readyz", h.ready)
	mux.HandleFunc("GET /version", h.version)
	mux.Handle("GET /metrics", h.metrics.Handler())
	mux.HandleFunc("POST /ledger/entries", h.createEntry)

	return h.metrics.Middleware(h.cfg.ServiceVersion, mux)
}

func (h *Handler) health(w http.ResponseWriter, _ *http.Request) {
	httperr.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) ready(w http.ResponseWriter, _ *http.Request) {
	httperr.JSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (h *Handler) version(w http.ResponseWriter, _ *http.Request) {
	httperr.JSON(w, http.StatusOK, map[string]string{
		"service": "ledger-service",
		"version": h.cfg.ServiceVersion,
		"commit":  h.cfg.GitCommit,
	})
}

func (h *Handler) createEntry(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	requestID := requestID(r)
	if err := h.cfg.FaultInjector.BeforeRequest(r.Context()); err != nil {
		h.writeInjectedFault(w, err, requestID)
		return
	}

	var body createEntryRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		h.metrics.RecordLedgerEntry("invalid")
		httperr.ProblemJSON(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request body", requestID)
		return
	}

	command := CreateEntryCommand{
		OperationID:    strings.TrimSpace(body.OperationID),
		Amount:         body.Amount,
		Currency:       strings.TrimSpace(body.Currency),
		IdempotencyKey: strings.TrimSpace(r.Header.Get("Idempotency-Key")),
		RequestID:      requestID,
	}
	result, err := h.store.CreateEntry(r.Context(), command)
	if err != nil {
		h.writeCreateEntryError(w, err, requestID)
		return
	}

	status := http.StatusCreated
	entryStatus := "created"
	metricStatus := "created"
	if result.Replay {
		status = http.StatusOK
		entryStatus = "replayed"
		metricStatus = "replayed"
	}
	if err := h.sleepForSyntheticDuration(r.Context(), startedAt); err != nil {
		return
	}

	h.metrics.RecordLedgerEntry(metricStatus)
	h.logger.InfoContext(r.Context(), "ledger_entry_"+entryStatus,
		slog.String("request_id", requestID),
		slog.String("operation_id", result.Entry.OperationID),
		slog.String("ledger_entry_id", result.Entry.LedgerEntryID),
		slog.String("status", entryStatus),
	)
	httperr.JSON(w, status, ledgerEntryResponse{
		LedgerEntryID: result.Entry.LedgerEntryID,
		OperationID:   result.Entry.OperationID,
		Status:        entryStatus,
	})
}

func (h *Handler) writeInjectedFault(w http.ResponseWriter, err error, requestID string) {
	faultErr, ok := err.(*fault.Error)
	if !ok {
		h.metrics.RecordLedgerEntry("failure")
		httperr.ProblemJSON(w, http.StatusInternalServerError, "LEDGER_INTERNAL_ERROR", "failed to create ledger entry", requestID)
		return
	}

	metricStatus := "injected_failure"
	responseCode := "INJECTED_FAILURE"
	if faultErr.Kind == fault.KindRateLimited {
		metricStatus = "rate_limited"
		responseCode = "RATE_LIMITED"
	}

	h.metrics.RecordLedgerEntry(metricStatus)
	h.logger.Warn("ledger_fault_injected",
		slog.String("request_id", requestID),
		slog.String("kind", faultErr.Kind),
		slog.Int("status", faultErr.Code),
	)
	httperr.ProblemJSON(w, faultErr.Code, responseCode, faultErr.Message, requestID)
}

func (h *Handler) sleepForSyntheticDuration(ctx context.Context, startedAt time.Time) error {
	targetDuration := h.cfg.RequestDuration.Calculate()
	remaining := targetDuration - time.Since(startedAt)
	if remaining <= 0 {
		return nil
	}

	timer := time.NewTimer(remaining)
	defer timer.Stop()

	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (h *Handler) writeCreateEntryError(w http.ResponseWriter, err error, requestID string) {
	switch {
	case errors.Is(err, ErrMissingIdempotencyKey):
		h.metrics.RecordLedgerEntry("invalid")
		httperr.ProblemJSON(w, http.StatusBadRequest, "INVALID_REQUEST", "Idempotency-Key header is required", requestID)
	case errors.Is(err, ErrInvalidInput):
		h.metrics.RecordLedgerEntry("invalid")
		httperr.ProblemJSON(w, http.StatusBadRequest, "INVALID_REQUEST", strings.TrimSuffix(err.Error(), ": invalid input"), requestID)
	case errors.Is(err, ErrIdempotencyConflict):
		h.metrics.RecordLedgerEntry("idempotency_conflict")
		httperr.ProblemJSON(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key already used with a different payload", requestID)
	default:
		h.metrics.RecordLedgerEntry("failure")
		httperr.ProblemJSON(w, http.StatusInternalServerError, "LEDGER_INTERNAL_ERROR", "failed to create ledger entry", requestID)
	}
}

func requestID(r *http.Request) string {
	requestID := strings.TrimSpace(r.Header.Get("x-request-id"))
	if requestID == "" {
		return "unknown"
	}
	return requestID
}

type noFaultInjector struct{}

func (noFaultInjector) BeforeRequest(context.Context) error { return nil }

type noDuration struct{}

func (noDuration) Calculate() time.Duration { return 0 }

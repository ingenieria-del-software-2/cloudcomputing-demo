package ledger

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/eduardocusihuaman/belo/services/ledger-service/internal/platform/fault"
)

func TestHandlerOperationalEndpoints(t *testing.T) {
	handler := newTestHandler()

	tests := []struct {
		path   string
		status int
		body   string
	}{
		{path: "/healthz", status: http.StatusOK, body: `"status":"ok"`},
		{path: "/readyz", status: http.StatusOK, body: `"status":"ready"`},
		{path: "/version", status: http.StatusOK, body: `"service":"ledger-service"`},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, tt.path, nil)

			handler.ServeHTTP(response, request)

			if response.Code != tt.status {
				t.Fatalf("expected status %d, got %d", tt.status, response.Code)
			}
			if !strings.Contains(response.Body.String(), tt.body) {
				t.Fatalf("expected body to contain %q, got %s", tt.body, response.Body.String())
			}
		})
	}
}

func TestHandlerCreateEntryAndReplay(t *testing.T) {
	handler := newTestHandler()

	first := postLedgerEntry(t, handler, "idem-1", `{"operation_id":"op_abc","amount":100,"currency":"ARS"}`)
	if first.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", first.Code, first.Body.String())
	}

	var firstBody ledgerEntryResponse
	decodeResponse(t, first.Body, &firstBody)
	if firstBody.LedgerEntryID != "led_abc" || firstBody.Status != "created" {
		t.Fatalf("unexpected first response: %#v", firstBody)
	}

	second := postLedgerEntry(t, handler, "idem-1", `{"operation_id":"op_abc","amount":100,"currency":"ARS"}`)
	if second.Code != http.StatusOK {
		t.Fatalf("expected 200 replay, got %d: %s", second.Code, second.Body.String())
	}

	var secondBody ledgerEntryResponse
	decodeResponse(t, second.Body, &secondBody)
	if secondBody.LedgerEntryID != firstBody.LedgerEntryID || secondBody.Status != "replayed" {
		t.Fatalf("unexpected replay response: %#v", secondBody)
	}
}

func TestHandlerRejectsIdempotencyConflict(t *testing.T) {
	handler := newTestHandler()

	first := postLedgerEntry(t, handler, "idem-1", `{"operation_id":"op_abc","amount":100,"currency":"ARS"}`)
	if first.Code != http.StatusCreated {
		t.Fatalf("expected setup 201, got %d", first.Code)
	}

	conflict := postLedgerEntry(t, handler, "idem-1", `{"operation_id":"op_abc","amount":200,"currency":"ARS"}`)
	if conflict.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", conflict.Code, conflict.Body.String())
	}
	if !strings.Contains(conflict.Body.String(), "IDEMPOTENCY_CONFLICT") {
		t.Fatalf("expected conflict code, got %s", conflict.Body.String())
	}
}

func TestHandlerExposesPrometheusMetrics(t *testing.T) {
	handler := newTestHandler()

	created := postLedgerEntry(t, handler, "idem-1", `{"operation_id":"op_abc","amount":100,"currency":"ARS"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", created.Code)
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected metrics 200, got %d", response.Code)
	}
	metrics := response.Body.String()
	if !strings.Contains(metrics, `ledger_entries_total{service="ledger-service",status="created"} 1`) {
		t.Fatalf("missing ledger metric in:\n%s", metrics)
	}
	if !strings.Contains(metrics, `build_info{commit="test",service="ledger-service",version="stable"} 1`) {
		t.Fatalf("missing build_info metric in:\n%s", metrics)
	}
}

func TestHandlerDoesNotInjectFaultsIntoOperationalEndpoints(t *testing.T) {
	handler := newTestHandlerWithConfig(HandlerConfig{
		FaultInjector: fakeFaultInjector{err: &fault.Error{Kind: fault.KindInjectedFailure, Code: http.StatusBadGateway, Message: fault.MessageInjectedFailure}},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected healthz unaffected by fault injection, got %d", response.Code)
	}
}

func TestHandlerReturnsInjectedFaultsForLedgerEntries(t *testing.T) {
	handler := newTestHandlerWithConfig(HandlerConfig{
		FaultInjector: fakeFaultInjector{err: &fault.Error{Kind: fault.KindInjectedFailure, Code: http.StatusBadGateway, Message: fault.MessageInjectedFailure}},
	})

	response := postLedgerEntry(t, handler, "idem-1", `{"operation_id":"op_abc","amount":100,"currency":"ARS"}`)
	if response.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 injected fault, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "INJECTED_FAILURE") {
		t.Fatalf("expected injected failure response, got %s", response.Body.String())
	}
}

func TestHandlerReturnsRateLimitFaultsForLedgerEntries(t *testing.T) {
	handler := newTestHandlerWithConfig(HandlerConfig{
		FaultInjector: fakeFaultInjector{err: &fault.Error{Kind: fault.KindRateLimited, Code: http.StatusTooManyRequests, Message: fault.MessageRateLimited}},
	})

	response := postLedgerEntry(t, handler, "idem-1", `{"operation_id":"op_abc","amount":100,"currency":"ARS"}`)
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 rate limit, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "RATE_LIMITED") {
		t.Fatalf("expected rate limited response, got %s", response.Body.String())
	}
}

func TestHandlerAppliesSyntheticDurationToSuccessfulLedgerEntries(t *testing.T) {
	handler := newTestHandlerWithConfig(HandlerConfig{
		RequestDuration: fakeDuration{duration: 30 * time.Millisecond},
	})

	startedAt := time.Now()
	response := postLedgerEntry(t, handler, "idem-1", `{"operation_id":"op_abc","amount":100,"currency":"ARS"}`)
	elapsed := time.Since(startedAt)

	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	if elapsed < 20*time.Millisecond {
		t.Fatalf("expected synthetic latency, elapsed %s", elapsed)
	}
}

func newTestHandler() http.Handler {
	return newTestHandlerWithConfig(HandlerConfig{})
}

func newTestHandlerWithConfig(cfg HandlerConfig) http.Handler {
	if cfg.ServiceVersion == "" {
		cfg.ServiceVersion = "stable"
	}
	if cfg.GitCommit == "" {
		cfg.GitCommit = "test"
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	metrics := NewMetrics(cfg.ServiceVersion, cfg.GitCommit)
	store := NewMemoryStore()
	return NewHandler(store, metrics, logger, cfg).Routes()
}

func postLedgerEntry(t *testing.T, handler http.Handler, idempotencyKey string, body string) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(http.MethodPost, "/ledger/entries", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", idempotencyKey)
	request.Header.Set("x-request-id", "req_test")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)
	return response
}

func decodeResponse(t *testing.T, body *bytes.Buffer, value any) {
	t.Helper()
	if err := json.NewDecoder(body).Decode(value); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}

type fakeFaultInjector struct {
	err error
}

func (f fakeFaultInjector) BeforeRequest(context.Context) error {
	return f.err
}

type fakeDuration struct {
	duration time.Duration
}

func (f fakeDuration) Calculate() time.Duration {
	return f.duration
}

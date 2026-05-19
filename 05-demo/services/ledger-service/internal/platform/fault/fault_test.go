package fault

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestInjectorInjectsHTTPErrorByRate(t *testing.T) {
	injector := NewInjector(Config{ErrorRate: 5, ErrorCode: http.StatusBadGateway})

	if err := injector.BeforeRequest(context.Background()); err != nil {
		t.Fatalf("first request should pass, got %v", err)
	}

	err := injector.BeforeRequest(context.Background())
	faultErr := assertFaultError(t, err)
	if faultErr.Kind != KindInjectedFailure || faultErr.Code != http.StatusBadGateway {
		t.Fatalf("unexpected fault: %#v", faultErr)
	}
	if faultErr.Message != MessageInjectedFailure {
		t.Fatalf("unexpected message: %s", faultErr.Message)
	}
}

func TestInjectorTreatsErrorRateAsFailuresOutOfTen(t *testing.T) {
	injector := NewInjector(Config{ErrorRate: 2, ErrorCode: http.StatusInternalServerError})
	failures := 0

	for request := 1; request <= 10; request++ {
		err := injector.BeforeRequest(context.Background())
		failed := err != nil
		expectedFailure := request == 5 || request == 10

		if failed != expectedFailure {
			t.Fatalf("request %d failure=%t, expected %t", request, failed, expectedFailure)
		}
		if failed {
			assertFaultError(t, err)
			failures++
		}
	}

	if failures != 2 {
		t.Fatalf("expected 2 failures, got %d", failures)
	}
}

func TestInjectorInjectsDelayedError(t *testing.T) {
	injector := NewInjector(Config{
		ErrorRate:  10,
		ErrorType:  TypeDelay,
		ErrorCode:  http.StatusServiceUnavailable,
		ErrorDelay: 250 * time.Millisecond,
	})
	var slept time.Duration
	injector.sleep = func(_ context.Context, duration time.Duration) error {
		slept = duration
		return nil
	}

	err := injector.BeforeRequest(context.Background())
	faultErr := assertFaultError(t, err)
	if faultErr.Kind != KindInjectedFailure || faultErr.Message != MessageInjectedDelay {
		t.Fatalf("unexpected delayed fault: %#v", faultErr)
	}
	if slept != 250*time.Millisecond {
		t.Fatalf("expected 250ms sleep, got %s", slept)
	}
}

func TestInjectorRateLimits(t *testing.T) {
	injector := NewInjector(Config{RateLimit: 1, RateLimitCode: http.StatusTooManyRequests})
	now := time.Unix(100, 0)
	injector.now = func() time.Time { return now }

	if err := injector.BeforeRequest(context.Background()); err != nil {
		t.Fatalf("first request should pass, got %v", err)
	}

	err := injector.BeforeRequest(context.Background())
	faultErr := assertFaultError(t, err)
	if faultErr.Kind != KindRateLimited || faultErr.Code != http.StatusTooManyRequests {
		t.Fatalf("unexpected rate limit fault: %#v", faultErr)
	}
}

func TestInjectorNormalizesUnsafeConfig(t *testing.T) {
	injector := NewInjector(Config{ErrorRate: 20, ErrorCode: 200, RateLimitCode: 99})

	err := injector.BeforeRequest(context.Background())
	faultErr := assertFaultError(t, err)
	if faultErr.Code != http.StatusInternalServerError {
		t.Fatalf("expected default error code, got %d", faultErr.Code)
	}
	if injector.cfg.RateLimitCode != http.StatusServiceUnavailable {
		t.Fatalf("expected default rate limit code, got %d", injector.cfg.RateLimitCode)
	}
}

func assertFaultError(t *testing.T, err error) *Error {
	t.Helper()
	if err == nil {
		t.Fatal("expected fault error, got nil")
	}

	var faultErr *Error
	if !errors.As(err, &faultErr) {
		t.Fatalf("expected *Error, got %T", err)
	}

	return faultErr
}

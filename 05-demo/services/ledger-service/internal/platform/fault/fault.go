package fault

import (
	"context"
	"math"
	"net/http"
	"sync"
	"time"
)

const (
	TypeHTTPError = "http_error"
	TypeDelay     = "delay"

	KindInjectedFailure = "injected_failure"
	KindRateLimited     = "rate_limited"

	MessageInjectedFailure = "Service error automatically injected"
	MessageInjectedDelay   = "Service delay automatically injected"
	MessageRateLimited     = "Service exceeded rate limit"

	errorRateWindow = 10
)

type Config struct {
	ErrorRate     float64
	ErrorType     string
	ErrorCode     int
	ErrorDelay    time.Duration
	RateLimit     float64
	RateLimitCode int
}

type Error struct {
	Kind    string
	Code    int
	Message string
}

func (e *Error) Error() string {
	return e.Message
}

type Injector struct {
	mu sync.Mutex

	cfg Config

	requestCount int
	tokens       float64
	lastRefill   time.Time
	capacity     float64

	now   func() time.Time
	sleep func(context.Context, time.Duration) error
}

func NewInjector(cfg Config) *Injector {
	return &Injector{
		cfg:      normalizedConfig(cfg),
		now:      time.Now,
		sleep:    sleepContext,
		capacity: rateLimitCapacity(cfg.RateLimit),
	}
}

func (i *Injector) BeforeRequest(ctx context.Context) error {
	if err := i.rateLimit(); err != nil {
		return err
	}

	err := i.injectedFault()
	if err == nil {
		return nil
	}

	faultErr, ok := err.(*Error)
	if !ok {
		return err
	}
	if faultErr.Kind == KindInjectedFailure && i.cfg.ErrorType == TypeDelay {
		if sleepErr := i.sleep(ctx, i.cfg.ErrorDelay); sleepErr != nil {
			return sleepErr
		}
	}

	return faultErr
}

func (i *Injector) rateLimit() error {
	i.mu.Lock()
	defer i.mu.Unlock()

	if i.cfg.RateLimit <= 0 {
		return nil
	}

	now := i.now()
	if i.lastRefill.IsZero() {
		i.tokens = i.capacity
		i.lastRefill = now
	}

	elapsed := now.Sub(i.lastRefill).Seconds()
	i.tokens = math.Min(i.capacity, i.tokens+elapsed*i.cfg.RateLimit)
	i.lastRefill = now

	if i.tokens >= 1 {
		i.tokens--
		return nil
	}

	return &Error{Kind: KindRateLimited, Code: i.cfg.RateLimitCode, Message: MessageRateLimited}
}

func (i *Injector) injectedFault() error {
	i.mu.Lock()
	defer i.mu.Unlock()

	if i.cfg.ErrorRate <= 0 {
		return nil
	}

	i.requestCount++
	if i.shouldInject() {
		message := MessageInjectedFailure
		if i.cfg.ErrorType == TypeDelay {
			message = MessageInjectedDelay
		}

		return &Error{Kind: KindInjectedFailure, Code: i.cfg.ErrorCode, Message: message}
	}

	return nil
}

func (i *Injector) shouldInject() bool {
	failuresPerWindow := int(math.Floor(i.cfg.ErrorRate))
	if failuresPerWindow <= 0 {
		return false
	}
	if failuresPerWindow >= errorRateWindow {
		return true
	}

	return (i.requestCount*failuresPerWindow)%errorRateWindow < failuresPerWindow
}

func normalizedConfig(cfg Config) Config {
	if cfg.ErrorRate < 0 {
		cfg.ErrorRate = 0
	}
	if cfg.ErrorRate > errorRateWindow {
		cfg.ErrorRate = errorRateWindow
	}
	if cfg.ErrorType != TypeDelay {
		cfg.ErrorType = TypeHTTPError
	}
	if !validStatusCode(cfg.ErrorCode) {
		cfg.ErrorCode = http.StatusInternalServerError
	}
	if cfg.ErrorDelay < 0 {
		cfg.ErrorDelay = 0
	}
	if cfg.RateLimit < 0 {
		cfg.RateLimit = 0
	}
	if !validStatusCode(cfg.RateLimitCode) {
		cfg.RateLimitCode = http.StatusServiceUnavailable
	}

	return cfg
}

func validStatusCode(code int) bool {
	return code >= 400 && code <= 599
}

func rateLimitCapacity(rateLimit float64) float64 {
	if rateLimit <= 0 {
		return 0
	}

	return math.Max(1, math.Floor(rateLimit))
}

func sleepContext(ctx context.Context, duration time.Duration) error {
	if duration <= 0 {
		return nil
	}

	timer := time.NewTimer(duration)
	defer timer.Stop()

	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

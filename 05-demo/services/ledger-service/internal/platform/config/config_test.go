package config

import (
	"log/slog"
	"net/http"
	"testing"
	"time"
)

func TestLoadLedgerConfigParsesFaultAndTimingEnv(t *testing.T) {
	t.Setenv("HOST", "127.0.0.1")
	t.Setenv("PORT", "3999")
	t.Setenv("SERVICE_VERSION", "stable")
	t.Setenv("GIT_COMMIT", "test")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("TIMING_50_PERCENTILE", "10ms")
	t.Setenv("TIMING_90_PERCENTILE", "20ms")
	t.Setenv("TIMING_99_PERCENTILE", "30ms")
	t.Setenv("TIMING_VARIANCE", "25")
	t.Setenv("ERROR_RATE", "2")
	t.Setenv("ERROR_TYPE", "delay")
	t.Setenv("ERROR_CODE", "502")
	t.Setenv("ERROR_DELAY", "40ms")
	t.Setenv("RATE_LIMIT", "10")
	t.Setenv("RATE_LIMIT_CODE", "429")

	cfg, err := LoadLedgerConfig()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Addr != "127.0.0.1:3999" {
		t.Fatalf("unexpected addr: %s", cfg.Addr)
	}
	if cfg.LogLevel != slog.LevelDebug {
		t.Fatalf("unexpected log level: %s", cfg.LogLevel)
	}
	if cfg.Timing50Percentile != 10*time.Millisecond || cfg.Timing90Percentile != 20*time.Millisecond || cfg.Timing99Percentile != 30*time.Millisecond {
		t.Fatalf("unexpected timing config: %#v", cfg)
	}
	if cfg.TimingVariance != 25 || cfg.ErrorRate != 2 || cfg.ErrorType != "delay" || cfg.ErrorCode != http.StatusBadGateway || cfg.ErrorDelay != 40*time.Millisecond || cfg.RateLimit != 10 || cfg.RateLimitCode != http.StatusTooManyRequests {
		t.Fatalf("unexpected fault config: %#v", cfg)
	}
}

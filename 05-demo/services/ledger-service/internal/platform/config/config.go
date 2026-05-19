package config

import (
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	goenv "github.com/caarlos0/env/v11"
)

type LedgerConfig struct {
	Addr            string
	ServiceVersion  string
	GitCommit       string
	LogLevel        slog.Level
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ShutdownTimeout time.Duration

	Timing50Percentile time.Duration
	Timing90Percentile time.Duration
	Timing99Percentile time.Duration
	TimingVariance     int

	ErrorRate     float64
	ErrorType     string
	ErrorCode     int
	ErrorDelay    time.Duration
	RateLimit     float64
	RateLimitCode int
}

type ledgerEnv struct {
	Host            string        `env:"HOST" envDefault:"0.0.0.0"`
	Port            string        `env:"PORT" envDefault:"3001"`
	ServiceVersion  string        `env:"SERVICE_VERSION" envDefault:"stable"`
	GitCommit       string        `env:"GIT_COMMIT" envDefault:"local"`
	LogLevel        string        `env:"LOG_LEVEL" envDefault:"info"`
	ReadTimeout     time.Duration `env:"READ_TIMEOUT" envDefault:"5s"`
	WriteTimeout    time.Duration `env:"WRITE_TIMEOUT" envDefault:"5s"`
	IdleTimeout     time.Duration `env:"IDLE_TIMEOUT" envDefault:"60s"`
	ShutdownTimeout time.Duration `env:"SHUTDOWN_TIMEOUT" envDefault:"10s"`

	Timing50Percentile time.Duration `env:"TIMING_50_PERCENTILE" envDefault:"0s"`
	Timing90Percentile time.Duration `env:"TIMING_90_PERCENTILE" envDefault:"0s"`
	Timing99Percentile time.Duration `env:"TIMING_99_PERCENTILE" envDefault:"0s"`
	TimingVariance     int           `env:"TIMING_VARIANCE" envDefault:"0"`

	ErrorRate     float64       `env:"ERROR_RATE" envDefault:"0"`
	ErrorType     string        `env:"ERROR_TYPE" envDefault:"http_error"`
	ErrorCode     int           `env:"ERROR_CODE" envDefault:"500"`
	ErrorDelay    time.Duration `env:"ERROR_DELAY" envDefault:"0s"`
	RateLimit     float64       `env:"RATE_LIMIT" envDefault:"0"`
	RateLimitCode int           `env:"RATE_LIMIT_CODE" envDefault:"503"`
}

func LoadLedgerConfig() (LedgerConfig, error) {
	var raw ledgerEnv
	if err := goenv.Parse(&raw); err != nil {
		return LedgerConfig{}, fmt.Errorf("parse ledger config: %w", err)
	}

	return LedgerConfig{
		Addr:            net.JoinHostPort(raw.Host, raw.Port),
		ServiceVersion:  raw.ServiceVersion,
		GitCommit:       raw.GitCommit,
		LogLevel:        logLevel(raw.LogLevel),
		ReadTimeout:     raw.ReadTimeout,
		WriteTimeout:    raw.WriteTimeout,
		IdleTimeout:     raw.IdleTimeout,
		ShutdownTimeout: raw.ShutdownTimeout,

		Timing50Percentile: raw.Timing50Percentile,
		Timing90Percentile: raw.Timing90Percentile,
		Timing99Percentile: raw.Timing99Percentile,
		TimingVariance:     raw.TimingVariance,

		ErrorRate:     raw.ErrorRate,
		ErrorType:     raw.ErrorType,
		ErrorCode:     raw.ErrorCode,
		ErrorDelay:    raw.ErrorDelay,
		RateLimit:     raw.RateLimit,
		RateLimitCode: raw.RateLimitCode,
	}, nil
}

func logLevel(value string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

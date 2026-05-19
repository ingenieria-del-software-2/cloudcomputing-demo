package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/eduardocusihuaman/belo/services/ledger-service/internal/ledger"
	"github.com/eduardocusihuaman/belo/services/ledger-service/internal/platform/config"
	"github.com/eduardocusihuaman/belo/services/ledger-service/internal/platform/fault"
	"github.com/eduardocusihuaman/belo/services/ledger-service/internal/platform/httpserver"
	"github.com/eduardocusihuaman/belo/services/ledger-service/internal/platform/timing"
)

func main() {
	cfg, err := config.LoadLedgerConfig()
	if err != nil {
		slog.Error("ledger-service config failed", slog.String("error", err.Error()))
		os.Exit(1)
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(logger)

	metrics := ledger.NewMetrics(cfg.ServiceVersion, cfg.GitCommit)
	store := ledger.NewMemoryStore()
	faultInjector := fault.NewInjector(fault.Config{
		ErrorRate:     cfg.ErrorRate,
		ErrorType:     cfg.ErrorType,
		ErrorCode:     cfg.ErrorCode,
		ErrorDelay:    cfg.ErrorDelay,
		RateLimit:     cfg.RateLimit,
		RateLimitCode: cfg.RateLimitCode,
	})
	requestDuration := timing.NewRequestDuration(
		cfg.Timing50Percentile,
		cfg.Timing90Percentile,
		cfg.Timing99Percentile,
		cfg.TimingVariance,
	)
	handler := ledger.NewHandler(store, metrics, logger, ledger.HandlerConfig{
		ServiceVersion:  cfg.ServiceVersion,
		GitCommit:       cfg.GitCommit,
		FaultInjector:   faultInjector,
		RequestDuration: requestDuration,
	})

	server := httpserver.New(httpserver.Config{
		Addr:         cfg.Addr,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
		Handler:      handler.Routes(),
	})

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("ledger-service starting", slog.String("addr", cfg.Addr))
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("ledger-service failed", slog.String("error", err.Error()))
			stop()
		}
	}()

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("ledger-service shutdown failed", slog.String("error", err.Error()))
		os.Exit(1)
	}

	logger.Info("ledger-service stopped", slog.Duration("timeout", cfg.ShutdownTimeout))
}

package ledger

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
	registry       *prometheus.Registry
	httpRequests   *prometheus.CounterVec
	httpDuration   *prometheus.HistogramVec
	ledgerEntries  *prometheus.CounterVec
	metricsHandler http.Handler
}

func NewMetrics(version, commit string) *Metrics {
	registry := prometheus.NewRegistry()

	httpRequests := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total HTTP requests.",
	}, []string{"service", "route", "method", "status", "version"})
	httpDuration := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request duration in seconds.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
	}, []string{"service", "route", "method", "status", "version"})
	ledgerEntries := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "ledger_entries_total",
		Help: "Total ledger entry outcomes.",
	}, []string{"service", "status"})
	buildInfo := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "build_info",
		Help: "Build and version metadata.",
	}, []string{"service", "version", "commit"})

	registry.MustRegister(httpRequests, httpDuration, ledgerEntries, buildInfo)
	buildInfo.WithLabelValues("ledger-service", version, commit).Set(1)

	return &Metrics{
		registry:       registry,
		httpRequests:   httpRequests,
		httpDuration:   httpDuration,
		ledgerEntries:  ledgerEntries,
		metricsHandler: promhttp.HandlerFor(registry, promhttp.HandlerOpts{}),
	}
}

func (m *Metrics) Handler() http.Handler {
	return m.metricsHandler
}

func (m *Metrics) Middleware(version string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(recorder, r)

		status := strconv.Itoa(recorder.status)
		route := routeName(r)
		m.httpRequests.WithLabelValues("ledger-service", route, r.Method, status, version).Inc()
		m.httpDuration.WithLabelValues("ledger-service", route, r.Method, status, version).Observe(time.Since(start).Seconds())
	})
}

func (m *Metrics) RecordLedgerEntry(status string) {
	m.ledgerEntries.WithLabelValues("ledger-service", status).Inc()
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func routeName(r *http.Request) string {
	switch r.URL.Path {
	case "/healthz":
		return "/healthz"
	case "/readyz":
		return "/readyz"
	case "/version":
		return "/version"
	case "/metrics":
		return "/metrics"
	case "/ledger/entries":
		return "/ledger/entries"
	default:
		return "unknown"
	}
}

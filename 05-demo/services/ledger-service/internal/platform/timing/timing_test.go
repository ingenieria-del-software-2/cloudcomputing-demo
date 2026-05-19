package timing

import (
	"testing"
	"time"
)

func TestRequestDurationFallsBackToPreviousPercentile(t *testing.T) {
	duration := NewRequestDuration(20*time.Millisecond, 0, 0, 0)
	duration.randomFunc = func(int) int { return 95 }

	if got := duration.Calculate(); got != 20*time.Millisecond {
		t.Fatalf("expected p99 fallback to p50, got %s", got)
	}
}

func TestRequestDurationSelectsPercentile(t *testing.T) {
	tests := []struct {
		name       string
		percentile int
		want       time.Duration
	}{
		{name: "p50", percentile: 50, want: 10 * time.Millisecond},
		{name: "p90", percentile: 95, want: 20 * time.Millisecond},
		{name: "p99", percentile: 99, want: 30 * time.Millisecond},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			duration := NewRequestDuration(10*time.Millisecond, 20*time.Millisecond, 30*time.Millisecond, 0)
			duration.randomFunc = func(int) int { return tt.percentile }

			if got := duration.Calculate(); got != tt.want {
				t.Fatalf("expected %s, got %s", tt.want, got)
			}
		})
	}
}

func TestRequestDurationAppliesPositiveVariance(t *testing.T) {
	duration := NewRequestDuration(100*time.Millisecond, 0, 0, 50)
	values := []int{50, 25}
	duration.randomFunc = func(int) int {
		value := values[0]
		values = values[1:]
		return value
	}

	if got := duration.Calculate(); got != 125*time.Millisecond {
		t.Fatalf("expected 125ms, got %s", got)
	}
}

package timing

import (
	"math/rand"
	"time"
)

type RequestDuration struct {
	percentile50 time.Duration
	percentile90 time.Duration
	percentile99 time.Duration
	variance     int
	randomFunc   func(max int) int
}

func NewRequestDuration(percentile50, percentile90, percentile99 time.Duration, variance int) *RequestDuration {
	if percentile50 > 0 && percentile90 == 0 {
		percentile90 = percentile50
	}

	if percentile90 > 0 && percentile99 == 0 {
		percentile99 = percentile90
	}

	if variance < 0 {
		variance = 0
	}

	return &RequestDuration{
		percentile50: percentile50,
		percentile90: percentile90,
		percentile99: percentile99,
		variance:     variance,
		randomFunc:   randomInt,
	}
}

func (r *RequestDuration) Calculate() time.Duration {
	var duration time.Duration

	switch percentile := r.randomFunc(100); {
	case percentile < 90:
		duration = r.percentile50
	case percentile < 99:
		duration = r.percentile90
	default:
		duration = r.percentile99
	}

	if duration <= 0 || r.variance <= 0 {
		return duration
	}

	variancePercent := r.randomFunc(r.variance)
	return duration + time.Duration(float64(duration)*float64(variancePercent)/100)
}

func randomInt(max int) int {
	if max <= 0 {
		return 0
	}

	return rand.Intn(max)
}

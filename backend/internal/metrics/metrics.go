package metrics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Recorder owns Mytube's isolated Prometheus registry and application metrics.
// It deliberately avoids the global registry so tests and multiple server
// instances cannot collide.
type Recorder struct {
	registry         *prometheus.Registry
	httpRequests     *prometheus.CounterVec
	httpDuration     *prometheus.HistogramVec
	httpResponseSize *prometheus.CounterVec
	httpInFlight     prometheus.Gauge
	downloads        *prometheus.CounterVec
	downloadDuration *prometheus.HistogramVec
	downloadsActive  prometheus.Gauge
	downloadFallback prometheus.Counter
	telemetryBatches *prometheus.CounterVec
	telemetryEvents  *prometheus.CounterVec
}

// New creates a recorder with Go runtime, process, build, HTTP, and download
// metrics registered under the mytube namespace.
func New(version, commit, buildDate string) *Recorder {
	registry := prometheus.NewRegistry()
	recorder := &Recorder{
		registry: registry,
		httpRequests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "mytube",
			Subsystem: "http",
			Name:      "requests_total",
			Help:      "Total application HTTP requests.",
		}, []string{"method", "route", "status_class"}),
		httpDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: "mytube",
			Subsystem: "http",
			Name:      "request_duration_seconds",
			Help:      "Application HTTP request duration in seconds.",
			Buckets:   []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 30},
		}, []string{"method", "route"}),
		httpResponseSize: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "mytube",
			Subsystem: "http",
			Name:      "response_bytes_total",
			Help:      "Total application HTTP response bytes.",
		}, []string{"method", "route"}),
		httpInFlight: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "mytube",
			Subsystem: "http",
			Name:      "in_flight_requests",
			Help:      "Current application HTTP requests being served.",
		}),
		downloads: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "mytube",
			Subsystem: "downloads",
			Name:      "total",
			Help:      "Total download jobs by outcome.",
		}, []string{"outcome"}),
		downloadDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: "mytube",
			Subsystem: "downloads",
			Name:      "duration_seconds",
			Help:      "Download job duration in seconds by outcome.",
			Buckets:   []float64{10, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200},
		}, []string{"outcome"}),
		downloadsActive: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "mytube",
			Subsystem: "downloads",
			Name:      "active",
			Help:      "Current download jobs being processed.",
		}),
		downloadFallback: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "mytube",
			Subsystem: "downloads",
			Name:      "hls_fallback_total",
			Help:      "Total direct downloads retried through the HLS fallback.",
		}),
		telemetryBatches: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "mytube",
			Subsystem: "telemetry",
			Name:      "batches_total",
			Help:      "Total client telemetry batches by bounded outcome.",
		}, []string{"outcome"}),
		telemetryEvents: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "mytube",
			Subsystem: "telemetry",
			Name:      "events_total",
			Help:      "Total validated client telemetry events by bounded client, name, and outcome.",
		}, []string{"client", "event", "outcome"}),
	}

	buildInfo := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "mytube",
		Name:      "build_info",
		Help:      "Build information for the running Mytube backend.",
	}, []string{"version", "commit", "build_date"})
	buildInfo.WithLabelValues(version, commit, buildDate).Set(1)

	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		buildInfo,
		recorder.httpRequests,
		recorder.httpDuration,
		recorder.httpResponseSize,
		recorder.httpInFlight,
		recorder.downloads,
		recorder.downloadDuration,
		recorder.downloadsActive,
		recorder.downloadFallback,
		recorder.telemetryBatches,
		recorder.telemetryEvents,
	)
	for _, outcome := range []string{"completed", "failed", "cancelled", "persistence_error"} {
		recorder.downloads.WithLabelValues(outcome)
		recorder.downloadDuration.WithLabelValues(outcome)
	}
	for _, outcome := range []string{"accepted", "rejected", "persistence_error"} {
		recorder.telemetryBatches.WithLabelValues(outcome)
	}
	return recorder
}

// Handler exposes this recorder's registry in the Prometheus text format.
func (r *Recorder) Handler() http.Handler {
	return promhttp.HandlerFor(r.registry, promhttp.HandlerOpts{})
}

// HTTPMiddleware records bounded route templates rather than raw request paths.
func (r *Recorder) HTTPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		started := time.Now()
		r.httpInFlight.Inc()
		defer r.httpInFlight.Dec()

		wrapped := chimiddleware.NewWrapResponseWriter(w, request.ProtoMajor)
		next.ServeHTTP(wrapped, request)

		status := wrapped.Status()
		if status == 0 {
			status = http.StatusOK
		}
		route := chi.RouteContext(request.Context()).RoutePattern()
		if route == "" {
			route = "unmatched"
		}
		method := boundedMethod(request.Method)
		r.httpRequests.WithLabelValues(method, route, statusClass(status)).Inc()
		r.httpDuration.WithLabelValues(method, route).Observe(time.Since(started).Seconds())
		r.httpResponseSize.WithLabelValues(method, route).Add(float64(wrapped.BytesWritten()))
	})
}

func statusClass(status int) string {
	if status < 100 || status >= 600 {
		return "other"
	}
	return strconv.Itoa(status/100) + "xx"
}

func boundedMethod(method string) string {
	switch method {
	case http.MethodGet, http.MethodPost, http.MethodDelete, http.MethodOptions, http.MethodHead:
		return method
	default:
		return "OTHER"
	}
}

func boundedDownloadOutcome(outcome string) string {
	switch outcome {
	case "completed", "failed", "cancelled", "persistence_error":
		return outcome
	default:
		return "failed"
	}
}

// DownloadStarted records a worker beginning a job.
func (r *Recorder) DownloadStarted() {
	r.downloadsActive.Inc()
}

// DownloadFinished records a bounded outcome and job duration.
func (r *Recorder) DownloadFinished(outcome string, duration time.Duration) {
	outcome = boundedDownloadOutcome(outcome)
	r.downloadsActive.Dec()
	r.downloads.WithLabelValues(outcome).Inc()
	r.downloadDuration.WithLabelValues(outcome).Observe(duration.Seconds())
}

// DownloadFallback records a direct-download retry through HLS.
func (r *Recorder) DownloadFallback() {
	r.downloadFallback.Inc()
}

func (r *Recorder) TelemetryBatch(outcome string) {
	switch outcome {
	case "accepted", "rejected", "persistence_error":
	default:
		outcome = "rejected"
	}
	r.telemetryBatches.WithLabelValues(outcome).Inc()
}

func (r *Recorder) TelemetryEvent(client, name, outcome string) {
	if client != "web" && client != "ios" {
		client = "other"
	}
	if _, ok := telemetryEventNames[name]; !ok {
		name = "other"
	}
	if outcome != "accepted" && outcome != "duplicate" {
		outcome = "rejected"
	}
	r.telemetryEvents.WithLabelValues(client, name, outcome).Inc()
}

var telemetryEventNames = map[string]struct{}{
	"app_opened": {}, "video_started": {}, "video_completed": {},
	"playback_failed": {}, "playback_recovered": {}, "playback_started_over": {},
	"playlist_started": {}, "playlist_item_completed": {}, "playlist_item_skipped": {},
	"playlist_completed": {}, "download_submitted": {}, "download_failed": {},
}

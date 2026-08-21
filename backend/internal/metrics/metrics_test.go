package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestHTTPMiddlewareUsesRouteTemplateAndStatusClass(t *testing.T) {
	recorder := New("test", "abc123", "now")
	router := chi.NewRouter()
	router.Use(recorder.HTTPMiddleware)
	router.Get("/files/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("x"))
	})

	request := httptest.NewRequest(http.MethodGet, "/files/987654", nil)
	router.ServeHTTP(httptest.NewRecorder(), request)

	output := scrape(t, recorder)
	if !strings.Contains(output, `mytube_http_requests_total{method="GET",route="/files/{id}",status_class="2xx"} 1`) {
		t.Fatalf("templated request metric missing:\n%s", output)
	}
	if strings.Contains(output, "987654") {
		t.Fatalf("raw path leaked into metrics:\n%s", output)
	}
}

func TestDownloadMetricsHaveBoundedOutcomes(t *testing.T) {
	recorder := New("test", "abc123", "now")
	recorder.DownloadStarted()
	recorder.DownloadFallback()
	recorder.DownloadFinished("completed", 2*time.Minute)

	output := scrape(t, recorder)
	for _, expected := range []string{
		`mytube_downloads_active 0`,
		`mytube_downloads_hls_fallback_total 1`,
		`mytube_downloads_total{outcome="completed"} 1`,
	} {
		if !strings.Contains(output, expected) {
			t.Fatalf("metric %q missing:\n%s", expected, output)
		}
	}
}

func TestDynamicMethodsAndOutcomesCollapseToBoundedLabels(t *testing.T) {
	recorder := New("test", "abc123", "now")
	recorder.DownloadStarted()
	recorder.DownloadFinished("unbounded-error-text", time.Second)

	if got := boundedMethod("ATTACKER-GENERATED-METHOD"); got != "OTHER" {
		t.Fatalf("boundedMethod() = %q, want OTHER", got)
	}
	output := scrape(t, recorder)
	if strings.Contains(output, "unbounded-error-text") {
		t.Fatalf("unbounded value leaked into metric labels:\n%s", output)
	}
	if !strings.Contains(output, `mytube_downloads_total{outcome="failed"} 1`) {
		t.Fatalf("unrecognized outcome did not collapse to failed:\n%s", output)
	}
}

func TestTelemetryMetricsBoundLabels(t *testing.T) {
	recorder := New("test", "test", "test")
	recorder.TelemetryBatch("unexpected")
	recorder.TelemetryEvent("unknown-client", "unknown-event", "unexpected")

	output := scrape(t, recorder)
	for _, expected := range []string{
		`mytube_telemetry_batches_total{outcome="rejected"} 1`,
		`mytube_telemetry_events_total{client="other",event="other",outcome="rejected"} 1`,
	} {
		if !strings.Contains(output, expected) {
			t.Fatalf("metric %q missing:\n%s", expected, output)
		}
	}
}

func scrape(t *testing.T, recorder *Recorder) string {
	t.Helper()
	response := httptest.NewRecorder()
	recorder.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("metrics status = %d", response.Code)
	}
	return response.Body.String()
}

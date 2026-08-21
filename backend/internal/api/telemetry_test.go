package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	analyticsPkg "github.com/newcl/mytube/backend/internal/analytics"
)

type telemetryMetricsStub struct {
	batches []string
	events  []string
}

func (m *telemetryMetricsStub) TelemetryBatch(outcome string) { m.batches = append(m.batches, outcome) }
func (m *telemetryMetricsStub) TelemetryEvent(client, name, outcome string) {
	m.events = append(m.events, client+":"+name+":"+outcome)
}

func telemetryHandler(t *testing.T) (*Handler, *telemetryMetricsStub) {
	t.Helper()
	store, err := analyticsPkg.Open(filepath.Join(t.TempDir(), "analytics.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	metrics := &telemetryMetricsStub{}
	return &Handler{Analytics: store, TelemetryMetrics: metrics}, metrics
}

func validTelemetryBody(t *testing.T) []byte {
	t.Helper()
	body := map[string]any{
		"schema_version": 1,
		"events": []any{map[string]any{
			"id": "event_1234567890", "session_id": "session_123456789",
			"name": "video_started", "occurred_at": time.Now().UTC().Format(time.RFC3339Nano),
			"properties": map[string]any{"client": "web", "app_version": "1.0.0", "playback_mode": "standalone"},
		}},
	}
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestPostTelemetryEventsAcceptsAndDeduplicates(t *testing.T) {
	handler, metrics := telemetryHandler(t)
	for attempt, want := range []string{`"accepted":1`, `"duplicates":1`} {
		request := httptest.NewRequest(http.MethodPost, "/api/telemetry/events", bytes.NewReader(validTelemetryBody(t)))
		response := httptest.NewRecorder()
		handler.PostTelemetryEvents(response, request)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), want) {
			t.Fatalf("attempt %d: status=%d body=%s", attempt, response.Code, response.Body.String())
		}
	}
	if len(metrics.batches) != 2 || metrics.events[1] != "web:video_started:duplicate" {
		t.Fatalf("unexpected metrics: %+v %+v", metrics.batches, metrics.events)
	}
}

func TestPostTelemetryEventsRejectsUnknownSensitiveProperty(t *testing.T) {
	handler, metrics := telemetryHandler(t)
	body := strings.Replace(string(validTelemetryBody(t)), `"client":"web"`, `"client":"web","title":"secret video"`, 1)
	request := httptest.NewRequest(http.MethodPost, "/api/telemetry/events", strings.NewReader(body))
	response := httptest.NewRecorder()
	handler.PostTelemetryEvents(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if len(metrics.batches) != 1 || metrics.batches[0] != "rejected" {
		t.Fatalf("batch metrics = %+v", metrics.batches)
	}
}

func TestPostTelemetryEventsRejectsOversizedPayload(t *testing.T) {
	handler, _ := telemetryHandler(t)
	request := httptest.NewRequest(http.MethodPost, "/api/telemetry/events", strings.NewReader(strings.Repeat("x", maxTelemetryBodyBytes+1)))
	response := httptest.NewRecorder()
	handler.PostTelemetryEvents(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d, want 413", response.Code)
	}
}

func TestValidateTelemetryBatchRejectsUnknownEventAndStaleTimestamp(t *testing.T) {
	now := time.Now().UTC()
	base := telemetryBatchRequest{SchemaVersion: 1, Events: []telemetryEventRequest{{
		ID: "event_1234567890", Name: "unknown", OccurredAt: now.Format(time.RFC3339),
		Properties: telemetryProperties{Client: "ios", AppVersion: "1.0.0"},
	}}}
	if _, err := validateTelemetryBatch(base, now); err == nil {
		t.Fatal("unknown event accepted")
	}
	base.Events[0].Name = "app_opened"
	base.Events[0].OccurredAt = now.Add(-RawClientEventAge - time.Second).Format(time.RFC3339)
	if _, err := validateTelemetryBatch(base, now); err == nil {
		t.Fatal("stale event accepted")
	}
}

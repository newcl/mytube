package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"

	analyticsPkg "github.com/newcl/mytube/backend/internal/analytics"
)

const (
	telemetrySchemaVersion = 1
	maxTelemetryBodyBytes  = 64 << 10
	maxTelemetryBatchSize  = 50
)

var safeTelemetryID = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)
var safeTelemetryText = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

var telemetryEventNames = map[string]struct{}{
	"app_opened": {}, "video_started": {}, "video_completed": {},
	"playback_failed": {}, "playback_recovered": {}, "playback_started_over": {},
	"playlist_started": {}, "playlist_item_completed": {}, "playlist_item_skipped": {},
	"playlist_completed": {}, "download_submitted": {}, "download_failed": {},
}

type TelemetryRecorder interface {
	TelemetryBatch(outcome string)
	TelemetryEvent(client, name, outcome string)
}

type telemetryBatchRequest struct {
	SchemaVersion int                     `json:"schema_version"`
	Events        []telemetryEventRequest `json:"events"`
}

type telemetryEventRequest struct {
	ID         string              `json:"id"`
	SessionID  string              `json:"session_id,omitempty"`
	Name       string              `json:"name"`
	OccurredAt string              `json:"occurred_at"`
	Properties telemetryProperties `json:"properties"`
}

type telemetryProperties struct {
	Client         string   `json:"client"`
	AppVersion     string   `json:"app_version"`
	PlaybackMode   string   `json:"playback_mode,omitempty"`
	RetryCount     *int     `json:"retry_count,omitempty"`
	ElapsedSeconds *float64 `json:"elapsed_seconds,omitempty"`
	OutcomeCode    string   `json:"outcome_code,omitempty"`
}

func (h *Handler) PostTelemetryEvents(w http.ResponseWriter, r *http.Request) {
	if h.Analytics == nil {
		h.recordTelemetryBatch("persistence_error")
		http.Error(w, "telemetry unavailable", http.StatusServiceUnavailable)
		return
	}
	if r.ContentLength > maxTelemetryBodyBytes {
		h.recordTelemetryBatch("rejected")
		http.Error(w, "telemetry payload too large", http.StatusRequestEntityTooLarge)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxTelemetryBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var body telemetryBatchRequest
	if err := decoder.Decode(&body); err != nil {
		h.recordTelemetryBatch("rejected")
		http.Error(w, "invalid telemetry payload", statusForTelemetryDecodeError(err))
		return
	}
	if err := ensureJSONEOF(decoder); err != nil {
		h.recordTelemetryBatch("rejected")
		http.Error(w, "invalid telemetry payload", http.StatusBadRequest)
		return
	}
	events, err := validateTelemetryBatch(body, time.Now())
	if err != nil {
		h.recordTelemetryBatch("rejected")
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	result, err := h.Analytics.Insert(r.Context(), events, time.Now())
	if err != nil {
		h.recordTelemetryBatch("persistence_error")
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h.recordTelemetryBatch("accepted")
	for index, event := range events {
		outcome := "accepted"
		if !result.Inserted[index] {
			outcome = "duplicate"
		}
		if h.TelemetryMetrics != nil {
			h.TelemetryMetrics.TelemetryEvent(event.Client, event.Name, outcome)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"accepted": result.Accepted, "duplicates": result.Duplicates})
}

func (h *Handler) recordTelemetryBatch(outcome string) {
	if h.TelemetryMetrics != nil {
		h.TelemetryMetrics.TelemetryBatch(outcome)
	}
}

func statusForTelemetryDecodeError(err error) int {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return http.StatusRequestEntityTooLarge
	}
	return http.StatusBadRequest
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return fmt.Errorf("extra JSON value")
	}
	return nil
}

func validateTelemetryBatch(body telemetryBatchRequest, now time.Time) ([]analyticsPkg.Event, error) {
	if body.SchemaVersion != telemetrySchemaVersion {
		return nil, fmt.Errorf("unsupported schema_version")
	}
	if len(body.Events) == 0 || len(body.Events) > maxTelemetryBatchSize {
		return nil, fmt.Errorf("events must contain 1 to %d items", maxTelemetryBatchSize)
	}
	events := make([]analyticsPkg.Event, 0, len(body.Events))
	seen := make(map[string]struct{}, len(body.Events))
	for _, input := range body.Events {
		if !safeTelemetryID.MatchString(input.ID) {
			return nil, fmt.Errorf("invalid event id")
		}
		if _, exists := seen[input.ID]; exists {
			return nil, fmt.Errorf("duplicate event id in batch")
		}
		seen[input.ID] = struct{}{}
		if input.SessionID != "" && !safeTelemetryID.MatchString(input.SessionID) {
			return nil, fmt.Errorf("invalid session id")
		}
		if _, ok := telemetryEventNames[input.Name]; !ok {
			return nil, fmt.Errorf("unsupported event name")
		}
		occurredAt, err := time.Parse(time.RFC3339Nano, input.OccurredAt)
		if err != nil || occurredAt.Before(now.Add(-RawClientEventAge)) || occurredAt.After(now.Add(5*time.Minute)) {
			return nil, fmt.Errorf("invalid occurred_at")
		}
		properties := input.Properties
		if properties.Client != "web" && properties.Client != "ios" {
			return nil, fmt.Errorf("invalid client")
		}
		if !safeTelemetryText.MatchString(properties.AppVersion) {
			return nil, fmt.Errorf("invalid app_version")
		}
		if properties.PlaybackMode != "" && properties.PlaybackMode != "standalone" && properties.PlaybackMode != "playlist" {
			return nil, fmt.Errorf("invalid playback_mode")
		}
		if properties.RetryCount != nil && (*properties.RetryCount < 0 || *properties.RetryCount > 100) {
			return nil, fmt.Errorf("invalid retry_count")
		}
		if properties.ElapsedSeconds != nil && (*properties.ElapsedSeconds < 0 || *properties.ElapsedSeconds > 86400) {
			return nil, fmt.Errorf("invalid elapsed_seconds")
		}
		if properties.OutcomeCode != "" && !safeTelemetryText.MatchString(properties.OutcomeCode) {
			return nil, fmt.Errorf("invalid outcome_code")
		}
		events = append(events, analyticsPkg.Event{
			ID: input.ID, SchemaVersion: telemetrySchemaVersion, SessionID: input.SessionID, Name: input.Name,
			OccurredAt: occurredAt, Client: properties.Client, AppVersion: properties.AppVersion,
			PlaybackMode: properties.PlaybackMode, RetryCount: properties.RetryCount,
			ElapsedSeconds: properties.ElapsedSeconds, OutcomeCode: properties.OutcomeCode,
		})
	}
	return events, nil
}

const RawClientEventAge = 30 * 24 * time.Hour

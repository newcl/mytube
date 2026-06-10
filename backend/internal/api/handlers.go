package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	dbpkg "github.com/newcl/mytube/backend/internal/db"
)

// jobResponse is the public JSON shape for a job.
type jobResponse struct {
	ID           int64           `json:"id"`
	URL          string          `json:"url"`
	Status       dbpkg.JobStatus `json:"status"`
	CreatedAt    string          `json:"created_at"`
	UpdatedAt    string          `json:"updated_at"`
	Title        string          `json:"title"`
	Uploader     string          `json:"uploader"`
	ThumbnailURL string          `json:"thumbnail_url"`
	DurationSecs float64         `json:"duration_seconds"`
	OutputPath   string          `json:"output_path"`
	Error        string          `json:"error"`
	Progress     *dbpkg.Progress `json:"progress"`
}

func toJobResponse(j *dbpkg.Job) jobResponse {
	return jobResponse{
		ID:           j.ID,
		URL:          j.URL,
		Status:       j.Status,
		CreatedAt:    j.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		UpdatedAt:    j.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		Title:        j.Title,
		Uploader:     j.Uploader,
		ThumbnailURL: j.ThumbnailURL,
		DurationSecs: j.DurationSecs,
		OutputPath:   j.OutputPath,
		Error:        j.Error,
		Progress:     j.Progress,
	}
}

// Handler holds the HTTP handler dependencies.
type Handler struct {
	DB *sql.DB
}

// PostJob handles POST /api/jobs.
func (h *Handler) PostJob(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if body.URL == "" {
		http.Error(w, "url is required", http.StatusBadRequest)
		return
	}
	if !IsValidURL(body.URL) {
		http.Error(w, "url is not valid", http.StatusBadRequest)
		return
	}

	// If the same URL is already queued, downloading, or completed, return the
	// existing job instead of creating a duplicate download.
	if existing, err := dbpkg.FindActiveJobByURL(h.DB, body.URL); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	} else if existing != 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int64{"id": existing})
		return
	}

	id, err := dbpkg.CreateJob(h.DB, body.URL)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]int64{"id": id})
}

// GetJobs handles GET /api/jobs?limit=50.
func (h *Handler) GetJobs(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}

	jobs, err := dbpkg.ListJobs(h.DB, limit)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	resp := make([]jobResponse, len(jobs))
	for i, j := range jobs {
		resp[i] = toJobResponse(j)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// GetJob handles GET /api/jobs/{id}.
func (h *Handler) GetJob(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}

	j, err := dbpkg.GetJob(h.DB, id)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(toJobResponse(j))
}

// GetJobLog handles GET /api/jobs/{id}/log.
func (h *Handler) GetJobLog(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}

	tail, err := dbpkg.GetJobLog(h.DB, id)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"tail": tail})
}

// DeleteJob handles DELETE /api/jobs/{id}.
// Removes the job record and deletes the downloaded file (+ .info.json sidecar) if present.
func (h *Handler) DeleteJob(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}

	outputPath, err := dbpkg.DeleteJob(h.DB, id)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if outputPath != "" {
		os.Remove(outputPath)
		ext := filepath.Ext(outputPath)
		sidecar := strings.TrimSuffix(outputPath, ext) + ".info.json"
		os.Remove(sidecar)
	}

	w.WriteHeader(http.StatusNoContent)
}

// ---- helpers ----------------------------------------------------------------

func parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return 0, false
	}
	return id, true
}

func IsValidURL(raw string) bool {
	if len(raw) > 2048 {
		return false
	}
	// Accept http:// and https:// only
	if len(raw) < 8 {
		return false
	}
	lower := raw
	if len(lower) >= 8 {
		prefix := lower[:8]
		if prefix != "https://" && lower[:7] != "http://" {
			return false
		}
	}
	return true
}

package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	dbpkg "github.com/newcl/mytube/backend/internal/db"
)

func TestRetryJobRequeuesSameIDAndRemovesPartialArtifacts(t *testing.T) {
	database, err := dbpkg.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })

	id, err := dbpkg.CreateJob(database, "https://example.com/retry")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	outputPath := filepath.Join(dir, "partial.mp4")
	infoPath := filepath.Join(dir, "partial.info.json")
	for _, path := range []string{outputPath, infoPath} {
		if err := os.WriteFile(path, []byte("partial"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := dbpkg.SetJobOutputPath(database, id, outputPath); err != nil {
		t.Fatal(err)
	}
	if err := dbpkg.SetJobFailed(database, id, "failed", "log"); err != nil {
		t.Fatal(err)
	}

	handler := &Handler{DB: database}
	router := chi.NewRouter()
	router.Post("/api/jobs/{id}/retry", handler.RetryJob)
	request := httptest.NewRequest(http.MethodPost, "/api/jobs/1/retry", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	job, err := dbpkg.GetJob(database, id)
	if err != nil {
		t.Fatal(err)
	}
	if job.ID != id || job.Status != dbpkg.StatusQueued {
		t.Fatalf("retried job = id %d status %q", job.ID, job.Status)
	}
	for _, path := range []string{outputPath, infoPath} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("artifact %q still exists or stat failed: %v", path, err)
		}
	}
}

func TestRetryJobRejectsQueuedJob(t *testing.T) {
	database, err := dbpkg.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if _, err := dbpkg.CreateJob(database, "https://example.com/queued"); err != nil {
		t.Fatal(err)
	}

	handler := &Handler{DB: database}
	router := chi.NewRouter()
	router.Post("/api/jobs/{id}/retry", handler.RetryJob)
	request := httptest.NewRequest(http.MethodPost, "/api/jobs/1/retry", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
}

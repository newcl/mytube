package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	dbpkg "github.com/newcl/mytube/backend/internal/db"
)

func TestServeFileSupportsByteRanges(t *testing.T) {
	dir := t.TempDir()
	database, err := dbpkg.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })

	id, err := dbpkg.CreateJob(database, "https://example.com/video")
	if err != nil {
		t.Fatal(err)
	}
	videoPath := filepath.Join(dir, "video.mp4")
	if err := os.WriteFile(videoPath, []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := dbpkg.SetJobCompleted(database, id, dbpkg.CompletedFields{OutputPath: videoPath}); err != nil {
		t.Fatal(err)
	}

	router := chi.NewRouter()
	router.Get("/files/{id}", ServeFile(database))
	request := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/files/%d", id), nil)
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d; body=%q", response.Code, http.StatusPartialContent, response.Body.String())
	}
	if got := response.Header().Get("Content-Range"); got != "bytes 2-5/10" {
		t.Fatalf("Content-Range = %q", got)
	}
	if got := response.Body.String(); got != "2345" {
		t.Fatalf("body = %q", got)
	}
}

package api

import (
	"database/sql"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"

	"github.com/go-chi/chi/v5"
	dbpkg "github.com/newcl/mytube/backend/internal/db"
)

// ServeFile handles GET /files/{id} with Range request support.
func ServeFile(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw := chi.URLParam(r, "id")
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		job, err := dbpkg.GetJob(db, id)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		if job.OutputPath == "" {
			http.Error(w, "not ready", http.StatusNotFound)
			return
		}

		// Content-Type by extension
		ext := filepath.Ext(job.OutputPath)
		ct := mime.TypeByExtension(ext)
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)

		// http.ServeFile handles Range, ETag, Last-Modified, 206, etc.
		// We use ServeFile but rename the URL to prevent directory listing tricks.
		http.ServeFile(w, r, job.OutputPath)
	}
}

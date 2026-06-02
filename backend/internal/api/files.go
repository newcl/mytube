package api

import (
	"archive/zip"
	"database/sql"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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

		name := filepath.Base(job.OutputPath)
		if name == "" || name == "." || name == string(filepath.Separator) {
			name = fmt.Sprintf("video_%d.mp4", job.ID)
		}
		name = strings.ReplaceAll(name, `"`, "")
		name = strings.ReplaceAll(name, "\n", "")
		name = strings.ReplaceAll(name, "\r", "")

		// iOS Safari/Chrome force media MIME types to play inline.
		// zip=1 wraps the file into a zip attachment so iOS treats it as a download.
		if r.URL.Query().Get("zip") == "1" {
			f, err := os.Open(job.OutputPath)
			if err != nil {
				http.Error(w, "file open error", http.StatusInternalServerError)
				return
			}
			defer f.Close()

			zipName := strings.TrimSuffix(name, filepath.Ext(name)) + ".zip"
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", zipName))

			zw := zip.NewWriter(w)
			entry, err := zw.Create(name)
			if err != nil {
				http.Error(w, "zip error", http.StatusInternalServerError)
				return
			}
			if _, err := io.Copy(entry, f); err != nil {
				return
			}
			_ = zw.Close()
			return
		}

		if r.URL.Query().Get("download") == "1" {
			w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", name))
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

package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// JobStatus represents a job's lifecycle state.
type JobStatus string

const (
	StatusQueued      JobStatus = "queued"
	StatusDownloading JobStatus = "downloading"
	StatusCompleted   JobStatus = "completed"
	StatusFailed      JobStatus = "failed"
)

// Progress holds live download progress fields.
type Progress struct {
	Percent         float64 `json:"percent"`
	Speed           string  `json:"speed"`
	ETA             string  `json:"eta"`
	DownloadedBytes int64   `json:"downloaded_bytes"`
	TotalBytes      int64   `json:"total_bytes"`
}

// Job is a download job record.
type Job struct {
	ID           int64     `json:"id"`
	URL          string    `json:"url"`
	Status       JobStatus `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Title        string    `json:"title"`
	Uploader     string    `json:"uploader"`
	ThumbnailURL string    `json:"thumbnail_url"`
	DurationSecs float64   `json:"duration_seconds"`
	Extractor    string    `json:"extractor"`
	WebpageURL   string    `json:"webpage_url"`
	OutputPath   string    `json:"output_path"`
	Error        string    `json:"error"`
	Progress     *Progress `json:"progress,omitempty"`
	LogTail      string    `json:"-"` // served separately
}

// FindActiveJobByURL returns the ID of an existing job for the given URL that
// is queued, downloading, or completed. Returns 0 if none exists.
func FindActiveJobByURL(db *sql.DB, url string) (int64, error) {
	var id int64
	err := db.QueryRow(
		`SELECT id FROM jobs WHERE url = ? AND status IN ('queued','downloading','completed') ORDER BY id DESC LIMIT 1`,
		url,
	).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return id, err
}

// CreateJob inserts a new queued job and returns its ID.
func CreateJob(db *sql.DB, url string) (int64, error) {
	res, err := db.Exec(
		`INSERT INTO jobs (url, status) VALUES (?, 'queued')`,
		url,
	)
	if err != nil {
		return 0, fmt.Errorf("create job: %w", err)
	}
	return res.LastInsertId()
}

// GetJob returns the job with the given ID, or sql.ErrNoRows if not found.
func GetJob(db *sql.DB, id int64) (*Job, error) {
	row := db.QueryRow(`SELECT `+jobColumns+` FROM jobs WHERE id = ?`, id)
	return scanJob(row)
}

// ListJobs returns the most recent jobs up to limit.
func ListJobs(db *sql.DB, limit int) ([]*Job, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := db.Query(
		`SELECT `+jobColumns+` FROM jobs ORDER BY created_at DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}
	defer rows.Close()

	var jobs []*Job
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, j)
	}
	return jobs, rows.Err()
}

// ListCompletedJobs returns all completed jobs (no limit).
func ListCompletedJobs(db *sql.DB) ([]*Job, error) {
	rows, err := db.Query(
		`SELECT `+jobColumns+` FROM jobs WHERE status = 'completed' AND output_path <> '' ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("list completed jobs: %w", err)
	}
	defer rows.Close()

	var jobs []*Job
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, j)
	}
	return jobs, rows.Err()
}

// GetJobLog returns the log tail for a job.
func GetJobLog(db *sql.DB, id int64) (string, error) {
	var tail sql.NullString
	err := db.QueryRow(`SELECT log_tail FROM jobs WHERE id = ?`, id).Scan(&tail)
	if err != nil {
		return "", err
	}
	return tail.String, nil
}

// SetJobStatus updates status and updated_at.
func SetJobStatus(db *sql.DB, id int64, status JobStatus) error {
	_, err := db.Exec(
		`UPDATE jobs SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`,
		status, id,
	)
	return err
}

// SetJobOutputPath stores the output path early (before download completes)
// so the file endpoint can serve partial bytes while downloading.
func SetJobOutputPath(db *sql.DB, id int64, path string) error {
	_, err := db.Exec(
		`UPDATE jobs SET output_path = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`,
		path, id,
	)
	return err
}

// SetJobDownloading sets status to downloading.
func SetJobDownloading(db *sql.DB, id int64) error {
	return SetJobStatus(db, id, StatusDownloading)
}

// SetJobCompleted marks a job complete with output path and metadata.
type CompletedFields struct {
	OutputPath   string
	Title        string
	Uploader     string
	ThumbnailURL string
	DurationSecs float64
	Extractor    string
	WebpageURL   string
	LogTail      string
}

func SetJobCompleted(db *sql.DB, id int64, f CompletedFields) error {
	_, err := db.Exec(`UPDATE jobs SET
		status       = 'completed',
		updated_at   = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
		output_path  = ?,
		title        = ?,
		uploader     = ?,
		thumbnail_url = ?,
		duration_seconds = ?,
		extractor    = ?,
		webpage_url  = ?,
		log_tail     = ?
	WHERE id = ?`,
		f.OutputPath, f.Title, f.Uploader, f.ThumbnailURL, f.DurationSecs, f.Extractor, f.WebpageURL, f.LogTail,
		id,
	)
	return err
}

// SetJobMetadata updates metadata while a job is in progress.
func SetJobMetadata(db *sql.DB, id int64, title, uploader, thumbnailURL string, durationSecs float64) error {
	_, err := db.Exec(`UPDATE jobs SET
		title = CASE WHEN ? <> '' THEN ? ELSE title END,
		uploader = CASE WHEN ? <> '' THEN ? ELSE uploader END,
		thumbnail_url = CASE WHEN ? <> '' THEN ? ELSE thumbnail_url END,
		duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END,
		updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
	WHERE id = ?`,
		title, title,
		uploader, uploader,
		thumbnailURL, thumbnailURL,
		durationSecs, durationSecs,
		id,
	)
	return err
}

// SetJobFailed marks a job as failed with error message and log.
func SetJobFailed(db *sql.DB, id int64, errMsg, logTail string) error {
	_, err := db.Exec(`UPDATE jobs SET
		status     = 'failed',
		updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
		error_msg  = ?,
		log_tail   = ?
	WHERE id = ?`,
		errMsg, logTail, id,
	)
	return err
}

// UpdateJobProgress writes progress JSON (throttled by caller).
func UpdateJobProgress(db *sql.DB, id int64, p *Progress) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = db.Exec(
		`UPDATE jobs SET progress_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`,
		string(data), id,
	)
	return err
}

// DeleteJob removes a job row and returns its output_path so the caller can delete the file.
// Returns sql.ErrNoRows if the job does not exist.
func DeleteJob(db *sql.DB, id int64) (string, error) {
	var path sql.NullString
	err := db.QueryRow(`SELECT output_path FROM jobs WHERE id = ?`, id).Scan(&path)
	if err != nil {
		return "", err
	}
	_, err = db.Exec(`DELETE FROM jobs WHERE id = ?`, id)
	return path.String, err
}

// DequeueJobs returns up to n queued jobs and atomically marks them as downloading.
func DequeueJobs(db *sql.DB, n int) ([]*Job, error) {
	rows, err := db.Query(
		`SELECT `+jobColumns+` FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`,
		n,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []*Job
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, j)
	}
	return jobs, rows.Err()
}

// ---- helpers ----------------------------------------------------------------

const jobColumns = `id, url, status, created_at, updated_at,
	COALESCE(title,''), COALESCE(uploader,''), COALESCE(thumbnail_url,''),
	COALESCE(duration_seconds, 0),
	COALESCE(extractor,''), COALESCE(webpage_url,''), COALESCE(output_path,''),
	COALESCE(error_msg,''), COALESCE(progress_json,''), COALESCE(log_tail,'')`

type scanner interface {
	Scan(dest ...any) error
}

func scanJob(s scanner) (*Job, error) {
	var j Job
	var createdStr, updatedStr string
	var progressJSON string

	if err := s.Scan(
		&j.ID, &j.URL, &j.Status, &createdStr, &updatedStr,
		&j.Title, &j.Uploader, &j.ThumbnailURL,
		&j.DurationSecs,
		&j.Extractor, &j.WebpageURL, &j.OutputPath,
		&j.Error, &progressJSON, &j.LogTail,
	); err != nil {
		return nil, fmt.Errorf("scan job: %w", err)
	}

	j.CreatedAt = parseTime(createdStr)
	j.UpdatedAt = parseTime(updatedStr)

	if strings.TrimSpace(progressJSON) != "" {
		var p Progress
		if err := json.Unmarshal([]byte(progressJSON), &p); err == nil {
			j.Progress = &p
		}
	}

	return &j, nil
}

func parseTime(s string) time.Time {
	for _, layout := range []string{
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05.999999999Z",
		time.RFC3339,
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

package db_test

import (
	"database/sql"
	"testing"

	dbPkg "github.com/newcl/mytube/backend/internal/db"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := dbPkg.Open(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestCreateAndGetJob(t *testing.T) {
	db := openTestDB(t)

	id, err := dbPkg.CreateJob(db, "https://www.youtube.com/watch?v=test")
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if id <= 0 {
		t.Fatalf("expected positive id, got %d", id)
	}

	job, err := dbPkg.GetJob(db, id)
	if err != nil {
		t.Fatalf("get job: %v", err)
	}

	if job.URL != "https://www.youtube.com/watch?v=test" {
		t.Errorf("url mismatch: %s", job.URL)
	}
	if job.Status != dbPkg.StatusQueued {
		t.Errorf("expected queued, got %s", job.Status)
	}
}

func TestListJobs(t *testing.T) {
	db := openTestDB(t)

	for i := 0; i < 3; i++ {
		if _, err := dbPkg.CreateJob(db, "https://example.com"); err != nil {
			t.Fatalf("create job: %v", err)
		}
	}

	jobs, err := dbPkg.ListJobs(db, 10)
	if err != nil {
		t.Fatalf("list jobs: %v", err)
	}
	if len(jobs) != 3 {
		t.Errorf("expected 3 jobs, got %d", len(jobs))
	}
}

func TestSetJobStatusTransitions(t *testing.T) {
	db := openTestDB(t)

	id, _ := dbPkg.CreateJob(db, "https://example.com")

	if err := dbPkg.SetJobDownloading(db, id); err != nil {
		t.Fatalf("set downloading: %v", err)
	}

	job, _ := dbPkg.GetJob(db, id)
	if job.Status != dbPkg.StatusDownloading {
		t.Errorf("expected downloading, got %s", job.Status)
	}

	if err := dbPkg.SetJobCompleted(db, id, dbPkg.CompletedFields{
		OutputPath: "/data/test.mp4",
		Title:      "Test Video",
		Uploader:   "Test Channel",
	}); err != nil {
		t.Fatalf("set completed: %v", err)
	}

	job, _ = dbPkg.GetJob(db, id)
	if job.Status != dbPkg.StatusCompleted {
		t.Errorf("expected completed, got %s", job.Status)
	}
	if job.OutputPath != "/data/test.mp4" {
		t.Errorf("output_path mismatch: %s", job.OutputPath)
	}
}

func TestUpdateJobProgress(t *testing.T) {
	db := openTestDB(t)

	id, _ := dbPkg.CreateJob(db, "https://example.com")

	p := &dbPkg.Progress{
		Percent: 42.5,
		Speed:   "1.2MiB/s",
		ETA:     "00:35",
	}
	if err := dbPkg.UpdateJobProgress(db, id, p); err != nil {
		t.Fatalf("update progress: %v", err)
	}

	job, _ := dbPkg.GetJob(db, id)
	if job.Progress == nil {
		t.Fatal("expected progress, got nil")
	}
	if job.Progress.Percent != 42.5 {
		t.Errorf("percent mismatch: %f", job.Progress.Percent)
	}
}

func TestDequeueJobs(t *testing.T) {
	db := openTestDB(t)

	id1, _ := dbPkg.CreateJob(db, "https://example.com/1")
	id2, _ := dbPkg.CreateJob(db, "https://example.com/2")

	jobs, err := dbPkg.DequeueJobs(db, 1)
	if err != nil {
		t.Fatalf("dequeue: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("expected 1 job, got %d", len(jobs))
	}
	if jobs[0].ID != id1 {
		t.Errorf("expected id %d, got %d", id1, jobs[0].ID)
	}

	// id2 should still be accessible
	_ = id2
}

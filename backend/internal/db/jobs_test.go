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

func TestFindActiveJobByURLNormalizesYouTubeVideoID(t *testing.T) {
	database := openTestDB(t)

	id, err := dbPkg.CreateJob(database, "https://youtu.be/abc123?si=tracking")
	if err != nil {
		t.Fatal(err)
	}

	for _, candidate := range []string{
		"https://www.youtube.com/watch?v=abc123",
		"https://m.youtube.com/shorts/abc123?feature=share",
		"https://music.youtube.com/watch?v=abc123&list=playlist",
	} {
		got, err := dbPkg.FindActiveJobByURL(database, candidate)
		if err != nil {
			t.Fatalf("find %q: %v", candidate, err)
		}
		if got != id {
			t.Errorf("find %q = %d, want %d", candidate, got, id)
		}
	}

	got, err := dbPkg.FindActiveJobByURL(database, "https://www.youtube.com/watch?v=different")
	if err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Fatalf("different video matched job %d", got)
	}
}

func TestDeleteJobPreservesSharedOutputUntilLastReference(t *testing.T) {
	database := openTestDB(t)
	first, _ := dbPkg.CreateJob(database, "https://example.com/first")
	second, _ := dbPkg.CreateJob(database, "https://example.com/second")
	for _, id := range []int64{first, second} {
		if err := dbPkg.SetJobCompleted(database, id, dbPkg.CompletedFields{OutputPath: "/data/shared.mp4"}); err != nil {
			t.Fatal(err)
		}
	}

	path, err := dbPkg.DeleteJob(database, first)
	if err != nil {
		t.Fatal(err)
	}
	if path != "" {
		t.Fatalf("shared output should be preserved, got delete path %q", path)
	}

	path, err = dbPkg.DeleteJob(database, second)
	if err != nil {
		t.Fatal(err)
	}
	if path != "/data/shared.mp4" {
		t.Fatalf("last reference returned %q", path)
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

func TestRecoverInterruptedJobs(t *testing.T) {
	db := openTestDB(t)
	id, err := dbPkg.CreateJob(db, "https://example.com/interrupted")
	if err != nil {
		t.Fatal(err)
	}
	if err := dbPkg.SetJobDownloading(db, id); err != nil {
		t.Fatal(err)
	}
	if err := dbPkg.SetJobOutputPath(db, id, "/tmp/partial.mp4"); err != nil {
		t.Fatal(err)
	}

	count, err := dbPkg.RecoverInterruptedJobs(db)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("recovered %d jobs, want 1", count)
	}
	job, err := dbPkg.GetJob(db, id)
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != dbPkg.StatusQueued {
		t.Fatalf("status = %q", job.Status)
	}
	if job.OutputPath != "" {
		t.Fatalf("output path was not cleared: %q", job.OutputPath)
	}
	if job.Progress != nil {
		t.Fatalf("progress was not cleared: %#v", job.Progress)
	}
}

func TestRetryFailedJobPreservesIDAndClearsAttemptState(t *testing.T) {
	database := openTestDB(t)
	id, err := dbPkg.CreateJob(database, "https://example.com/retry")
	if err != nil {
		t.Fatal(err)
	}
	if err := dbPkg.SetJobDownloading(database, id); err != nil {
		t.Fatal(err)
	}
	if err := dbPkg.SetJobOutputPath(database, id, "/tmp/partial.mp4"); err != nil {
		t.Fatal(err)
	}
	if err := dbPkg.UpdateJobProgress(database, id, &dbPkg.Progress{Percent: 42}); err != nil {
		t.Fatal(err)
	}
	if err := dbPkg.SetJobFailed(database, id, "network failed", "download log"); err != nil {
		t.Fatal(err)
	}

	if err := dbPkg.RetryFailedJob(database, id); err != nil {
		t.Fatal(err)
	}
	job, err := dbPkg.GetJob(database, id)
	if err != nil {
		t.Fatal(err)
	}
	if job.ID != id || job.Status != dbPkg.StatusQueued {
		t.Fatalf("retried job = id %d status %q, want id %d status queued", job.ID, job.Status, id)
	}
	if job.OutputPath != "" || job.Progress != nil || job.Error != "" {
		t.Fatalf("attempt state was not cleared: %#v", job)
	}
}

func TestRetryFailedJobRejectsOtherStatesAndMissingJobs(t *testing.T) {
	database := openTestDB(t)
	id, err := dbPkg.CreateJob(database, "https://example.com/queued")
	if err != nil {
		t.Fatal(err)
	}
	if err := dbPkg.RetryFailedJob(database, id); err != dbPkg.ErrJobNotFailed {
		t.Fatalf("queued retry error = %v, want ErrJobNotFailed", err)
	}
	if err := dbPkg.RetryFailedJob(database, id+100); err != sql.ErrNoRows {
		t.Fatalf("missing retry error = %v, want sql.ErrNoRows", err)
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

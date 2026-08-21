package analytics

import (
	"context"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "analytics.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func testEvent(id string, occurredAt time.Time) Event {
	return Event{
		ID: id, SchemaVersion: 1, SessionID: "session_123456789", Name: "video_started",
		OccurredAt: occurredAt, Client: "web", AppVersion: "1.0.0",
	}
}

func TestInsertDeduplicatesAndRollsUp(t *testing.T) {
	store := openTestStore(t)
	now := time.Now().UTC()
	event := testEvent("event_1234567890", now)

	first, err := store.Insert(context.Background(), []Event{event}, now)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Insert(context.Background(), []Event{event}, now)
	if err != nil {
		t.Fatal(err)
	}
	if first.Accepted != 1 || second.Duplicates != 1 {
		t.Fatalf("unexpected results: first=%+v second=%+v", first, second)
	}
	var eventCount int
	if err := store.db.QueryRow(`SELECT event_count FROM analytics_daily_rollups`).Scan(&eventCount); err != nil {
		t.Fatal(err)
	}
	if eventCount != 1 {
		t.Fatalf("rollup count = %d, want 1", eventCount)
	}
}

func TestConcurrentDuplicateInsertion(t *testing.T) {
	store := openTestStore(t)
	now := time.Now().UTC()
	event := testEvent("event_concurrent_1", now)
	var accepted atomic.Int64
	var wait sync.WaitGroup
	for range 12 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			result, err := store.Insert(context.Background(), []Event{event}, now)
			if err != nil {
				t.Errorf("Insert: %v", err)
				return
			}
			accepted.Add(int64(result.Accepted))
		}()
	}
	wait.Wait()
	if accepted.Load() != 1 {
		t.Fatalf("accepted = %d, want 1", accepted.Load())
	}
}

func TestPruneRemovesRawEventsButKeepsRollups(t *testing.T) {
	store := openTestStore(t)
	now := time.Now().UTC()
	oldReceivedAt := now.Add(-RawRetention - time.Hour)
	if _, err := store.Insert(context.Background(), []Event{testEvent("event_old_123456", oldReceivedAt)}, oldReceivedAt); err != nil {
		t.Fatal(err)
	}
	removed, err := store.Prune(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}
	var rollups int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM analytics_daily_rollups`).Scan(&rollups); err != nil {
		t.Fatal(err)
	}
	if rollups != 1 {
		t.Fatalf("rollups = %d, want 1", rollups)
	}
}

package analytics

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const RawRetention = 90 * 24 * time.Hour

//go:embed migrations/*.sql
var migrationsFS embed.FS

type Store struct {
	db *sql.DB
}

type Event struct {
	ID             string
	SchemaVersion  int
	SessionID      string
	Name           string
	OccurredAt     time.Time
	Client         string
	AppVersion     string
	PlaybackMode   string
	RetryCount     *int
	ElapsedSeconds *float64
	OutcomeCode    string
}

type InsertResult struct {
	Accepted   int
	Duplicates int
	Inserted   []bool
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, fmt.Errorf("create analytics db dir: %w", err)
	}
	database, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_foreign_keys=on&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open analytics sqlite: %w", err)
	}
	database.SetMaxOpenConns(1)
	if err := migrate(database); err != nil {
		database.Close()
		return nil, fmt.Errorf("migrate analytics: %w", err)
	}
	return &Store{db: database}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func migrate(database *sql.DB) error {
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL
	)`); err != nil {
		return err
	}
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		var exists int
		if err := database.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, name).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		migration, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		tx, err := database.Begin()
		if err != nil {
			return err
		}
		if _, err = tx.Exec(string(migration)); err == nil {
			_, err = tx.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)`, name, time.Now().UTC().Format(time.RFC3339))
		}
		if err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply %s: %w", name, err)
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Insert(ctx context.Context, events []Event, receivedAt time.Time) (InsertResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InsertResult{}, err
	}
	defer tx.Rollback()

	result := InsertResult{Inserted: make([]bool, 0, len(events))}
	for _, event := range events {
		inserted, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO analytics_events (
			event_id, schema_version, session_id, event_name, occurred_at, received_at, client,
			app_version, playback_mode, retry_count, elapsed_seconds, outcome_code
		) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, NULLIF(?, ''))`,
			event.ID, event.SchemaVersion, event.SessionID, event.Name, event.OccurredAt.UTC().Format(time.RFC3339Nano),
			receivedAt.UTC().Format(time.RFC3339Nano), event.Client, event.AppVersion,
			event.PlaybackMode, event.RetryCount, event.ElapsedSeconds, event.OutcomeCode)
		if err != nil {
			return InsertResult{}, err
		}
		rows, err := inserted.RowsAffected()
		if err != nil {
			return InsertResult{}, err
		}
		if rows == 0 {
			result.Duplicates++
			result.Inserted = append(result.Inserted, false)
			continue
		}
		result.Accepted++
		result.Inserted = append(result.Inserted, true)
		day := event.OccurredAt.UTC().Format("2006-01-02")
		if _, err := tx.ExecContext(ctx, `INSERT INTO analytics_daily_rollups(day, event_name, client, event_count)
			VALUES (?, ?, ?, 1)
			ON CONFLICT(day, event_name, client)
			DO UPDATE SET event_count = event_count + 1`, day, event.Name, event.Client); err != nil {
			return InsertResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return InsertResult{}, err
	}
	return result, nil
}

func (s *Store) Prune(ctx context.Context, now time.Time) (int64, error) {
	cutoff := now.UTC().Add(-RawRetention).Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `DELETE FROM analytics_events WHERE received_at < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *Store) RunMaintenance(ctx context.Context) {
	_, _ = s.Prune(ctx, time.Now())
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			_, _ = s.Prune(ctx, now)
		}
	}
}

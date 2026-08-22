package deviceauth

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	dbpkg "github.com/newcl/mytube/backend/internal/db"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "mytube.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return NewStore(database)
}

func TestPairingExchangeCreatesRevocableDeviceToken(t *testing.T) {
	store := testStore(t)
	now := time.Date(2026, 8, 21, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }

	pairing, err := store.CreatePairing(context.Background(), 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	token, device, err := store.ExchangePairing(context.Background(), pairing.Code, "Liang's iPhone")
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || device.Name != "Liang's iPhone" {
		t.Fatalf("unexpected exchange result: token=%t device=%+v", token != "", device)
	}
	if !store.VerifyToken(context.Background(), token) {
		t.Fatal("issued device token was not accepted")
	}
	if _, _, err := store.ExchangePairing(context.Background(), pairing.Code, "replay"); !errors.Is(err, ErrInvalidPairing) {
		t.Fatalf("pairing replay error = %v, want ErrInvalidPairing", err)
	}
	if err := store.RevokeDevice(context.Background(), device.ID); err != nil {
		t.Fatal(err)
	}
	if store.VerifyToken(context.Background(), token) {
		t.Fatal("revoked device token was accepted")
	}
}

func TestPairingExpires(t *testing.T) {
	store := testStore(t)
	now := time.Date(2026, 8, 21, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	pairing, err := store.CreatePairing(context.Background(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Minute)
	if _, _, err := store.ExchangePairing(context.Background(), pairing.Code, "late"); !errors.Is(err, ErrInvalidPairing) {
		t.Fatalf("expired pairing error = %v, want ErrInvalidPairing", err)
	}
}

func TestPairingCanOnlyBeConsumedOnceConcurrently(t *testing.T) {
	store := testStore(t)
	pairing, err := store.CreatePairing(context.Background(), 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	var wait sync.WaitGroup
	wait.Add(2)
	results := make(chan error, 2)
	for range 2 {
		go func() {
			defer wait.Done()
			_, _, exchangeErr := store.ExchangePairing(context.Background(), pairing.Code, "concurrent")
			results <- exchangeErr
		}()
	}
	wait.Wait()
	close(results)
	successes := 0
	invalid := 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrInvalidPairing):
			invalid++
		default:
			t.Fatalf("unexpected exchange error: %v", err)
		}
	}
	if successes != 1 || invalid != 1 {
		t.Fatalf("successes=%d invalid=%d, want 1 each", successes, invalid)
	}
}

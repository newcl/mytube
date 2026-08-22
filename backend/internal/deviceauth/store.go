package deviceauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	pairingPrefix = "mt_pair_"
	devicePrefix  = "mt_device_"
)

var (
	ErrInvalidPairing = errors.New("invalid or expired pairing")
	ErrDeviceNotFound = errors.New("device not found")
)

type Store struct {
	db  *sql.DB
	now func() time.Time
}

type Pairing struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
}

type Device struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt time.Time  `json:"last_used_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db, now: time.Now}
}

func (s *Store) CreatePairing(ctx context.Context, ttl time.Duration) (Pairing, error) {
	if ttl <= 0 {
		return Pairing{}, fmt.Errorf("pairing ttl must be positive")
	}
	code, err := randomToken(pairingPrefix, 32)
	if err != nil {
		return Pairing{}, err
	}
	id, err := randomToken("pair_", 12)
	if err != nil {
		return Pairing{}, err
	}
	now := s.now().UTC()
	expiresAt := now.Add(ttl)
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO mobile_pairings (id, secret_hash, created_at, expires_at)
		VALUES (?, ?, ?, ?)`,
		id, tokenHash(code), formatTime(now), formatTime(expiresAt),
	)
	if err != nil {
		return Pairing{}, fmt.Errorf("insert pairing: %w", err)
	}
	_, _ = s.db.ExecContext(ctx, `DELETE FROM mobile_pairings WHERE expires_at < ?`, formatTime(now.Add(-time.Hour)))
	return Pairing{Code: code, ExpiresAt: expiresAt}, nil
}

func (s *Store) ExchangePairing(ctx context.Context, code, name string) (string, Device, error) {
	if !strings.HasPrefix(code, pairingPrefix) {
		return "", Device{}, ErrInvalidPairing
	}
	name = normalizeDeviceName(name)
	now := s.now().UTC()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", Device{}, fmt.Errorf("begin pairing exchange: %w", err)
	}
	defer tx.Rollback()

	var pairingID, expiresRaw string
	var consumed sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT id, expires_at, consumed_at
		FROM mobile_pairings
		WHERE secret_hash = ?`, tokenHash(code),
	).Scan(&pairingID, &expiresRaw, &consumed)
	if err == sql.ErrNoRows {
		return "", Device{}, ErrInvalidPairing
	}
	if err != nil {
		return "", Device{}, fmt.Errorf("read pairing: %w", err)
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expiresRaw)
	if err != nil || consumed.Valid || !now.Before(expiresAt) {
		return "", Device{}, ErrInvalidPairing
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE mobile_pairings SET consumed_at = ?
		WHERE id = ? AND consumed_at IS NULL`, formatTime(now), pairingID)
	if err != nil {
		return "", Device{}, fmt.Errorf("consume pairing: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil || changed != 1 {
		return "", Device{}, ErrInvalidPairing
	}

	token, err := randomToken(devicePrefix, 32)
	if err != nil {
		return "", Device{}, err
	}
	deviceID, err := randomToken("device_", 12)
	if err != nil {
		return "", Device{}, err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO mobile_devices (id, name, token_hash, created_at, last_used_at)
		VALUES (?, ?, ?, ?, ?)`,
		deviceID, name, tokenHash(token), formatTime(now), formatTime(now),
	)
	if err != nil {
		return "", Device{}, fmt.Errorf("insert device: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", Device{}, fmt.Errorf("commit pairing exchange: %w", err)
	}
	return token, Device{ID: deviceID, Name: name, CreatedAt: now, LastUsedAt: now}, nil
}

func (s *Store) VerifyToken(ctx context.Context, token string) bool {
	if !strings.HasPrefix(token, devicePrefix) {
		return false
	}
	now := s.now().UTC()
	var id string
	var lastUsedRaw string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, last_used_at FROM mobile_devices
		WHERE token_hash = ? AND revoked_at IS NULL`, tokenHash(token),
	).Scan(&id, &lastUsedRaw)
	if err != nil {
		return false
	}
	lastUsed, err := time.Parse(time.RFC3339Nano, lastUsedRaw)
	if err == nil && now.Sub(lastUsed) >= time.Hour {
		_, _ = s.db.ExecContext(ctx, `
			UPDATE mobile_devices SET last_used_at = ?
			WHERE id = ? AND revoked_at IS NULL`, formatTime(now), id)
	}
	return true
}

func (s *Store) ListDevices(ctx context.Context) ([]Device, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, created_at, last_used_at, revoked_at
		FROM mobile_devices
		ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	defer rows.Close()
	devices := make([]Device, 0)
	for rows.Next() {
		var device Device
		var createdRaw, lastUsedRaw string
		var revokedRaw sql.NullString
		if err := rows.Scan(&device.ID, &device.Name, &createdRaw, &lastUsedRaw, &revokedRaw); err != nil {
			return nil, fmt.Errorf("scan device: %w", err)
		}
		device.CreatedAt, err = time.Parse(time.RFC3339Nano, createdRaw)
		if err != nil {
			return nil, fmt.Errorf("parse device created time: %w", err)
		}
		device.LastUsedAt, err = time.Parse(time.RFC3339Nano, lastUsedRaw)
		if err != nil {
			return nil, fmt.Errorf("parse device last-used time: %w", err)
		}
		if revokedRaw.Valid {
			revoked, parseErr := time.Parse(time.RFC3339Nano, revokedRaw.String)
			if parseErr != nil {
				return nil, fmt.Errorf("parse device revoked time: %w", parseErr)
			}
			device.RevokedAt = &revoked
		}
		devices = append(devices, device)
	}
	return devices, rows.Err()
}

func (s *Store) RevokeDevice(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE mobile_devices SET revoked_at = ?
		WHERE id = ? AND revoked_at IS NULL`, formatTime(s.now().UTC()), id)
	if err != nil {
		return fmt.Errorf("revoke device: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("revoke device rows: %w", err)
	}
	if changed == 0 {
		return ErrDeviceNotFound
	}
	return nil
}

func randomToken(prefix string, byteCount int) (string, error) {
	raw := make([]byte, byteCount)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate random token: %w", err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

func tokenHash(token string) []byte {
	hash := sha256.Sum256([]byte(token))
	return hash[:]
}

func normalizeDeviceName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "Mytube mobile"
	}
	runes := []rune(name)
	if len(runes) > 80 {
		runes = runes[:80]
	}
	return string(runes)
}

func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

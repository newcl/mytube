package tooling

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestMaterializeYTDLP(t *testing.T) {
	payload := []byte("#!/bin/sh\nprintf 'test-version\\n'\n")
	sum := sha256.Sum256(payload)
	oldVersion, oldSHA := EmbeddedYTDLPVersion, EmbeddedYTDLPSHA256
	EmbeddedYTDLPVersion = "test/1"
	EmbeddedYTDLPSHA256 = hex.EncodeToString(sum[:])
	t.Cleanup(func() {
		EmbeddedYTDLPVersion = oldVersion
		EmbeddedYTDLPSHA256 = oldSHA
	})

	path, err := materializeYTDLP(payload, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(filepath.Dir(path)) != "test_1" {
		t.Fatalf("unexpected version directory: %s", path)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&0111 == 0 {
		t.Fatalf("materialized tool is not executable: %v", info.Mode())
	}
}

func TestMaterializeRejectsChecksumMismatch(t *testing.T) {
	oldSHA := EmbeddedYTDLPSHA256
	EmbeddedYTDLPSHA256 = "deadbeef"
	t.Cleanup(func() { EmbeddedYTDLPSHA256 = oldSHA })

	if _, err := materializeYTDLP([]byte("payload"), t.TempDir()); err == nil {
		t.Fatal("expected checksum error")
	}
}

func TestUpdateAndRollbackManagedYTDLP(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "source-yt-dlp")
	script := `#!/bin/sh
VERSION=1.0
case "$1" in
  --version)
    printf '%s\n' "$VERSION"
    ;;
  --update-to)
    sed 's/VERSION=1.0/VERSION=2.0/' "$0" > "$0.next"
    chmod 0755 "$0.next"
    mv "$0.next" "$0"
    printf 'updated to 2.0\n'
    ;;
  *)
    exit 2
    ;;
esac
`
	if err := os.WriteFile(sourcePath, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	update, err := UpdateManagedYTDLP(ctx, YTDLP{Path: sourcePath, Version: "1.0"}, dir, "stable")
	if err != nil {
		t.Fatal(err)
	}
	if update.Before.Version != "1.0" || update.After.Version != "2.0" {
		t.Fatalf("unexpected update: %#v", update)
	}

	selected, err := ResolveYTDLP(ctx, "", dir)
	if err != nil {
		t.Fatal(err)
	}
	if selected.Source != "managed" || selected.Version != "2.0" {
		t.Fatalf("unexpected managed selection: %#v", selected)
	}

	rollback, err := RollbackManagedYTDLP(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	if rollback.Before.Version != "2.0" || rollback.After.Version != "1.0" {
		t.Fatalf("unexpected rollback: %#v", rollback)
	}
}

func TestFailedUpdateRestoresManagedYTDLP(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "source-yt-dlp")
	script := `#!/bin/sh
case "$1" in
  --version) printf '1.0\n' ;;
  --update-to) printf 'update failed\n'; exit 1 ;;
esac
`
	if err := os.WriteFile(sourcePath, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}

	_, err := UpdateManagedYTDLP(
		context.Background(),
		YTDLP{Path: sourcePath, Version: "1.0"},
		dir,
		"stable",
	)
	if err == nil {
		t.Fatal("expected update failure")
	}

	selected, err := ResolveYTDLP(context.Background(), "", dir)
	if err != nil {
		t.Fatal(err)
	}
	if selected.Version != "1.0" {
		t.Fatalf("managed version was not restored: %#v", selected)
	}
}

package tooling

import (
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

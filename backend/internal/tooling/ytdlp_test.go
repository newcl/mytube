package tooling

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveConfiguredYTDLP(t *testing.T) {
	path := filepath.Join(t.TempDir(), "yt-dlp")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nprintf 'test-version\\n'\n"), 0755); err != nil {
		t.Fatal(err)
	}

	selected, err := ResolveYTDLP(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if selected.Source != "configured" || selected.Version != "test-version" {
		t.Fatalf("unexpected configured selection: %#v", selected)
	}
	if selected.Path != path {
		t.Fatalf("Path = %q, want %q", selected.Path, path)
	}
}

func TestResolveYTDLPFromPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "yt-dlp")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nprintf 'path-version\\n'\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)

	selected, err := ResolveYTDLP(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if selected.Source != "PATH" || selected.Version != "path-version" {
		t.Fatalf("unexpected PATH selection: %#v", selected)
	}
}

func TestResolveYTDLPRejectsNonExecutableOverride(t *testing.T) {
	path := filepath.Join(t.TempDir(), "yt-dlp")
	if err := os.WriteFile(path, []byte("not executable"), 0644); err != nil {
		t.Fatal(err)
	}

	if _, err := ResolveYTDLP(context.Background(), path); err == nil {
		t.Fatal("expected non-executable override error")
	}
}

package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDarwinDefaults(t *testing.T) {
	cfg := Defaults("darwin", "/Users/example")
	wantState := "/Users/example/Library/Application Support/MyTube"
	if cfg.StateDir != wantState {
		t.Fatalf("StateDir = %q, want %q", cfg.StateDir, wantState)
	}
	if cfg.Bind != "127.0.0.1:8081" {
		t.Fatalf("Bind = %q", cfg.Bind)
	}
	if cfg.CookieBrowser != "chrome" {
		t.Fatalf("CookieBrowser = %q", cfg.CookieBrowser)
	}
}

func TestLinuxDefaultsRemainCompatible(t *testing.T) {
	cfg := Defaults("linux", "/home/example")
	if cfg.Bind != ":8080" || cfg.DBPath != "./data/mytube.db" {
		t.Fatalf("unexpected Linux defaults: %#v", cfg)
	}
	if cfg.CookieBrowser != "" {
		t.Fatalf("unexpected Linux cookie browser: %q", cfg.CookieBrowser)
	}
}

func TestLoadConfigFileAndEnvironmentOverride(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mytube.env")
	err := os.WriteFile(path, []byte(
		"MYTUBE_TOKEN=file-token\n"+
			"MYTUBE_BIND=\"127.0.0.1:9999\"\n"+
			"MYTUBE_STATE_DIR=/tmp/mytube state\n"+
			"MYTUBE_CONCURRENCY=4\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	t.Setenv("MYTUBE_TOKEN", "environment-token")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Token != "environment-token" {
		t.Fatalf("Token = %q", cfg.Token)
	}
	if cfg.Bind != "127.0.0.1:9999" {
		t.Fatalf("Bind = %q", cfg.Bind)
	}
	if cfg.DBPath != "/tmp/mytube state/mytube.db" {
		t.Fatalf("DBPath = %q", cfg.DBPath)
	}
	if cfg.Concurrency != 4 {
		t.Fatalf("Concurrency = %d", cfg.Concurrency)
	}
}

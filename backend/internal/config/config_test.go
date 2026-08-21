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
			"MYTUBE_METRICS_BIND=127.0.0.1:9091\n"+
			"MYTUBE_METRICS_TOKEN=metrics-token\n"+
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
	if cfg.AnalyticsPath != "/tmp/mytube state/analytics.sqlite" {
		t.Fatalf("AnalyticsPath = %q", cfg.AnalyticsPath)
	}
	if cfg.Concurrency != 4 {
		t.Fatalf("Concurrency = %d", cfg.Concurrency)
	}
	if cfg.MetricsBind != "127.0.0.1:9091" || cfg.MetricsToken != "metrics-token" {
		t.Fatalf("unexpected metrics configuration: %#v", cfg)
	}
}

func TestValidateServeMetricsConfiguration(t *testing.T) {
	tests := []struct {
		name    string
		bind    string
		token   string
		wantErr bool
	}{
		{name: "disabled"},
		{name: "private", bind: "192.168.234.1:9091", token: "metrics-token"},
		{name: "loopback", bind: "127.0.0.1:9091", token: "metrics-token"},
		{name: "missing token", bind: "127.0.0.1:9091", wantErr: true},
		{name: "missing bind", token: "metrics-token", wantErr: true},
		{name: "wildcard", bind: ":9091", token: "metrics-token", wantErr: true},
		{name: "public IP", bind: "8.8.8.8:9091", token: "metrics-token", wantErr: true},
		{name: "shared token", bind: "127.0.0.1:9091", token: "api-token", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cfg := Config{
				Token:        "api-token",
				MetricsBind:  test.bind,
				MetricsToken: test.token,
			}
			err := cfg.ValidateServe()
			if (err != nil) != test.wantErr {
				t.Fatalf("ValidateServe() error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}

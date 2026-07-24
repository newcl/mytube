package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Config contains all runtime configuration for the MyTube service.
type Config struct {
	Bind                string
	Token               string
	StateDir            string
	DBPath              string
	DownloadDir         string
	Concurrency         int
	CORSOrigins         []string
	PublicBase          string
	CookieBrowser       string
	CookieFile          string
	JSRuntime           string
	YTDLPPath           string
	YTDLPUpdateInterval time.Duration
}

// Load reads an optional KEY=VALUE configuration file and overlays process
// environment variables. Process environment values always win.
func Load(configPath string) (Config, error) {
	values := make(map[string]string)
	if configPath != "" {
		fileValues, err := readEnvFile(configPath)
		if err != nil {
			return Config{}, err
		}
		values = fileValues
	}

	get := func(key string) string {
		if value, ok := os.LookupEnv(key); ok {
			return value
		}
		return values[key]
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}, fmt.Errorf("determine user home: %w", err)
	}
	defaults := Defaults(runtime.GOOS, home)

	concurrency := defaults.Concurrency
	if value := get("MYTUBE_CONCURRENCY"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 {
			return Config{}, fmt.Errorf("MYTUBE_CONCURRENCY must be a positive integer")
		}
		concurrency = n
	}

	ytdlpUpdateInterval := defaults.YTDLPUpdateInterval
	if value := strings.TrimSpace(get("MYTUBE_YTDLP_UPDATE_INTERVAL")); value != "" {
		if value == "0" {
			ytdlpUpdateInterval = 0
		} else {
			interval, err := time.ParseDuration(value)
			if err != nil || interval <= 0 {
				return Config{}, fmt.Errorf("MYTUBE_YTDLP_UPDATE_INTERVAL must be 0 or a positive duration")
			}
			ytdlpUpdateInterval = interval
		}
	}

	stateDir := valueOr(get("MYTUBE_STATE_DIR"), defaults.StateDir)
	dbPath := get("MYTUBE_DB_PATH")
	if dbPath == "" {
		dbPath = filepath.Join(stateDir, "mytube.db")
	}
	downloadDir := get("MYTUBE_DOWNLOAD_DIR")
	if downloadDir == "" {
		downloadDir = filepath.Join(stateDir, "downloads")
	}
	cookieBrowser := get("MYTUBE_COOKIE_BROWSER")
	cookieFile := get("MYTUBE_COOKIE_FILE")
	if cookieBrowser == "" && cookieFile == "" {
		cookieBrowser = defaults.CookieBrowser
	}

	return Config{
		Bind:                valueOr(get("MYTUBE_BIND"), defaults.Bind),
		Token:               get("MYTUBE_TOKEN"),
		StateDir:            stateDir,
		DBPath:              dbPath,
		DownloadDir:         downloadDir,
		Concurrency:         concurrency,
		CORSOrigins:         strings.Split(valueOr(get("MYTUBE_CORS_ORIGIN"), defaults.CORSOrigins[0]), ","),
		PublicBase:          get("MYTUBE_PUBLIC_BASE_URL"),
		CookieBrowser:       cookieBrowser,
		CookieFile:          cookieFile,
		JSRuntime:           get("MYTUBE_JS_RUNTIME"),
		YTDLPPath:           get("MYTUBE_YTDLP_PATH"),
		YTDLPUpdateInterval: ytdlpUpdateInterval,
	}, nil
}

// Defaults returns platform-aware defaults. Linux defaults remain compatible
// with the container and existing deployments.
func Defaults(goos, home string) Config {
	if goos == "darwin" {
		stateDir := filepath.Join(home, "Library", "Application Support", "MyTube")
		return Config{
			Bind:                "127.0.0.1:8081",
			StateDir:            stateDir,
			DBPath:              filepath.Join(stateDir, "mytube.db"),
			DownloadDir:         filepath.Join(stateDir, "downloads"),
			Concurrency:         2,
			CORSOrigins:         []string{"https://mytube.elladali.com"},
			CookieBrowser:       "chrome",
			YTDLPUpdateInterval: 7 * 24 * time.Hour,
		}
	}

	return Config{
		Bind:        ":8080",
		StateDir:    "./data",
		DBPath:      "./data/mytube.db",
		DownloadDir: "./data/downloads",
		Concurrency: 3,
		CORSOrigins: []string{"https://mytube.elladali.com"},
	}
}

// ValidateServe validates configuration required to start the HTTP service.
func (c Config) ValidateServe() error {
	if strings.TrimSpace(c.Token) == "" {
		return fmt.Errorf("MYTUBE_TOKEN is required")
	}
	if c.CookieBrowser != "" && c.CookieFile != "" {
		return fmt.Errorf("set only one of MYTUBE_COOKIE_BROWSER and MYTUBE_COOKIE_FILE")
	}
	return nil
}

func readEnvFile(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open config file: %w", err)
	}
	defer file.Close()

	values := make(map[string]string)
	scanner := bufio.NewScanner(file)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("%s:%d: expected KEY=VALUE", path, lineNumber)
		}
		key = strings.TrimSpace(key)
		if key == "" || strings.ContainsAny(key, " \t") {
			return nil, fmt.Errorf("%s:%d: invalid key", path, lineNumber)
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		values[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}
	return values, nil
}

func valueOr(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

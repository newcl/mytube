package tooling

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Values are supplied by the native packaging script through -ldflags.
var (
	EmbeddedYTDLPVersion = "unpackaged"
	EmbeddedYTDLPSHA256  = ""
)

//go:embed assets/*
var assets embed.FS

type YTDLP struct {
	Path    string
	Source  string
	Version string
}

// ResolveYTDLP selects an explicit override, a previously managed executable,
// the packaged payload, or finally an executable on PATH.
func ResolveYTDLP(ctx context.Context, overridePath, stateDir string) (YTDLP, error) {
	if overridePath != "" {
		path, err := validateExecutable(overridePath)
		if err != nil {
			return YTDLP{}, fmt.Errorf("MYTUBE_YTDLP_PATH: %w", err)
		}
		return inspectYTDLP(ctx, path, "configured")
	}

	managedPath := filepath.Join(stateDir, "tools", "yt-dlp", "current", "yt-dlp")
	if path, err := validateExecutable(managedPath); err == nil {
		return inspectYTDLP(ctx, path, "managed")
	}

	if payload, err := assets.ReadFile("assets/yt-dlp_macos"); err == nil {
		path, err := materializeYTDLP(payload, stateDir)
		if err != nil {
			return YTDLP{}, err
		}
		return inspectYTDLP(ctx, path, "packaged")
	} else if !errors.Is(err, fs.ErrNotExist) {
		return YTDLP{}, fmt.Errorf("read packaged yt-dlp: %w", err)
	}

	path, err := exec.LookPath("yt-dlp")
	if err != nil {
		return YTDLP{}, fmt.Errorf("yt-dlp not found: package it or set MYTUBE_YTDLP_PATH")
	}
	return inspectYTDLP(ctx, path, "PATH")
}

func materializeYTDLP(payload []byte, stateDir string) (string, error) {
	if len(payload) == 0 {
		return "", fmt.Errorf("packaged yt-dlp payload is empty")
	}
	version := sanitizeVersion(EmbeddedYTDLPVersion)
	sum := sha256.Sum256(payload)
	actualSHA := hex.EncodeToString(sum[:])
	if EmbeddedYTDLPSHA256 != "" && !strings.EqualFold(actualSHA, EmbeddedYTDLPSHA256) {
		return "", fmt.Errorf("packaged yt-dlp checksum mismatch")
	}

	dir := filepath.Join(stateDir, "tools", "yt-dlp", version)
	path := filepath.Join(dir, "yt-dlp")
	if existing, err := os.ReadFile(path); err == nil {
		existingSum := sha256.Sum256(existing)
		if existingSum == sum {
			if err := os.Chmod(path, 0755); err != nil {
				return "", fmt.Errorf("set yt-dlp permissions: %w", err)
			}
			return path, nil
		}
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("create yt-dlp tool directory: %w", err)
	}
	temp, err := os.CreateTemp(dir, ".yt-dlp-*")
	if err != nil {
		return "", fmt.Errorf("create temporary yt-dlp: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	if _, err := temp.Write(payload); err != nil {
		temp.Close()
		return "", fmt.Errorf("write yt-dlp: %w", err)
	}
	if err := temp.Chmod(0755); err != nil {
		temp.Close()
		return "", fmt.Errorf("set yt-dlp permissions: %w", err)
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return "", fmt.Errorf("sync yt-dlp: %w", err)
	}
	if err := temp.Close(); err != nil {
		return "", fmt.Errorf("close yt-dlp: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return "", fmt.Errorf("install yt-dlp: %w", err)
	}
	return path, nil
}

func inspectYTDLP(ctx context.Context, path, source string) (YTDLP, error) {
	versionCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(versionCtx, path, "--version").CombinedOutput()
	if err != nil {
		return YTDLP{}, fmt.Errorf("run %s --version: %w (%s)", path, err, strings.TrimSpace(string(output)))
	}
	return YTDLP{
		Path:    path,
		Source:  source,
		Version: strings.TrimSpace(string(output)),
	}, nil
}

func validateExecutable(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("%s is a directory", absolute)
	}
	if info.Mode()&0111 == 0 {
		return "", fmt.Errorf("%s is not executable", absolute)
	}
	return absolute, nil
}

func sanitizeVersion(version string) string {
	version = strings.TrimSpace(version)
	if version == "" {
		return "unknown"
	}
	var out strings.Builder
	for _, r := range version {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			out.WriteRune(r)
		default:
			out.WriteByte('_')
		}
	}
	return out.String()
}

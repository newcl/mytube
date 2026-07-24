package tooling

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/unix"
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

type YTDLPUpdate struct {
	Before YTDLP
	After  YTDLP
	Output string
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

// UpdateManagedYTDLP copies the selected executable into the managed slot,
// lets yt-dlp's own updater replace it, verifies the result, and keeps the
// previous executable for rollback.
func UpdateManagedYTDLP(ctx context.Context, source YTDLP, stateDir, channel string) (YTDLPUpdate, error) {
	if channel == "" {
		channel = "stable"
	}

	var result YTDLPUpdate
	err := withYTDLPLock(stateDir, func() error {
		currentPath := managedYTDLPPath(stateDir, "current")
		previousPath := managedYTDLPPath(stateDir, "previous")

		current, err := inspectYTDLP(ctx, currentPath, "managed")
		if err != nil {
			if err := copyExecutableAtomic(source.Path, currentPath); err != nil {
				return fmt.Errorf("seed managed yt-dlp: %w", err)
			}
			current, err = inspectYTDLP(ctx, currentPath, "managed")
			if err != nil {
				return err
			}
		}
		result.Before = current

		if err := copyExecutableAtomic(currentPath, previousPath); err != nil {
			return fmt.Errorf("back up current yt-dlp: %w", err)
		}

		updateCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		output, err := exec.CommandContext(updateCtx, currentPath, "--update-to", channel).CombinedOutput()
		result.Output = strings.TrimSpace(string(output))
		if err != nil {
			_ = copyExecutableAtomic(previousPath, currentPath)
			return fmt.Errorf("yt-dlp update failed: %w (%s)", err, result.Output)
		}

		updated, err := inspectYTDLP(ctx, currentPath, "managed")
		if err != nil {
			_ = copyExecutableAtomic(previousPath, currentPath)
			return fmt.Errorf("verify updated yt-dlp: %w", err)
		}
		result.After = updated
		return nil
	})
	return result, err
}

// RollbackManagedYTDLP swaps the managed current and previous executables.
func RollbackManagedYTDLP(ctx context.Context, stateDir string) (YTDLPUpdate, error) {
	var result YTDLPUpdate
	err := withYTDLPLock(stateDir, func() error {
		currentPath := managedYTDLPPath(stateDir, "current")
		previousPath := managedYTDLPPath(stateDir, "previous")

		current, err := inspectYTDLP(ctx, currentPath, "managed")
		if err != nil {
			return fmt.Errorf("current managed yt-dlp is unavailable: %w", err)
		}
		previous, err := inspectYTDLP(ctx, previousPath, "managed-previous")
		if err != nil {
			return fmt.Errorf("no rollback version is available: %w", err)
		}
		result.Before = current

		swapPath := managedYTDLPPath(stateDir, ".rollback-swap")
		if err := copyExecutableAtomic(currentPath, swapPath); err != nil {
			return fmt.Errorf("prepare rollback: %w", err)
		}
		defer os.Remove(swapPath)
		if err := copyExecutableAtomic(previousPath, currentPath); err != nil {
			return fmt.Errorf("restore previous yt-dlp: %w", err)
		}
		if err := copyExecutableAtomic(swapPath, previousPath); err != nil {
			_ = copyExecutableAtomic(swapPath, currentPath)
			return fmt.Errorf("preserve replaced yt-dlp: %w", err)
		}

		rolledBack, err := inspectYTDLP(ctx, currentPath, "managed")
		if err != nil {
			return fmt.Errorf("verify rolled-back yt-dlp: %w", err)
		}
		result.After = rolledBack
		result.Output = fmt.Sprintf("swapped with rollback version %s", previous.Version)
		return nil
	})
	return result, err
}

func managedYTDLPPath(stateDir, slot string) string {
	return filepath.Join(stateDir, "tools", "yt-dlp", slot, "yt-dlp")
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
	versionCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
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

func copyExecutableAtomic(sourcePath, destinationPath string) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	if err := os.MkdirAll(filepath.Dir(destinationPath), 0755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(destinationPath), ".yt-dlp-copy-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	if _, err := io.Copy(temp, source); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Chmod(0755); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, destinationPath)
}

func withYTDLPLock(stateDir string, action func() error) error {
	lockDir := filepath.Join(stateDir, "tools", "yt-dlp")
	if err := os.MkdirAll(lockDir, 0755); err != nil {
		return err
	}
	lock, err := os.OpenFile(filepath.Join(lockDir, ".update.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()

	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX); err != nil {
		return err
	}
	defer unix.Flock(int(lock.Fd()), unix.LOCK_UN)
	return action()
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

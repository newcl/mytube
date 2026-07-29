package tooling

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type YTDLP struct {
	Path    string
	Source  string
	Version string
}

// ResolveYTDLP selects an explicit executable or discovers yt-dlp on PATH.
// Native macOS installs use Homebrew's yt-dlp instead of embedding the slower
// standalone executable in MyTube.
func ResolveYTDLP(ctx context.Context, overridePath string) (YTDLP, error) {
	if overridePath != "" {
		path, err := validateExecutable(overridePath)
		if err != nil {
			return YTDLP{}, fmt.Errorf("MYTUBE_YTDLP_PATH: %w", err)
		}
		return inspectYTDLP(ctx, path, "configured")
	}

	path, err := exec.LookPath("yt-dlp")
	if err != nil {
		return YTDLP{}, fmt.Errorf("yt-dlp not found on PATH; install it with Homebrew or set MYTUBE_YTDLP_PATH")
	}
	return inspectYTDLP(ctx, path, "PATH")
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

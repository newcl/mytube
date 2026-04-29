package worker

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	dbpkg "github.com/newcl/mytube/backend/internal/db"
)

const (
	logCapBytes      = 32 * 1024 // 32 KB cap for log tail
	progressThrottle = 500 * time.Millisecond
	pollInterval     = 2 * time.Second
)

// Worker polls for queued jobs and runs them concurrently up to concurrency.
type Worker struct {
	db            *sql.DB
	downloadDir   string
	concurrency   int
	cookieBrowser string // if set, use --cookies-from-browser <browser> instead of a cookie file
	sem           chan struct{}
}

// New creates a new Worker.
func New(db *sql.DB, downloadDir string, concurrency int, cookieBrowser string) *Worker {
	if concurrency < 1 {
		concurrency = 1
	}
	// Resolve to absolute path so prefix checks work regardless of working dir.
	if abs, err := filepath.Abs(downloadDir); err == nil {
		downloadDir = abs
	}
	return &Worker{
		db:            db,
		downloadDir:   downloadDir,
		concurrency:   concurrency,
		cookieBrowser: cookieBrowser,
		sem:           make(chan struct{}, concurrency),
	}
}

// Run starts the worker loop (blocks until ctx is cancelled).
func (w *Worker) Run(ctx context.Context) {
	log.Printf("worker: starting, concurrency=%d, downloadDir=%s", w.concurrency, w.downloadDir)
	if err := os.MkdirAll(w.downloadDir, 0755); err != nil {
		log.Printf("worker: create download dir: %v", err)
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.poll(ctx)
		}
	}
}

func (w *Worker) poll(ctx context.Context) {
	free := cap(w.sem) - len(w.sem)
	if free <= 0 {
		return
	}

	jobs, err := dbpkg.DequeueJobs(w.db, free)
	if err != nil {
		log.Printf("worker: dequeue: %v", err)
		return
	}

	for _, j := range jobs {
		select {
		case w.sem <- struct{}{}:
		default:
			return
		}

		if err := dbpkg.SetJobDownloading(w.db, j.ID); err != nil {
			log.Printf("worker: set downloading job %d: %v", j.ID, err)
			<-w.sem
			continue
		}

		go func(job *dbpkg.Job) {
			defer func() { <-w.sem }()
			w.download(ctx, job)
		}(j)
	}
}

func (w *Worker) download(ctx context.Context, job *dbpkg.Job) {
	log.Printf("worker: starting job %d url=%s", job.ID, job.URL)

	outputTemplate := w.downloadDir + "/%(title).200B-%(id)s.%(ext)s"

	args := []string{
		"--newline",
		"--no-colors",
		"--progress",   // force progress output even when stdout is a pipe (non-TTY)
		"--no-part",    // write directly to final filename so file is readable mid-download
		"--no-continue", // don't try to resume partial files (avoids HTTP 416 errors)
		// Combined single-stream: no merge step needed, file is playable immediately.
		// Format 18 = YouTube's 360p H.264+AAC mp4 (always available).
		"--format", "18/best[ext=mp4][vcodec^=avc1]/best[ext=mp4]",
		"--write-info-json",
		"--no-playlist",
		"--output", outputTemplate,
		"--print", "before_dl:filename",  // emitted once before download starts (filename = pre-move path)
		"--print", "after_move:filepath", // emitted once after completion (filepath = final path)
	}

	// Cookie source: live browser (Mac, residential IP) or cookie file (VPS).
	if w.cookieBrowser != "" {
		args = append(args, "--cookies-from-browser", w.cookieBrowser)
	}

	args = append(args, job.URL)

	cmd := exec.CommandContext(ctx, "yt-dlp", args...)

	var logBuf bytes.Buffer
	pr, pw, err := os.Pipe()
	if err != nil {
		_ = dbpkg.SetJobFailed(w.db, job.ID, fmt.Sprintf("pipe: %v", err), "")
		return
	}

	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		pw.Close()
		pr.Close()
		_ = dbpkg.SetJobFailed(w.db, job.ID, fmt.Sprintf("start yt-dlp: %v", err), "")
		return
	}
	pw.Close() // parent closes write end

	var (
		mu           sync.Mutex
		lastProgress time.Time
		outputFile   string
		pathWritten  bool // true once before_dl path stored in DB
	)

	done := make(chan struct{})
	go func() {
		defer close(done)
		scanner := bufio.NewScanner(pr)
		for scanner.Scan() {
			line := scanner.Text()
			logBuf.WriteString(line)
			logBuf.WriteByte('\n')

			// Both --print before_dl:filepath and after_move:filepath emit an absolute path.
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, w.downloadDir) {
				mu.Lock()
				outputFile = trimmed
				if !pathWritten {
					pathWritten = true
					mu.Unlock()
					// Store path early so the file endpoint can serve partial bytes.
					_ = dbpkg.SetJobOutputPath(w.db, job.ID, trimmed)
				} else {
					mu.Unlock()
				}
				continue
			}

			if p := parseProgress(line); p != nil {
				mu.Lock()
				if time.Since(lastProgress) >= progressThrottle {
					lastProgress = time.Now()
					mu.Unlock()
					_ = dbpkg.UpdateJobProgress(w.db, job.ID, p)
				} else {
					mu.Unlock()
				}
			}
		}
	}()

	waitErr := cmd.Wait()
	<-done // drain all output before closing
	pr.Close()

	mu.Lock()
	outFile := outputFile
	mu.Unlock()

	logTail := capLog(logBuf.String())

	if waitErr != nil {
		_ = dbpkg.SetJobFailed(w.db, job.ID, waitErr.Error(), logTail)
		log.Printf("worker: job %d failed: %v", job.ID, waitErr)
		return
	}

	meta := readInfoJSON(outFile)

	err = dbpkg.SetJobCompleted(w.db, job.ID, dbpkg.CompletedFields{
		OutputPath:   outFile,
		Title:        meta.Title,
		Uploader:     meta.Uploader,
		ThumbnailURL: meta.Thumbnail,
		Extractor:    meta.Extractor,
		WebpageURL:   meta.WebpageURL,
		LogTail:      logTail,
	})
	if err != nil {
		log.Printf("worker: set completed job %d: %v", job.ID, err)
	} else {
		log.Printf("worker: job %d completed: %s", job.ID, outFile)
	}
}

// ---- progress parsing -------------------------------------------------------

// Example yt-dlp --newline progress line:
// [download]  42.1% of  ~123.45MiB at    1.23MiB/s ETA 00:35
var progressRe = regexp.MustCompile(
	`\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\s*\S+)\s+at\s+([\d.]+\s*\S+/s)\s+ETA\s+(\S+)`,
)

func parseProgress(line string) *dbpkg.Progress {
	m := progressRe.FindStringSubmatch(line)
	if m == nil {
		return nil
	}
	pct, _ := strconv.ParseFloat(m[1], 64)
	return &dbpkg.Progress{
		Percent: pct,
		Speed:   m[3],
		ETA:     m[4],
	}
}

// ---- log helpers ------------------------------------------------------------

func capLog(s string) string {
	if len(s) <= logCapBytes {
		return s
	}
	return "...(truncated)\n" + s[len(s)-logCapBytes:]
}

// ---- metadata ---------------------------------------------------------------

type videoMeta struct {
	Title      string
	Uploader   string
	Thumbnail  string
	Extractor  string
	WebpageURL string
}

func readInfoJSON(videoPath string) videoMeta {
	if videoPath == "" {
		return videoMeta{}
	}

	// yt-dlp writes <basename>.info.json alongside the video
	base := videoPath
	for _, ext := range []string{".mp4", ".mkv", ".webm", ".m4a", ".opus"} {
		if strings.HasSuffix(base, ext) {
			base = strings.TrimSuffix(base, ext)
			break
		}
	}
	infoPath := base + ".info.json"

	data, err := os.ReadFile(infoPath)
	if err != nil {
		return videoMeta{}
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return videoMeta{}
	}

	return videoMeta{
		Title:      strVal(raw, "title"),
		Uploader:   firstStrVal(raw, "uploader", "channel"),
		Thumbnail:  strVal(raw, "thumbnail"),
		Extractor:  strVal(raw, "extractor"),
		WebpageURL: strVal(raw, "webpage_url"),
	}
}

func strVal(m map[string]any, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func firstStrVal(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v := strVal(m, k); v != "" {
			return v
		}
	}
	return ""
}

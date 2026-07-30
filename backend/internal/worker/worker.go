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
	logCapBytes          = 32 * 1024 // 32 KB cap for log tail
	progressThrottle     = 500 * time.Millisecond
	pollInterval         = 250 * time.Millisecond
	subBackfillInterval  = 1 * time.Minute
	subBackfillBatchSize = 20
	hlsConcurrentFrags   = 4

	directFirstFormat = "18/93/best[height<=360][protocol=m3u8_native][ext=mp4]/best[ext=mp4][vcodec^=avc1]/best[ext=mp4]"
	hlsFirstFormat    = "93/best[height<=360][protocol=m3u8_native][ext=mp4]/18/best[ext=mp4][vcodec^=avc1]/best[ext=mp4]"
)

// Worker polls for queued jobs and runs them concurrently up to concurrency.
type Worker struct {
	db            *sql.DB
	downloadDir   string
	ytdlpPath     string
	concurrency   int
	cookieBrowser string // if set, use --cookies-from-browser <browser> instead of a cookie file
	cookieFile    string // if set, use --cookies <path>
	jsRuntime     string // if set, pass --js-runtimes <runtime> to yt-dlp
	sem           chan struct{}
	backfillMu    sync.Mutex
}

// New creates a new Worker.
func New(db *sql.DB, downloadDir, ytdlpPath string, concurrency int, cookieBrowser, cookieFile, jsRuntime string) *Worker {
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
		ytdlpPath:     ytdlpPath,
		concurrency:   concurrency,
		cookieBrowser: cookieBrowser,
		cookieFile:    cookieFile,
		jsRuntime:     jsRuntime,
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

	backfillTicker := time.NewTicker(subBackfillInterval)
	defer backfillTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-backfillTicker.C:
			w.backfillSubtitles(ctx)
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
	result := w.runDownloadAttempt(ctx, job, outputTemplate, false)
	combinedLog := result.log

	if w.shouldRetryWithHLS(ctx, result) {
		log.Printf("worker: job %d direct MP4 failed; retrying with HLS: %v", job.ID, result.err)
		fallback := w.runDownloadAttempt(ctx, job, outputTemplate, true)
		combinedLog += "\n--- direct MP4 failed; HLS fallback ---\n" + fallback.log
		result = fallback
	}

	logTail := capLog(combinedLog)
	if result.err != nil {
		_ = dbpkg.SetJobFailed(w.db, job.ID, result.err.Error(), logTail)
		log.Printf("worker: job %d failed: %v", job.ID, result.err)
		return
	}

	meta := readInfoJSON(result.outputFile)

	err := dbpkg.SetJobCompleted(w.db, job.ID, dbpkg.CompletedFields{
		OutputPath:   result.outputFile,
		Title:        meta.Title,
		Uploader:     meta.Uploader,
		ThumbnailURL: meta.Thumbnail,
		DurationSecs: meta.Duration,
		Extractor:    meta.Extractor,
		WebpageURL:   meta.WebpageURL,
		LogTail:      logTail,
	})
	if err != nil {
		log.Printf("worker: set completed job %d: %v", job.ID, err)
	} else {
		log.Printf("worker: job %d completed: %s", job.ID, result.outputFile)
	}
}

func (w *Worker) shouldRetryWithHLS(ctx context.Context, result downloadAttemptResult) bool {
	return result.err != nil &&
		w.cookieBrowser != "" &&
		ctx.Err() == nil &&
		(result.formatID == "18" || result.formatID == "")
}

type downloadAttemptResult struct {
	err        error
	outputFile string
	formatID   string
	log        string
}

func (w *Worker) runDownloadAttempt(ctx context.Context, job *dbpkg.Job, outputTemplate string, hlsFallback bool) downloadAttemptResult {
	cmd := exec.CommandContext(ctx, w.ytdlpPath, w.downloadArgs(outputTemplate, job.URL, hlsFallback)...)

	var logBuf bytes.Buffer
	pr, pw, err := os.Pipe()
	if err != nil {
		return downloadAttemptResult{err: fmt.Errorf("pipe: %w", err)}
	}

	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		pw.Close()
		pr.Close()
		return downloadAttemptResult{err: fmt.Errorf("start yt-dlp: %w", err)}
	}
	pw.Close() // parent closes write end

	var (
		mu           sync.Mutex
		lastProgress time.Time
		outputFile   string
		formatID     string
		pathWritten  bool // true once before_dl path stored in DB
		metaWritten  bool // true once metadata from info.json stored in DB
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
			if strings.HasPrefix(trimmed, "mytube-format=") {
				mu.Lock()
				formatID = strings.TrimPrefix(trimmed, "mytube-format=")
				mu.Unlock()
				continue
			}
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

			mu.Lock()
			candidate := outputFile
			canWriteMeta := pathWritten && !metaWritten && candidate != ""
			mu.Unlock()
			if canWriteMeta {
				meta := readInfoJSON(candidate)
				if meta.Title != "" || meta.Uploader != "" || meta.Thumbnail != "" || meta.Duration > 0 {
					_ = dbpkg.SetJobMetadata(w.db, job.ID, meta.Title, meta.Uploader, meta.Thumbnail, meta.Duration)
					mu.Lock()
					metaWritten = true
					mu.Unlock()
				}
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
	selectedFormat := formatID
	mu.Unlock()

	return downloadAttemptResult{
		err:        waitErr,
		outputFile: outFile,
		formatID:   selectedFormat,
		log:        logBuf.String(),
	}
}

func (w *Worker) downloadArgs(outputTemplate, url string, hlsFallback bool) []string {
	args := []string{
		"--newline",
		"--no-colors",
		"--progress",    // force progress output even when stdout is a pipe (non-TTY)
		"--no-part",     // write directly to final filename so file is readable mid-download
		"--no-continue", // don't try to resume partial files (avoids HTTP 416 errors)
		"--write-info-json",
		"--no-playlist",
		"--output", outputTemplate,
		"--print", "before_dl:mytube-format=%(format_id)s",
		"--print", "before_dl:filename", // emitted once before download starts (filename = pre-move path)
		"--print", "after_move:filepath", // emitted once after completion (filepath = final path)
	}

	if w.cookieBrowser != "" {
		if hlsFallback {
			// A failed direct MP4 can leave a partial final file because downloads
			// are intentionally visible while in progress. Replace it on retry.
			args = append(args,
				"--force-overwrites",
				"--extractor-args", "youtube:player_client=web_safari",
				"--format", hlsFirstFormat,
			)
		} else {
			// Start the direct MP4 immediately. If YouTube rejects it, download()
			// retries with the reliable HLS route instead of probing up front.
			args = append(args, "--format", directFirstFormat)
		}
		args = append(args,
			"--concurrent-fragments", strconv.Itoa(hlsConcurrentFrags),
			"--cookies-from-browser", w.cookieBrowser,
		)
	} else if w.cookieFile != "" {
		// Server deployments retain the web_safari HLS route that avoids the
		// proof-of-origin 403 observed from the VM.
		args = append(args,
			"--extractor-args", "youtube:player_client=web_safari",
			"--format", hlsFirstFormat,
			"--concurrent-fragments", strconv.Itoa(hlsConcurrentFrags),
			"--cookies", w.cookieFile,
		)
	} else {
		args = append(args,
			"--format", directFirstFormat,
			"--concurrent-fragments", strconv.Itoa(hlsConcurrentFrags),
		)
	}
	if w.jsRuntime != "" {
		args = append(args, "--js-runtimes", w.jsRuntime)
	}
	return append(args, url)
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
	Duration   float64
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
		Duration:   numVal(raw, "duration"),
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

func numVal(m map[string]any, key string) float64 {
	v, ok := m[key]
	if !ok || v == nil {
		return 0
	}
	if f, ok := v.(float64); ok {
		return f
	}
	if s, ok := v.(string); ok {
		f, err := strconv.ParseFloat(s, 64)
		if err == nil {
			return f
		}
	}
	return 0
}

// ---- subtitle backfill -------------------------------------------------------

func (w *Worker) backfillSubtitles(ctx context.Context) {
	if !w.backfillMu.TryLock() {
		return // previous run still in progress
	}
	defer w.backfillMu.Unlock()

	jobs, err := dbpkg.GetJobsForSubtitleBackfill(w.db, subBackfillBatchSize)
	if err != nil {
		log.Printf("worker: subtitle backfill query: %v", err)
		return
	}
	log.Printf("worker: subtitle backfill found %d unchecked jobs", len(jobs))
	if len(jobs) == 0 {
		return
	}

	log.Printf("worker: subtitle backfill checking %d jobs", len(jobs))
	for _, job := range jobs {
		if err := ctx.Err(); err != nil {
			return
		}

		downloaded, rateLimited := w.tryDownloadSubsForJob(ctx, job)
		if !rateLimited {
			_ = dbpkg.MarkJobSubtitlesChecked(w.db, job.ID)
		} else {
			log.Printf("worker: subtitle backfill job %d: rate-limited, will retry later", job.ID)
		}

		if downloaded > 0 {
			log.Printf("worker: subtitle backfill job %d: downloaded %d files", job.ID, downloaded)
		}
	}
}

func (w *Worker) tryDownloadSubsForJob(ctx context.Context, job dbpkg.SubtitleBackfillJob) (count int, rateLimited bool) {
	outputDir := filepath.Dir(job.OutputPath)
	base := job.OutputPath
	for _, ext := range []string{".mp4", ".mkv", ".webm", ".m4a", ".opus"} {
		if strings.HasSuffix(base, ext) {
			base = strings.TrimSuffix(base, ext)
			break
		}
	}

	// Check which subtitle files already exist; only download missing ones
	langs := []string{"en", "zh-Hans", "zh-Hant", "zh-CN", "zh-TW"}
	var missing []string
	for _, lang := range langs {
		p := base + "." + lang + ".vtt"
		if _, err := os.Stat(p); os.IsNotExist(err) {
			missing = append(missing, lang)
		}
	}
	if len(missing) == 0 {
		return 0, false
	}

	joinedLangs := strings.Join(missing, ",")
	args := []string{
		"--skip-download",
		"--write-subs",
		"--write-auto-subs",
		"--sub-langs", joinedLangs,
		"--no-playlist",
		"--extractor-args", "youtube:player_client=web_safari",
		"--output", outputDir + "/%(title).200B-%(id)s.%(ext)s",
	}

	if w.cookieBrowser != "" {
		args = append(args, "--cookies-from-browser", w.cookieBrowser)
	} else if w.cookieFile != "" {
		args = append(args, "--cookies", w.cookieFile)
	}
	if w.jsRuntime != "" {
		args = append(args, "--js-runtimes", w.jsRuntime)
	}
	args = append(args, job.URL)

	dlCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	cmd := exec.CommandContext(dlCtx, w.ytdlpPath, args...)
	output, err := cmd.CombinedOutput()
	outStr := strings.TrimSpace(string(output))
	if err != nil {
		// HTTP 429 means rate-limited — don't mark as checked so we retry later.
		// yt-dlp prints "HTTP Error 429" when the server returns 429.
		if strings.Contains(outStr, "HTTP Error 429") {
			log.Printf("worker: subtitle backfill job %d: rate-limited: %v", job.ID, err)
			return 0, true
		}
		// Genuine errors (video removed, network failure, etc.) — mark done.
		log.Printf("worker: subtitle backfill job %d: yt-dlp: %v (output: %s)", job.ID, err, outStr)
	}

	// Count how many actually got downloaded
	count = 0
	for _, lang := range langs {
		p := base + "." + lang + ".vtt"
		if _, err := os.Stat(p); err == nil {
			count++
		}
	}
	return count, false
}

package worker

import (
	"context"
	"errors"
	"slices"
	"testing"
)

func TestDownloadArgsPreferImmediateDirectMP4WithBrowserCookies(t *testing.T) {
	worker := &Worker{cookieBrowser: "chrome", jsRuntime: "deno"}
	args := worker.downloadArgs("/tmp/%(id)s.%(ext)s", "https://example.test/video", false)

	assertArgPair(t, args, "--format", directFirstFormat)
	assertArgPair(t, args, "--cookies-from-browser", "chrome")
	assertArgPair(t, args, "--concurrent-fragments", "4")
	if slices.Contains(args, "--check-formats") {
		t.Fatal("browser-cookie download unexpectedly validates formats before downloading")
	}
	if slices.Contains(args, "youtube:player_client=web_safari") {
		t.Fatal("browser-cookie download unexpectedly forces web_safari")
	}
}

func TestDownloadArgsUseHLSForBrowserCookieFallback(t *testing.T) {
	worker := &Worker{cookieBrowser: "chrome", jsRuntime: "deno"}
	args := worker.downloadArgs("/tmp/%(id)s.%(ext)s", "https://example.test/video", true)

	assertArg(t, args, "--force-overwrites")
	assertArgPair(t, args, "--extractor-args", "youtube:player_client=web_safari")
	assertArgPair(t, args, "--format", hlsFirstFormat)
	assertArgPair(t, args, "--cookies-from-browser", "chrome")
}

func TestDownloadArgsRetainHLSFirstForCookieFile(t *testing.T) {
	worker := &Worker{cookieFile: "/tmp/cookies.txt", jsRuntime: "node"}
	args := worker.downloadArgs("/tmp/%(id)s.%(ext)s", "https://example.test/video", false)

	assertArgPair(t, args, "--extractor-args", "youtube:player_client=web_safari")
	assertArgPair(t, args, "--format", hlsFirstFormat)
	assertArgPair(t, args, "--cookies", "/tmp/cookies.txt")
	if slices.Contains(args, "--check-formats") {
		t.Fatal("cookie-file download unexpectedly enables direct-format probing")
	}
}

func TestShouldRetryDirectMP4FailureWithHLS(t *testing.T) {
	worker := &Worker{cookieBrowser: "chrome"}
	result := downloadAttemptResult{err: errors.New("HTTP Error 403: Forbidden"), formatID: "18"}

	if !worker.shouldRetryWithHLS(context.Background(), result) {
		t.Fatal("direct MP4 failure should trigger HLS fallback")
	}
}

func TestShouldNotRetryFailedHLSOrCancelledDownload(t *testing.T) {
	worker := &Worker{cookieBrowser: "chrome"}
	if worker.shouldRetryWithHLS(context.Background(), downloadAttemptResult{
		err:      errors.New("HLS failed"),
		formatID: "93",
	}) {
		t.Fatal("an HLS failure should not trigger another HLS attempt")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if worker.shouldRetryWithHLS(ctx, downloadAttemptResult{
		err:      errors.New("signal: killed"),
		formatID: "18",
	}) {
		t.Fatal("a cancelled download should not trigger HLS fallback")
	}
}

func assertArg(t *testing.T, args []string, want string) {
	t.Helper()
	if !slices.Contains(args, want) {
		t.Fatalf("arguments do not contain %q: %#v", want, args)
	}
}

func assertArgPair(t *testing.T, args []string, key, value string) {
	t.Helper()
	for index := 0; index+1 < len(args); index++ {
		if args[index] == key && args[index+1] == value {
			return
		}
	}
	t.Fatalf("arguments do not contain %q %q: %#v", key, value, args)
}

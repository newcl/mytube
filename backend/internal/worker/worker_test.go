package worker

import (
	"slices"
	"testing"
)

func TestDownloadArgsPreferValidatedDirectMP4WithBrowserCookies(t *testing.T) {
	worker := &Worker{cookieBrowser: "chrome", jsRuntime: "deno"}
	args := worker.downloadArgs("/tmp/%(id)s.%(ext)s", "https://example.test/video")

	assertArg(t, args, "--check-formats")
	assertArgPair(t, args, "--format", "18/93/best[height<=360][protocol=m3u8_native][ext=mp4]/best[ext=mp4][vcodec^=avc1]/best[ext=mp4]")
	assertArgPair(t, args, "--cookies-from-browser", "chrome")
	assertArgPair(t, args, "--concurrent-fragments", "4")
	if slices.Contains(args, "youtube:player_client=web_safari") {
		t.Fatal("browser-cookie download unexpectedly forces web_safari")
	}
}

func TestDownloadArgsRetainHLSFirstForCookieFile(t *testing.T) {
	worker := &Worker{cookieFile: "/tmp/cookies.txt", jsRuntime: "node"}
	args := worker.downloadArgs("/tmp/%(id)s.%(ext)s", "https://example.test/video")

	assertArgPair(t, args, "--extractor-args", "youtube:player_client=web_safari")
	assertArgPair(t, args, "--format", "93/best[height<=360][protocol=m3u8_native][ext=mp4]/18/best[ext=mp4][vcodec^=avc1]/best[ext=mp4]")
	assertArgPair(t, args, "--cookies", "/tmp/cookies.txt")
	if slices.Contains(args, "--check-formats") {
		t.Fatal("cookie-file download unexpectedly enables direct-format probing")
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

package main

import (
	"bytes"
	"log"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

func TestRedactingLogFormatterHidesQueryToken(t *testing.T) {
	var output bytes.Buffer
	formatter := &redactingLogFormatter{
		delegate: &middleware.DefaultLogFormatter{
			Logger:  log.New(&output, "", 0),
			NoColor: true,
		},
	}
	request := httptest.NewRequest("GET", "https://example.test/files/42?token=super-secret&download=1", nil)
	entry := formatter.NewLogEntry(request)
	entry.Write(206, 1, nil, time.Millisecond, nil)

	got := output.String()
	if strings.Contains(got, "super-secret") {
		t.Fatalf("access log exposed the token: %q", got)
	}
	if !strings.Contains(got, "token=%5BREDACTED%5D") {
		t.Fatalf("access log did not contain a redacted token marker: %q", got)
	}
}

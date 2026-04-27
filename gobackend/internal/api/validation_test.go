package api_test

import (
	"strings"
	"testing"

	apiPkg "github.com/newcl/mytube/backend/internal/api"
)

// expose the internal isValidURL via a wrapper for testing
// (we test the handler indirectly through integration; this tests validation logic)

func TestIsValidURL(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		{"https://www.youtube.com/watch?v=dQw4w9WgXcQ", true},
		{"http://youtu.be/dQw4w9WgXcQ", true},
		{"ftp://example.com/video", false},
		{"", false},
		{"not-a-url", false},
		{strings.Repeat("a", 2049), false},
	}

	for _, c := range cases {
		got := apiPkg.IsValidURL(c.url)
		if got != c.want {
			t.Errorf("IsValidURL(%q) = %v, want %v", c.url, got, c.want)
		}
	}
}

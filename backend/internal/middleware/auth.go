package middleware

import (
	"net/http"
	"strings"
)

// BearerAuth returns a middleware that checks for a valid Bearer token.
// For routes with allowQuery=true it also accepts ?token=<token> (for HTML5 video).
func BearerAuth(token string, allowQuery bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !checkToken(r, token, allowQuery) {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func checkToken(r *http.Request, token string, allowQuery bool) bool {
	// Authorization: Bearer <token>
	if h := r.Header.Get("Authorization"); h != "" {
		parts := strings.SplitN(h, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") && parts[1] == token {
			return true
		}
	}
	// ?token=<token> (files endpoint only)
	if allowQuery && r.URL.Query().Get("token") == token {
		return true
	}
	return false
}

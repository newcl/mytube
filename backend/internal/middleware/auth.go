package middleware

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"
)

type DeviceTokenVerifier interface {
	VerifyToken(context.Context, string) bool
}

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

// APIBearerAuth accepts the server-side master token or a live per-device
// credential. Public clients never receive the master token.
func APIBearerAuth(masterToken string, devices DeviceTokenVerifier, allowQuery bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			candidate := requestToken(r, allowQuery)
			if candidate == "" || (!tokensEqual(candidate, masterToken) && (devices == nil || !devices.VerifyToken(r.Context(), candidate))) {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func checkToken(r *http.Request, token string, allowQuery bool) bool {
	return tokensEqual(requestToken(r, allowQuery), token)
}

func requestToken(r *http.Request, allowQuery bool) string {
	if h := r.Header.Get("Authorization"); h != "" {
		parts := strings.SplitN(h, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
			return parts[1]
		}
	}
	if allowQuery {
		return r.URL.Query().Get("token")
	}
	return ""
}

func tokensEqual(candidate, expected string) bool {
	if candidate == "" || len(candidate) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(expected)) == 1
}

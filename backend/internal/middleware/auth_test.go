package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/newcl/mytube/backend/internal/middleware"
)

type deviceVerifierStub struct {
	token string
}

func (stub deviceVerifierStub) VerifyToken(_ context.Context, token string) bool {
	return token == stub.token
}

const testToken = "test-secret-token"

func okHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func TestBearerAuth_ValidHeader(t *testing.T) {
	h := middleware.BearerAuth(testToken, false)(http.HandlerFunc(okHandler))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+testToken)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestBearerAuth_MissingHeader(t *testing.T) {
	h := middleware.BearerAuth(testToken, false)(http.HandlerFunc(okHandler))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestBearerAuth_WrongToken(t *testing.T) {
	h := middleware.BearerAuth(testToken, false)(http.HandlerFunc(okHandler))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer wrong-token")
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestBearerAuth_QueryToken_Allowed(t *testing.T) {
	h := middleware.BearerAuth(testToken, true)(http.HandlerFunc(okHandler))

	req := httptest.NewRequest(http.MethodGet, "/?token="+testToken, nil)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestBearerAuth_QueryToken_NotAllowed(t *testing.T) {
	h := middleware.BearerAuth(testToken, false)(http.HandlerFunc(okHandler))

	req := httptest.NewRequest(http.MethodGet, "/?token="+testToken, nil)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestBearerAuth_CaseInsensitiveBearer(t *testing.T) {
	h := middleware.BearerAuth(testToken, false)(http.HandlerFunc(okHandler))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "BEARER "+testToken)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestAPIBearerAuthAcceptsDeviceToken(t *testing.T) {
	h := middleware.APIBearerAuth(testToken, deviceVerifierStub{token: "device-token"}, false)(http.HandlerFunc(okHandler))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer device-token")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
}

func TestAPIBearerAuthAllowsDeviceQueryTokenOnlyWhenEnabled(t *testing.T) {
	verifier := deviceVerifierStub{token: "device-token"}
	for _, test := range []struct {
		allow bool
		want  int
	}{{allow: false, want: http.StatusUnauthorized}, {allow: true, want: http.StatusOK}} {
		h := middleware.APIBearerAuth(testToken, verifier, test.allow)(http.HandlerFunc(okHandler))
		req := httptest.NewRequest(http.MethodGet, "/?token=device-token", nil)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != test.want {
			t.Fatalf("allow=%v status=%d, want %d", test.allow, rr.Code, test.want)
		}
	}
}

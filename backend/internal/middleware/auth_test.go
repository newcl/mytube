package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/newcl/mytube/backend/internal/middleware"
)

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

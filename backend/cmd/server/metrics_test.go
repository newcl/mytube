package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	apiPkg "github.com/newcl/mytube/backend/internal/api"
	configPkg "github.com/newcl/mytube/backend/internal/config"
	dbPkg "github.com/newcl/mytube/backend/internal/db"
	deviceauthPkg "github.com/newcl/mytube/backend/internal/deviceauth"
	metricsPkg "github.com/newcl/mytube/backend/internal/metrics"
)

func TestMetricsRouterRequiresDedicatedBearerHeader(t *testing.T) {
	const token = "dedicated-metrics-token"
	router := buildMetricsRouter(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("mytube_build_info 1\n"))
	}), token)

	tests := []struct {
		name          string
		url           string
		authorization string
		wantStatus    int
	}{
		{name: "missing", url: "/metrics", wantStatus: http.StatusUnauthorized},
		{name: "wrong", url: "/metrics", authorization: "Bearer wrong", wantStatus: http.StatusUnauthorized},
		{name: "query token rejected", url: "/metrics?token=" + token, wantStatus: http.StatusUnauthorized},
		{name: "bearer accepted", url: "/metrics", authorization: "Bearer " + token, wantStatus: http.StatusOK},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.url, nil)
			if test.authorization != "" {
				request.Header.Set("Authorization", test.authorization)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
		})
	}
}

func TestMobilePairingCreatesRevocableDeviceCredential(t *testing.T) {
	const masterToken = "admin-token"
	database, err := dbPkg.Open(filepath.Join(t.TempDir(), "mytube.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	devices := deviceauthPkg.NewStore(database)
	handler := &apiPkg.Handler{DB: database, DeviceAuth: devices}
	router := buildRouter(handler, database, devices, configPkg.Config{Token: masterToken}, metricsPkg.New("test", "test", "test"))

	request := httptest.NewRequest(http.MethodPost, "/api/auth/pairings", nil)
	request.Header.Set("Authorization", "Bearer "+masterToken)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("create pairing status = %d, body = %s", response.Code, response.Body.String())
	}
	var pairing struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&pairing); err != nil {
		t.Fatal(err)
	}

	exchangeBody := `{"code":"` + pairing.Code + `","device_name":"Test iPhone"}`
	request = httptest.NewRequest(http.MethodPost, "/api/auth/pairings/exchange", strings.NewReader(exchangeBody))
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("exchange status = %d, body = %s", response.Code, response.Body.String())
	}
	var credential struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(response.Body).Decode(&credential); err != nil {
		t.Fatal(err)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/jobs", nil)
	request.Header.Set("Authorization", "Bearer "+credential.Token)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("device-authenticated API status = %d", response.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/auth/pairings/exchange", strings.NewReader(exchangeBody))
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("replayed pairing status = %d, want 401", response.Code)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/auth/devices", nil)
	request.Header.Set("Authorization", "Bearer "+credential.Token)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("device token on admin route status = %d, want 401", response.Code)
	}
}

func TestTelemetryRouteRequiresAPIBearerToken(t *testing.T) {
	const token = "api-token"
	recorder := metricsPkg.New("test", "test", "test")
	handler := &apiPkg.Handler{TelemetryMetrics: recorder}
	router := buildRouter(handler, nil, nil, configPkg.Config{Token: token, CORSOrigins: []string{"https://example.test"}}, recorder)

	request := httptest.NewRequest(http.MethodPost, "/api/telemetry/events", strings.NewReader(`{}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("without token status = %d, want 401", response.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/telemetry/events", strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer "+token)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("with token status = %d, want 503 from disabled test store", response.Code)
	}
}

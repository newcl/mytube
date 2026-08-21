package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apiPkg "github.com/newcl/mytube/backend/internal/api"
	configPkg "github.com/newcl/mytube/backend/internal/config"
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

func TestTelemetryRouteRequiresAPIBearerToken(t *testing.T) {
	const token = "api-token"
	recorder := metricsPkg.New("test", "test", "test")
	handler := &apiPkg.Handler{TelemetryMetrics: recorder}
	router := buildRouter(handler, nil, configPkg.Config{Token: token, CORSOrigins: []string{"https://example.test"}}, recorder)

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

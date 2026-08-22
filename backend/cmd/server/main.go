package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	analyticsPkg "github.com/newcl/mytube/backend/internal/analytics"
	apiPkg "github.com/newcl/mytube/backend/internal/api"
	configPkg "github.com/newcl/mytube/backend/internal/config"
	dbPkg "github.com/newcl/mytube/backend/internal/db"
	deviceauthPkg "github.com/newcl/mytube/backend/internal/deviceauth"
	metricsPkg "github.com/newcl/mytube/backend/internal/metrics"
	authPkg "github.com/newcl/mytube/backend/internal/middleware"
	toolingPkg "github.com/newcl/mytube/backend/internal/tooling"
	workerPkg "github.com/newcl/mytube/backend/internal/worker"
)

var (
	buildVersion = "dev"
	buildCommit  = "unknown"
	buildDate    = "unknown"
)

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	command := "serve"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		command = args[0]
		args = args[1:]
	}

	switch command {
	case "serve":
		return serveCommand(args)
	case "doctor":
		return doctorCommand(args)
	case "yt-dlp":
		return ytDLPCommand(args)
	case "version":
		fmt.Printf("mytube %s (commit %s, built %s)\n", buildVersion, buildCommit, buildDate)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", command)
		fmt.Fprintln(os.Stderr, "usage: mytube [serve|doctor|yt-dlp|version] [arguments]")
		return 2
	}
}

func ytDLPCommand(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: mytube yt-dlp status [--config PATH]")
		return 2
	}

	action := args[0]
	flags := flag.NewFlagSet("yt-dlp "+action, flag.ContinueOnError)
	configPath := flags.String("config", "", "path to KEY=VALUE configuration file")
	if err := flags.Parse(args[1:]); err != nil {
		return 2
	}

	cfg, err := configPkg.Load(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "configuration: %v\n", err)
		return 1
	}
	ctx := context.Background()

	switch action {
	case "status":
		selected, err := toolingPkg.ResolveYTDLP(ctx, cfg.YTDLPPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "yt-dlp: %v\n", err)
			return 1
		}
		fmt.Printf("yt-dlp %s (%s)\n%s\n", selected.Version, selected.Source, selected.Path)
		return 0

	default:
		fmt.Fprintf(os.Stderr, "unknown yt-dlp action %q\n", action)
		fmt.Fprintln(os.Stderr, "usage: mytube yt-dlp status [--config PATH]")
		return 2
	}
}

func serveCommand(args []string) int {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	configPath := flags.String("config", "", "path to KEY=VALUE configuration file")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	cfg, err := configPkg.Load(*configPath)
	if err != nil {
		log.Printf("configuration: %v", err)
		return 1
	}
	if err := cfg.ValidateServe(); err != nil {
		log.Printf("configuration: %v", err)
		return 1
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ytdlp, err := toolingPkg.ResolveYTDLP(ctx, cfg.YTDLPPath)
	if err != nil {
		log.Printf("yt-dlp: %v", err)
		return 1
	}
	log.Printf("yt-dlp: version=%s source=%s path=%s", ytdlp.Version, ytdlp.Source, ytdlp.Path)

	database, err := dbPkg.Open(cfg.DBPath)
	if err != nil {
		log.Printf("open db: %v", err)
		return 1
	}
	defer database.Close()

	analyticsStore, analyticsErr := analyticsPkg.Open(cfg.AnalyticsPath)
	if analyticsErr != nil {
		log.Printf("analytics disabled: %v", analyticsErr)
	} else {
		defer analyticsStore.Close()
		go analyticsStore.RunMaintenance(ctx)
	}

	recovered, err := dbPkg.RecoverInterruptedJobs(database)
	if err != nil {
		log.Printf("recover interrupted jobs: %v", err)
		return 1
	}
	if recovered > 0 {
		log.Printf("recovered %d interrupted job(s)", recovered)
	}

	appMetrics := metricsPkg.New(buildVersion, buildCommit, buildDate)
	deviceAuth := deviceauthPkg.NewStore(database)
	handler := &apiPkg.Handler{DB: database, Analytics: analyticsStore, DeviceAuth: deviceAuth, TelemetryMetrics: appMetrics}
	router := buildRouter(handler, database, deviceAuth, cfg, appMetrics)

	downloadWorker := workerPkg.New(
		database,
		cfg.DownloadDir,
		ytdlp.Path,
		cfg.Concurrency,
		cfg.CookieBrowser,
		cfg.CookieFile,
		cfg.JSRuntime,
		appMetrics,
	)
	go downloadWorker.Run(ctx)

	server := &http.Server{
		Addr:         cfg.Bind,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
	}

	servers := []namedServer{{name: "server", server: server}}
	if cfg.MetricsBind != "" {
		servers = append(servers, namedServer{
			name: "metrics server",
			server: &http.Server{
				Addr:         cfg.MetricsBind,
				Handler:      buildMetricsRouter(appMetrics.Handler(), cfg.MetricsToken),
				ReadTimeout:  10 * time.Second,
				WriteTimeout: 30 * time.Second,
				IdleTimeout:  60 * time.Second,
			},
		})
	}

	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("server: listening on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErrors <- fmt.Errorf("server: %w", err)
		}
	}()
	if len(servers) > 1 {
		go serveOptionalServer(ctx, servers[1])
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-quit:
		log.Println("server: shutting down")
	case err := <-serverErrors:
		if err != nil {
			log.Printf("server: %v", err)
			return 1
		}
	}

	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	for _, current := range servers {
		if err := current.server.Shutdown(shutdownCtx); err != nil {
			log.Printf("%s: shutdown error: %v", current.name, err)
			return 1
		}
	}
	return 0
}

type namedServer struct {
	name   string
	server *http.Server
}

// serveOptionalServer prevents observability from becoming an application
// dependency. In particular, VMware removes its private Mac interface while
// Fusion is stopped; metrics binding retries after the interface returns while
// the loopback application API continues serving normally.
func serveOptionalServer(ctx context.Context, current namedServer) {
	const retryInterval = 30 * time.Second
	for {
		listener, err := net.Listen("tcp", current.server.Addr)
		if err == nil {
			log.Printf("%s: listening on %s", current.name, current.server.Addr)
			err = current.server.Serve(listener)
			if err == http.ErrServerClosed || ctx.Err() != nil {
				return
			}
		}
		log.Printf("%s: unavailable: %v; retrying in %s", current.name, err, retryInterval)
		timer := time.NewTimer(retryInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func buildRouter(handler *apiPkg.Handler, database *sql.DB, deviceAuth *deviceauthPkg.Store, cfg configPkg.Config, appMetrics *metricsPkg.Recorder) http.Handler {
	router := chi.NewRouter()
	router.Use(appMetrics.HTTPMiddleware)
	router.Use(middleware.RequestLogger(&redactingLogFormatter{
		delegate: &middleware.DefaultLogFormatter{Logger: log.Default(), NoColor: true},
	}))
	router.Use(middleware.Recoverer)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	router.Group(func(router chi.Router) {
		router.Use(authPkg.APIBearerAuth(cfg.Token, deviceAuth))
		router.Post("/api/jobs", handler.PostJob)
		router.Post("/api/telemetry/events", handler.PostTelemetryEvents)
		router.Get("/api/jobs", handler.GetJobs)
		router.Get("/api/jobs/{id}", handler.GetJob)
		router.Delete("/api/jobs/{id}", handler.DeleteJob)
		router.Get("/api/jobs/{id}/log", handler.GetJobLog)
		router.Get("/api/jobs/{id}/subtitles", handler.GetSubtitles)
		router.Get("/api/subtitles/search", handler.SearchAllSubtitles)
	})

	router.Group(func(router chi.Router) {
		router.Use(authPkg.BearerAuth(cfg.Token))
		router.Post("/api/auth/pairings", handler.PostMobilePairing)
		router.Get("/api/auth/devices", handler.GetMobileDevices)
		router.Delete("/api/auth/devices/{id}", handler.DeleteMobileDevice)
	})

	router.Post("/api/auth/pairings/exchange", handler.PostMobilePairingExchange)

	router.Group(func(router chi.Router) {
		router.Use(authPkg.APIBearerAuth(cfg.Token, deviceAuth))
		router.Get("/files/{id}", apiPkg.ServeFile(database))
	})

	router.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	return router
}

func buildMetricsRouter(metricsHandler http.Handler, token string) http.Handler {
	router := chi.NewRouter()
	router.Use(authPkg.BearerAuth(token))
	router.Get("/metrics", metricsHandler.ServeHTTP)
	return router
}

// redactingLogFormatter is defense in depth for stale clients or malformed
// requests. Authentication credentials are not accepted from query strings.
type redactingLogFormatter struct {
	delegate middleware.LogFormatter
}

func (f *redactingLogFormatter) NewLogEntry(r *http.Request) middleware.LogEntry {
	if r.URL.Query().Has("token") {
		redactedRequest := r.Clone(r.Context())
		redactedURL := *r.URL
		query := redactedURL.Query()
		query.Set("token", "[REDACTED]")
		redactedURL.RawQuery = query.Encode()
		redactedRequest.URL = &redactedURL
		redactedRequest.RequestURI = redactedURL.RequestURI()
		r = redactedRequest
	}
	return f.delegate.NewLogEntry(r)
}

func doctorCommand(args []string) int {
	flags := flag.NewFlagSet("doctor", flag.ContinueOnError)
	configPath := flags.String("config", "", "path to KEY=VALUE configuration file")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	cfg, err := configPkg.Load(*configPath)
	if err != nil {
		fmt.Printf("[fail] configuration: %v\n", err)
		return 1
	}

	failures := 0
	fail := func(format string, values ...any) {
		failures++
		fmt.Printf("[fail] "+format+"\n", values...)
	}
	ok := func(format string, values ...any) {
		fmt.Printf("[ok]   "+format+"\n", values...)
	}
	warn := func(format string, values ...any) {
		fmt.Printf("[warn] "+format+"\n", values...)
	}

	if cfg.Token == "" {
		fail("MYTUBE_TOKEN is missing")
	} else {
		ok("API token is configured")
	}
	if isLoopbackBind(cfg.Bind) {
		ok("HTTP bind is loopback-only: %s", cfg.Bind)
	} else {
		fail("HTTP bind is not loopback-only: %s", cfg.Bind)
	}

	for name, path := range map[string]string{
		"state directory":    cfg.StateDir,
		"download directory": cfg.DownloadDir,
	} {
		if err := os.MkdirAll(path, 0700); err != nil {
			fail("%s is unavailable: %v", name, err)
		} else {
			ok("%s: %s", name, path)
		}
	}

	database, err := dbPkg.Open(cfg.DBPath)
	if err != nil {
		fail("SQLite: %v", err)
	} else {
		ok("SQLite database: %s", cfg.DBPath)
		database.Close()
	}

	ctx := context.Background()
	ytdlp, err := toolingPkg.ResolveYTDLP(ctx, cfg.YTDLPPath)
	if err != nil {
		fail("yt-dlp: %v", err)
	} else {
		ok("yt-dlp %s (%s): %s", ytdlp.Version, ytdlp.Source, ytdlp.Path)
	}

	if cfg.CookieBrowser != "" {
		ok("browser cookie source: %s", cfg.CookieBrowser)
	} else if cfg.CookieFile != "" {
		warn("cookie file source configured; native browser access is preferred")
	} else {
		warn("no authenticated cookie source configured")
	}

	if path, err := exec.LookPath("ffmpeg"); err == nil {
		ok("ffmpeg: %s", path)
	} else {
		warn("ffmpeg not found; format merging and post-processing are limited")
	}
	if path, err := exec.LookPath("ffprobe"); err == nil {
		ok("ffprobe: %s", path)
	} else {
		warn("ffprobe not found")
	}

	if cfg.JSRuntime != "" {
		ok("JavaScript runtime configured: %s", cfg.JSRuntime)
	} else if name, path := findJSRuntime(); path != "" {
		warn("JavaScript runtime found but MYTUBE_JS_RUNTIME is unset: %s (%s)", name, path)
	} else {
		warn("no supported JavaScript runtime found")
	}

	if failures > 0 {
		fmt.Printf("\ndoctor found %d blocking problem(s)\n", failures)
		return 1
	}
	fmt.Println("\ndoctor passed")
	return 0
}

func isLoopbackBind(bind string) bool {
	host, _, err := net.SplitHostPort(bind)
	if err != nil {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func findJSRuntime() (string, string) {
	for _, name := range []string{"deno", "node", "bun", "qjs"} {
		if path, err := exec.LookPath(name); err == nil {
			return name, path
		}
	}
	return "", ""
}

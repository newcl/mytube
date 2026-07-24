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

	apiPkg "github.com/newcl/mytube/backend/internal/api"
	configPkg "github.com/newcl/mytube/backend/internal/config"
	dbPkg "github.com/newcl/mytube/backend/internal/db"
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
	case "version":
		fmt.Printf("mytube %s (commit %s, built %s)\n", buildVersion, buildCommit, buildDate)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", command)
		fmt.Fprintln(os.Stderr, "usage: mytube [serve|doctor|version] [--config PATH]")
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

	ytdlp, err := toolingPkg.ResolveYTDLP(ctx, cfg.YTDLPPath, cfg.StateDir)
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

	recovered, err := dbPkg.RecoverInterruptedJobs(database)
	if err != nil {
		log.Printf("recover interrupted jobs: %v", err)
		return 1
	}
	if recovered > 0 {
		log.Printf("recovered %d interrupted job(s)", recovered)
	}

	handler := &apiPkg.Handler{DB: database}
	router := buildRouter(handler, database, cfg)

	downloadWorker := workerPkg.New(
		database,
		cfg.DownloadDir,
		ytdlp.Path,
		cfg.Concurrency,
		cfg.CookieBrowser,
		cfg.CookieFile,
		cfg.JSRuntime,
	)
	go downloadWorker.Run(ctx)

	server := &http.Server{
		Addr:         cfg.Bind,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("server: listening on %s", cfg.Bind)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErrors <- err
		}
		close(serverErrors)
	}()

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
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("server: shutdown error: %v", err)
		return 1
	}
	return 0
}

func buildRouter(handler *apiPkg.Handler, database *sql.DB, cfg configPkg.Config) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.Logger)
	router.Use(middleware.Recoverer)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	router.Group(func(router chi.Router) {
		router.Use(authPkg.BearerAuth(cfg.Token, false))
		router.Post("/api/jobs", handler.PostJob)
		router.Get("/api/jobs", handler.GetJobs)
		router.Get("/api/jobs/{id}", handler.GetJob)
		router.Delete("/api/jobs/{id}", handler.DeleteJob)
		router.Get("/api/jobs/{id}/log", handler.GetJobLog)
		router.Get("/api/jobs/{id}/subtitles", handler.GetSubtitles)
		router.Get("/api/subtitles/search", handler.SearchAllSubtitles)
	})

	router.Group(func(router chi.Router) {
		router.Use(authPkg.BearerAuth(cfg.Token, true))
		router.Get("/files/{id}", apiPkg.ServeFile(database))
	})

	router.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	return router
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
	ytdlp, err := toolingPkg.ResolveYTDLP(ctx, cfg.YTDLPPath, cfg.StateDir)
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

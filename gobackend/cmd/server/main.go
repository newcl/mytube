package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	apiPkg "github.com/newcl/mytube/backend/internal/api"
	dbPkg "github.com/newcl/mytube/backend/internal/db"
	authPkg "github.com/newcl/mytube/backend/internal/middleware"
	workerPkg "github.com/newcl/mytube/backend/internal/worker"
)

func main() {
	cfg := loadConfig()

	db, err := dbPkg.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	h := &apiPkg.Handler{DB: db}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.CORSOrigin},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// API routes — require Bearer header
	r.Group(func(r chi.Router) {
		r.Use(authPkg.BearerAuth(cfg.Token, false))
		r.Post("/api/jobs", h.PostJob)
		r.Get("/api/jobs", h.GetJobs)
		r.Get("/api/jobs/{id}", h.GetJob)
		r.Get("/api/jobs/{id}/log", h.GetJobLog)
	})

	// File serving — accept Bearer header OR ?token= query param
	r.Group(func(r chi.Router) {
		r.Use(authPkg.BearerAuth(cfg.Token, true))
		r.Get("/files/{id}", apiPkg.ServeFile(db))
	})

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Start download worker
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	w := workerPkg.New(db, cfg.DownloadDir, cfg.Concurrency)
	go w.Run(ctx)

	srv := &http.Server{
		Addr:         cfg.Bind,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // streaming / large files — no timeout
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("server: listening on %s", cfg.Bind)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("server: shutting down")
	cancel()

	shutCtx, shutCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutCancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		log.Printf("server: shutdown error: %v", err)
	}
}

type config struct {
	Bind        string
	Token       string
	DBPath      string
	DownloadDir string
	Concurrency int
	CORSOrigin  string
	PublicBase  string
}

func loadConfig() config {
	token := os.Getenv("MYTUBE_TOKEN")
	if token == "" {
		log.Fatal("MYTUBE_TOKEN is required")
	}

	concurrency := 3
	if v := os.Getenv("MYTUBE_CONCURRENCY"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			concurrency = n
		}
	}

	return config{
		Bind:        envOr("MYTUBE_BIND", ":8080"),
		Token:       token,
		DBPath:      envOr("MYTUBE_DB_PATH", "./data/mytube.db"),
		DownloadDir: envOr("MYTUBE_DOWNLOAD_DIR", "./data/downloads"),
		Concurrency: concurrency,
		CORSOrigin:  envOr("MYTUBE_CORS_ORIGIN", "https://mytube.elladali.com"),
		PublicBase:  os.Getenv("MYTUBE_PUBLIC_BASE_URL"),
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

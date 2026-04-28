import { useState, useEffect, useCallback, useRef } from 'react';
import { listJobs, createJob, deleteJob, type Job } from '../api';
import { fileUrl, getApiBase, getToken, saveSettings } from '../config';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';

const POLL_INTERVAL = 1500; // ms

function statusColor(status: Job['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed': return 'default';
    case 'downloading': return 'secondary';
    case 'failed': return 'destructive';
    default: return 'outline';
  }
}

function JobRow({ job, onPlay, onDeleted }: { job: Job; onPlay: (job: Job) => void; onDeleted: (id: number) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (job.status === 'completed' && !confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteJob(job.id);
      onDeleted(job.id);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  function handleCopyUrl() {
    navigator.clipboard.writeText(job.url);
  }

  return (
    <Card className="mb-3">
      <CardContent className="pt-4 pb-4">
        <div className="flex gap-3 items-start">
          {job.thumbnail_url && (
            <img
              src={job.thumbnail_url}
              alt=""
              className="w-24 h-14 object-cover rounded flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant={statusColor(job.status)}>{job.status}</Badge>
              <span className="text-sm font-medium truncate">
                {job.title || job.url}
              </span>
            </div>
            {job.uploader && (
              <p className="text-xs text-muted-foreground mb-1">{job.uploader}</p>
            )}
            {job.status === 'downloading' && job.progress && (
              <div className="mt-1">
                <Progress value={job.progress.percent} className="h-1.5 mb-1" />
                <p className="text-xs text-muted-foreground">
                  {job.progress.percent.toFixed(1)}% · {job.progress.speed} · ETA {job.progress.eta}
                </p>
              </div>
            )}
            {job.status === 'queued' && (
              <p className="text-xs text-muted-foreground">Waiting to start…</p>
            )}
            {job.status === 'failed' && job.error && (
              <p className="text-xs text-destructive mt-1 truncate">{job.error}</p>
            )}
            <div className="flex gap-2 mt-2 flex-wrap">
              {job.output_path && (
                <>
                  <Button size="sm" onClick={() => onPlay(job)}>▶ Play</Button>
                  {job.status === 'completed' && (
                    <a
                      href={fileUrl(job.id)}
                      download
                      className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background px-3 py-1 hover:bg-accent hover:text-accent-foreground"
                    >
                      ↓ Download
                    </a>
                  )}
                </>
              )}
              <Button size="sm" variant="outline" onClick={handleCopyUrl} title="Copy source URL">
                📋 Copy URL
              </Button>
              {confirmDelete ? (
                <>
                  <Button size="sm" variant="destructive" disabled={deleting} onClick={handleDelete}>
                    {deleting ? '…' : 'Confirm delete'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" disabled={deleting} onClick={handleDelete}
                  className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  🗑 Delete
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PlayerModal({ job, jobs, onClose }: { job: Job | null; jobs: Job[]; onClose: () => void }) {
  useEffect(() => {
    if (!job) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [job, onClose]);

  if (!job) return null;
  // Use live job state so download progress updates while the modal is open
  const liveJob = jobs.find(j => j.id === job.id) ?? job;
  const isDownloading = liveJob.status === 'downloading';
  const pct = liveJob.progress?.percent ?? 0;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/80" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex flex-col bg-black sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[min(90vw,56rem)] sm:rounded-lg sm:overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-neutral-900 shrink-0">
          <span className="text-white text-sm font-medium truncate flex-1">{job.title || 'Video'}</span>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-xl leading-none shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <video
          controls
          autoPlay
          playsInline
          className="w-full flex-1 bg-black sm:flex-none sm:aspect-video object-contain"
          src={fileUrl(job.id)}
          key={job.id}
        />
        {isDownloading && (
          <div className="px-4 py-2 bg-neutral-900 shrink-0">
            <div className="flex justify-between text-xs text-white/60 mb-1">
              <span>Downloading… {pct.toFixed(1)}%</span>
              <span>{liveJob.progress?.speed ?? ''}{liveJob.progress?.eta ? ` · ETA ${liveJob.progress.eta}` : ''}</span>
            </div>
            <Progress value={pct} className="h-1" />
            <p className="text-xs text-white/40 mt-1">You can only seek within the downloaded portion above.</p>
          </div>
        )}
      </div>
    </>
  );
}

function SettingsModal() {
  const [apiBase, setApiBase] = useState(getApiBase);
  const [token, setToken] = useState(getToken);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    saveSettings(apiBase, token);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">⚙ Settings</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-sm font-medium mb-1">API Base URL</label>
            <Input
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="https://api.mytube.elladali.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Token</label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Bearer token"
            />
          </div>
          <Button onClick={handleSave} className="w-full">
            {saved ? '✓ Saved' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function HomePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [playingJob, setPlayingJob] = useState<Job | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const data = await listJobs(100);
      setJobs(data ?? []);
    } catch {
      // silently ignore poll errors
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    pollRef.current = setInterval(fetchJobs, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchJobs]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await createJob(url.trim());
      setUrl('');
      fetchJobs();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'downloading');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/mytube.svg" alt="" className="w-7 h-7" />
          <h1 className="text-lg font-bold">MyTube</h1>
          {hasActive && (
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse ml-1" title="Active downloads" />
          )}
        </div>
        <SettingsModal />
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Submit form */}
        <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste YouTube URL…"
            className="flex-1"
            disabled={submitting}
          />
          <Button type="submit" disabled={submitting || !url.trim()}>
            {submitting ? '…' : 'Queue'}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive mb-4">{error}</p>}

        {/* Job list */}
        {jobs.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-12">
            No downloads yet. Paste a YouTube URL above.
          </p>
        ) : (
          jobs.map((j) => (
            <JobRow key={j.id} job={j} onPlay={setPlayingJob} onDeleted={(id) => setJobs(prev => prev.filter(j => j.id !== id))} />
          ))
        )}
      </main>

      <PlayerModal job={playingJob} jobs={jobs} onClose={() => setPlayingJob(null)} />
    </div>
  );
}

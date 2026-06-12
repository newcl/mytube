import { useState, useEffect, useCallback, useRef } from 'react';
import { listJobs, createJob, deleteJob, type Job } from '../api';
import {
  fileUrl,
  fileZipDownloadUrl,
  getApiBase,
  getAppVersion,
  getAppVersionShort,
  getToken,
  saveSettings,
} from '../config';
import { extractYouTubeUrl } from '../utils/urlExtractor';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Card, CardContent } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';

const POLL_INTERVAL = 1500; // ms
const BACKGROUND_PLAYBACK_WARNING = 'This browser paused playback in the background. Try Picture-in-Picture or keep this tab/app in the foreground.';
const BACKGROUND_PAUSE_CHECK_DELAY_MS = 1200;

const durationCache = new Map<number, string>();

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function getVideoDuration(jobId: number): Promise<string> {
  const cached = durationCache.get(jobId);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;

    const done = (value: string) => {
      if (settled) return;
      settled = true;
      durationCache.set(jobId, value);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };

    video.preload = 'metadata';
    video.onloadedmetadata = () => done(formatDuration(video.duration));
    video.onerror = () => done('');
    video.src = fileUrl(jobId);
  });
}

function statusColor(status: Job['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed': return 'default';
    case 'downloading': return 'secondary';
    case 'failed': return 'destructive';
    default: return 'outline';
  }
}

// Detect iOS (iPhone/iPad) — these buffer the entire blob in RAM so we use
// a direct URL + Share sheet instead of the fetch-blob approach.
function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isMobilePlatform() {
  return isIOS() || /Android/i.test(navigator.userAgent);
}

type PictureInPictureVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => boolean;
  webkitSetPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => void;
  webkitPresentationMode?: 'inline' | 'fullscreen' | 'picture-in-picture';
};

function detectPlaybackEnvironment() {
  const ua = navigator.userAgent;
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg|EdgiOS|Firefox|FxiOS/i.test(ua);
  if (isIOS() && isSafari) return 'iOS Safari';
  if (/Android/i.test(ua) && /Chrome/i.test(ua)) return 'Android Chrome';
  if (/Android/i.test(ua)) return 'Android browser';
  return 'Desktop browser';
}

function looksLikeYouTubeUrl(text: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(text);
}

// Playlist storage and helpers
const PLAYLIST_STORAGE_KEY = 'mytube_playlist';
const PLAYLIST_TIMER_OPTIONS = [30, 45, 60, 90] as const;
type PlaylistTimer = (typeof PLAYLIST_TIMER_OPTIONS)[number];
type PlaylistItem = {
  id: string;
  jobId?: number;
  url: string;
  title: string;
};

function loadPlaylistItems(): PlaylistItem[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(PLAYLIST_STORAGE_KEY) ?? '[]') as PlaylistItem[];
  } catch {
    return [];
  }
}

function savePlaylistItems(items: PlaylistItem[]) {
  try {
    localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function createPlaylistItem(url: string, title?: string, jobId?: number): PlaylistItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    jobId,
    url,
    title: title?.trim() || url,
  };
}

function DownloadButton({ job }: { job: Job }) {
  const [progress, setProgress] = useState<number | null>(null);

  async function handleDownload() {
    // iOS: open zip attachment URL in a new tab so browser treats it as a file download.
    // This avoids inline media playback and also avoids large in-memory blob buffering.
    if (isIOS()) {
      window.open(fileZipDownloadUrl(job.id), '_blank');
      return;
    }

    setProgress(0);
    try {
      const res = await fetch(`${getApiBase()}/files/${job.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const contentLength = res.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      const reader = res.body!.getReader();
      const chunks: ArrayBuffer[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
        received += value.length;
        if (total > 0) setProgress(Math.round(received / total * 100));
      }

      const mimeType = res.headers.get('content-type') || 'video/mp4';
      const blob = new Blob(chunks, { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = mimeType.includes('webm') ? '.webm'
        : mimeType.includes('ogg') ? '.ogg' : '.mp4';
      a.download = (job.title ? job.title.replace(/[/\\:*?"<>|]/g, '_') : `video_${job.id}`) + ext;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { window.URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (err) {
      alert(`Download failed: ${err}`);
    } finally {
      setProgress(null);
    }
  }

  const label = progress === null ? '↓ Download'
    : progress === 0 ? '↓ 0%'
    : `↓ ${progress}%`;

  return (
    <Button size="sm" variant="outline" onClick={handleDownload} disabled={progress !== null}>
      {label}
    </Button>
  );
}

function JobRow({
  job, onPlay, onDeleted, onAddToPlaylist,
  selectMode = false, selected = false, onToggleSelect,
}: {
  job: Job;
  onPlay: (job: Job) => void;
  onDeleted: (id: number) => void;
  onAddToPlaylist?: (job: Job) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [videoDuration, setVideoDuration] = useState('');

  useEffect(() => {
    let cancelled = false;

    const apiDuration = formatDuration(job.duration_seconds ?? 0);
    if (apiDuration) {
      setVideoDuration(apiDuration);
      return;
    }

    if (job.status !== 'completed' || !job.output_path) {
      setVideoDuration('');
      return;
    }

    const cached = durationCache.get(job.id);
    if (cached !== undefined) {
      setVideoDuration(cached);
      return;
    }

    getVideoDuration(job.id).then((value) => {
      if (!cancelled) setVideoDuration(value);
    });

    return () => {
      cancelled = true;
    };
  }, [job.id, job.status, job.output_path, job.duration_seconds]);

  async function handleDelete() {
    setDeleting(true);
    setConfirmOpen(false);
    try {
      await deleteJob(job.id);
      onDeleted(job.id);
    } catch {
      setDeleting(false);
    }
  }

  function handleCopyUrl() {
    navigator.clipboard.writeText(job.url);
  }

  return (
    <Card
      className={`mb-3 transition-colors ${
        selectMode ? 'cursor-pointer select-none' : ''
      } ${selected ? 'ring-2 ring-primary bg-primary/5' : ''}`}
      onClick={selectMode ? onToggleSelect : undefined}
    >
      <CardContent className="overflow-hidden p-0">
        {job.thumbnail_url && (
          <img
            src={job.thumbnail_url}
            alt=""
            className="w-full h-40 sm:hidden object-cover"
          />
        )}
        <div className="flex gap-3 items-start p-3">
          {selectMode && (
            <input
              type="checkbox"
              checked={selected}
              readOnly
              className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
            />
          )}
          {job.thumbnail_url && (
            <img
              src={job.thumbnail_url}
              alt=""
              className="w-24 h-14 object-cover rounded flex-shrink-0 hidden sm:block"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="mb-1">
              <Badge variant={statusColor(job.status)} className="mb-1">{job.status}</Badge>
              <div className="text-sm font-medium leading-snug break-words min-w-0 line-clamp-2">
                {job.title || job.url}
              </div>
            </div>
            {(job.uploader || videoDuration) && (
              <p className="text-xs text-muted-foreground mb-1">
                {job.uploader}
                {job.uploader && videoDuration ? ' · ' : ''}
                {videoDuration ? `Duration ${videoDuration}` : ''}
              </p>
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
            {!selectMode && <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 mt-2">
              {job.output_path && (
                <Button size="sm" onClick={() => onPlay(job)}>▶ Play</Button>
              )}
              {job.output_path && job.status === 'completed' && (
                <DownloadButton job={job} />
              )}
              {job.output_path && job.status === 'completed' && onAddToPlaylist && (
                <Button size="sm" variant="outline" onClick={() => onAddToPlaylist(job)}>
                  + Playlist
                </Button>
              )}
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-input bg-background px-2 py-1 h-8 hover:bg-accent hover:text-accent-foreground"
                title="Open original URL"
              >
                🔗 Source
              </a>
              <Button size="sm" variant="outline" onClick={handleCopyUrl} title="Copy source URL">
                📋 Copy URL
              </Button>
              {job.status === 'completed' ? (
                <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" disabled={deleting}
                      className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    >
                      {deleting ? '…' : '🗑 Delete'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-3" align="end">
                    <p className="text-sm font-medium mb-3">Delete this video?</p>
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                      <Button size="sm" variant="destructive" onClick={handleDelete}>Delete</Button>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                <Button size="sm" variant="outline" disabled={deleting} onClick={handleDelete}
                  className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  {deleting ? '…' : '🗑 Delete'}
                </Button>
              )}
            </div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PlayerModal({ job, jobs, onClose, onEnded }: { job: Job | null; jobs: Job[]; onClose: () => void; onEnded?: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pipActiveRef = useRef(false);
  const [pipAvailable, setPipAvailable] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [bgPlaybackWarning, setBgPlaybackWarning] = useState('');
  const liveJob = job ? (jobs.find(j => j.id === job.id) ?? job) : null;
  const isDownloading = liveJob?.status === 'downloading';
  const pct = liveJob?.progress?.percent ?? 0;
  const env = detectPlaybackEnvironment();

  useEffect(() => {
    if (!job) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [job, onClose]);

  useEffect(() => {
    if (!job) return;
    setBgPlaybackWarning('');
    setPipActive(false);
  }, [job]);

  useEffect(() => {
    pipActiveRef.current = pipActive;
  }, [pipActive]);

  useEffect(() => {
    if (!job) return;
    const video = videoRef.current as PictureInPictureVideo | null;
    if (!video) return;
    const standardPiP = !!document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function';
    const webkitPiP = !!video.webkitSupportsPresentationMode?.('picture-in-picture');
    setPipAvailable(standardPiP || webkitPiP);

    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    const onWebkitModeChanged = () => setPipActive(video.webkitPresentationMode === 'picture-in-picture');
    video.addEventListener('enterpictureinpicture', onEnter);
    video.addEventListener('leavepictureinpicture', onLeave);
    video.addEventListener('webkitpresentationmodechanged', onWebkitModeChanged as EventListener);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter);
      video.removeEventListener('leavepictureinpicture', onLeave);
      video.removeEventListener('webkitpresentationmodechanged', onWebkitModeChanged as EventListener);
    };
  }, [job]);

  useEffect(() => {
    if (!job || !liveJob) return;
    const video = videoRef.current;
    if (!video || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;

    const artwork = liveJob.thumbnail_url ? [{ src: liveJob.thumbnail_url }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: liveJob.title || 'MyTube video',
      artist: liveJob.uploader || 'MyTube',
      artwork,
    });
    navigator.mediaSession.setActionHandler('play', () => { video.play().catch(() => undefined); });
    navigator.mediaSession.setActionHandler('pause', () => video.pause());
    navigator.mediaSession.setActionHandler('stop', () => video.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => {
      video.currentTime = Math.max(0, video.currentTime - 10);
    });
    navigator.mediaSession.setActionHandler('seekforward', () => {
      const nextTime = video.currentTime + 10;
      const hasFiniteDuration = Number.isFinite(video.duration) && video.duration > 0;
      video.currentTime = hasFiniteDuration ? Math.min(video.duration, nextTime) : nextTime;
    });
    navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';

    const onPlay = () => { navigator.mediaSession.playbackState = 'playing'; };
    const onPause = () => { navigator.mediaSession.playbackState = 'paused'; };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('stop', null);
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
    };
  }, [job, liveJob]);

  useEffect(() => {
    if (!job) return;
    const video = videoRef.current;
    if (!video) return;
    let pauseCheckTimer: ReturnType<typeof setTimeout> | null = null;

    const requestAutoPiP = async () => {
      if (video.paused || video.ended) return;

      try {
        if (
          document.pictureInPictureEnabled &&
          document.pictureInPictureElement !== video &&
          typeof video.requestPictureInPicture === 'function'
        ) {
          await video.requestPictureInPicture();
          return;
        }

        const pipVideo = video as PictureInPictureVideo;
        if (
          pipVideo.webkitSupportsPresentationMode?.('picture-in-picture') &&
          pipVideo.webkitPresentationMode !== 'picture-in-picture'
        ) {
          pipVideo.webkitSetPresentationMode?.('picture-in-picture');
        }
      } catch {
        // Some mobile browsers require fresh user activation before PiP requests.
      }
    };

    const onVisibilityChange = () => {
      const isInPiP = pipActiveRef.current
        || document.pictureInPictureElement === video
        || (video as PictureInPictureVideo).webkitPresentationMode === 'picture-in-picture';
      if (document.visibilityState === 'hidden') {
        void requestAutoPiP();
      }
      if (document.visibilityState !== 'hidden' || video.ended || isInPiP) return;
      if (pauseCheckTimer) clearTimeout(pauseCheckTimer);
      pauseCheckTimer = setTimeout(() => {
        const stillInPiP = pipActiveRef.current
          || document.pictureInPictureElement === video
          || (video as PictureInPictureVideo).webkitPresentationMode === 'picture-in-picture';
        if (document.visibilityState === 'hidden' && video.paused && !video.ended && !stillInPiP) {
          setBgPlaybackWarning(BACKGROUND_PLAYBACK_WARNING);
        }
      }, BACKGROUND_PAUSE_CHECK_DELAY_MS);
    };
    const onPause = () => {
      const isInPiP = pipActiveRef.current
        || document.pictureInPictureElement === video
        || (video as PictureInPictureVideo).webkitPresentationMode === 'picture-in-picture';
      if (document.visibilityState === 'hidden' && !video.ended && !isInPiP) {
        setBgPlaybackWarning(BACKGROUND_PLAYBACK_WARNING);
      }
    };
    const onPlay = () => setBgPlaybackWarning('');

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', requestAutoPiP);
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    return () => {
      if (pauseCheckTimer) clearTimeout(pauseCheckTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', requestAutoPiP);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('play', onPlay);
    };
  }, [job, pipActive]);

  if (!job) return null;

  async function handlePictureInPicture() {
    const video = videoRef.current as PictureInPictureVideo | null;
    if (!video) return;
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
        return;
      }
      if (typeof video.requestPictureInPicture === 'function') {
        await video.requestPictureInPicture();
        return;
      }
      if (video.webkitSupportsPresentationMode?.('picture-in-picture')) {
        video.webkitSetPresentationMode?.('picture-in-picture');
      }
    } catch {
      setBgPlaybackWarning('Could not start Picture-in-Picture on this browser. Keep this tab/app in the foreground to continue playback.');
    }
  }

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
        <div className="px-4 py-2 bg-neutral-900 border-y border-white/10 space-y-2">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <p className="text-xs text-white/70">
              Environment: {env}. Background playback support depends on browser/OS policy.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePictureInPicture}
              disabled={!pipAvailable}
              title={pipAvailable ? 'Open Picture-in-Picture' : 'Picture-in-Picture is not available in this browser'}
            >
              {pipActive ? 'PiP Active' : 'Picture-in-Picture'}
            </Button>
          </div>
          {bgPlaybackWarning && (
            <p className="text-xs text-amber-300">
              {bgPlaybackWarning}
            </p>
          )}
        </div>
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          className="w-full flex-1 bg-black sm:flex-none sm:aspect-video object-contain"
          src={fileUrl(job.id)}
          key={job.id}
          onEnded={onEnded}
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
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [playlistTimer, setPlaylistTimer] = useState<PlaylistTimer>(30);
  const [playlistIndex, setPlaylistIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [playingJob, setPlayingJob] = useState<Job | null>(null);
  const playlistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bulk select
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Delete before date
  const [beforeDate, setBeforeDate] = useState('');
  const appVersion = getAppVersion();
  const appVersionShort = getAppVersionShort();

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

  useEffect(() => {
    setPlaylist(loadPlaylistItems());
  }, []);

  useEffect(() => {
    savePlaylistItems(playlist);
  }, [playlist]);

  useEffect(() => {
    return () => {
      clearPlaylistTimer();
    };
  }, []);

  useEffect(() => {
    if (!isMobilePlatform()) return;
    if (!navigator.clipboard?.readText) return;

    // iOS shows a system paste prompt for eager reads on load/focus, which can
    // block the initial view. Keep eager autofill on Android only.
    if (isIOS()) return;

    const autofillFromClipboard = async () => {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text || !looksLikeYouTubeUrl(text)) return;
        if (!extractYouTubeUrl(text)) return;
        setUrl(text);
      } catch {
        // iOS/Android may deny clipboard reads without a recent user gesture.
      }
    };

    autofillFromClipboard();
    window.addEventListener('focus', autofillFromClipboard);
    return () => window.removeEventListener('focus', autofillFromClipboard);
  }, []);

  async function handlePasteIntoInput() {
    if (submitting) return;
    if (!navigator.clipboard?.readText) return;
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text || !looksLikeYouTubeUrl(text)) return;
      if (!extractYouTubeUrl(text)) return;
      setUrl(text);
      await queueUrl(text);
    } catch {
      // No-op when clipboard access is denied.
    }
  }

  async function queueUrl(nextUrl: string) {
    const trimmed = nextUrl.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError('');
    try {
      await createJob(trimmed);
      setUrl('');
      fetchJobs();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function findPlaylistJob(item: PlaylistItem) {
    return jobs.find((j) => item.jobId === j.id || j.url === item.url);
  }

  function clearPlaylistTimer() {
    if (playlistTimerRef.current) {
      clearTimeout(playlistTimerRef.current);
      playlistTimerRef.current = null;
    }
  }

  function stopPlaylistPlayback() {
    clearPlaylistTimer();
    setPlaylistIndex(null);
    setPlayingJob(null);
  }

  async function startPlaylistPlayback(startIndex = 0) {
    const nextIndex = playlist.slice(startIndex).findIndex((item) => {
      const job = findPlaylistJob(item);
      return job?.status === 'completed' && !!job.output_path;
    });
    if (nextIndex === -1) {
      alert('No playable items found in the playlist. Add downloaded videos or wait for downloads to complete.');
      return;
    }

    const itemIndex = startIndex + nextIndex;
    const item = playlist[itemIndex];
    const job = findPlaylistJob(item);
    if (!job || job.status !== 'completed' || !job.output_path) return;

    clearPlaylistTimer();
    setPlaylistIndex(itemIndex);
    setPlayingJob(job);

    playlistTimerRef.current = setTimeout(() => {
      stopPlaylistPlayback();
    }, playlistTimer * 60 * 1000);
  }

  function advancePlaylist() {
    if (playlistIndex === null) return;
    const nextIndex = playlist.slice(playlistIndex + 1).findIndex((item) => {
      const job = findPlaylistJob(item);
      return job?.status === 'completed' && !!job.output_path;
    });
    if (nextIndex === -1) {
      stopPlaylistPlayback();
      return;
    }
    const itemIndex = playlistIndex + 1 + nextIndex;
    const item = playlist[itemIndex];
    const job = findPlaylistJob(item);
    if (!job || job.status !== 'completed' || !job.output_path) {
      stopPlaylistPlayback();
      return;
    }
    setPlaylistIndex(itemIndex);
    setPlayingJob(job);
  }

  function addPlaylistItem(urlToAdd: string, title?: string, jobId?: number) {
    const trimmed = urlToAdd.trim();
    if (!trimmed || !looksLikeYouTubeUrl(trimmed)) return;
    setPlaylist((prev) => [
      createPlaylistItem(trimmed, title || trimmed, jobId),
      ...prev,
    ]);
  }

  function handleEditPlaylistItem(index: number) {
    const item = playlist[index];
    const updatedTitle = window.prompt('Edit playlist item title', item.title);
    if (updatedTitle === null) return;
    const updatedUrl = window.prompt('Edit playlist item URL', item.url);
    if (updatedUrl === null) return;
    const trimmedUrl = updatedUrl.trim();
    if (!trimmedUrl || !looksLikeYouTubeUrl(trimmedUrl)) return;
    setPlaylist((prev) => prev.map((current, i) => i === index ? {
      ...current,
      url: trimmedUrl,
      title: updatedTitle.trim() || trimmedUrl,
      jobId: jobs.find((j) => j.url === trimmedUrl)?.id,
    } : current));
  }

  function handleMovePlaylistItem(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= playlist.length) return;
    setPlaylist((prev) => {
      const next = [...prev];
      const temp = next[nextIndex];
      next[nextIndex] = next[index];
      next[index] = temp;
      return next;
    });
  }

  function handleRemovePlaylistItem(index: number) {
    setPlaylist((prev) => prev.filter((_, i) => i !== index));
    if (playlistIndex === null) return;
    if (index === playlistIndex) {
      stopPlaylistPlayback();
    } else if (index < playlistIndex) {
      setPlaylistIndex((prev) => (prev === null ? null : prev - 1));
    }
  }

  function handlePlayPlaylistItem(index: number) {
    startPlaylistPlayback(index);
  }

  function handleClearPlaylist() {
    if (!confirm('Clear the playlist?')) return;
    setPlaylist([]);
    stopPlaylistPlayback();
  }

  function handleAddJobToPlaylist(job: Job) {
    if (!job.url) return;
    const already = playlist.some((item) => item.jobId === job.id || item.url === job.url);
    if (already) return;
    addPlaylistItem(job.url, job.title || job.url, job.id);
  }

  function hasPlayablePlaylistItems() {
    return playlist.some((item) => {
      const job = findPlaylistJob(item);
      return job?.status === 'completed' && !!job.output_path;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function handleToggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected video${selected.size !== 1 ? 's' : ''}?`)) return;
    setBulkDeleting(true);
    const ids = Array.from(selected);
    await Promise.all(ids.map(id => deleteJob(id).catch(() => {})));
    setJobs(prev => prev.filter(j => !ids.includes(j.id)));
    exitSelectMode();
    setBulkDeleting(false);
  }

  async function handleDeleteBefore() {
    if (!beforeDate) return;
    // Add 1 day to make the date inclusive (delete on or before the chosen day)
    const cutoff = new Date(beforeDate);
    cutoff.setDate(cutoff.getDate() + 1);
    const toDelete = jobs.filter(j => new Date(j.created_at) < cutoff);
    if (toDelete.length === 0) {
      alert('No videos found on or before that date.');
      return;
    }
    if (!confirm(`Delete ${toDelete.length} video${toDelete.length !== 1 ? 's' : ''} created on or before ${beforeDate}?`)) return;
    await Promise.all(toDelete.map(j => deleteJob(j.id).catch(() => {})));
    setJobs(prev => prev.filter(j => !toDelete.some(d => d.id === j.id)));
    setBeforeDate('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await queueUrl(url);
  }

  const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'downloading');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/mytube.svg" alt="" className="w-7 h-7" />
          <h1 className="text-lg font-bold">MyTube</h1>
          <span
            className="text-[11px] uppercase tracking-wide rounded border border-border px-2 py-0.5 text-muted-foreground"
            title={`Build ${appVersion}`}
          >
            v{appVersionShort}
          </span>
          {hasActive && (
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse ml-1" title="Active downloads" />
          )}
        </div>
        <SettingsModal />
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Submit form */}
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 mb-6">
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

        <Tabs defaultValue="videos">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="videos" className="flex-1">
              Videos{jobs.length > 0 ? ` (${jobs.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="playlist" className="flex-1">
              Playlist{playlist.length > 0 ? ` (${playlist.length})` : ''}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="videos">
            {/* Bulk-action toolbar */}
            {jobs.length > 0 && (
              <div className="mb-4 pb-3 border-b">
                {!selectMode ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button size="sm" variant="outline" className="w-fit" onClick={() => setSelectMode(true)}>☑ Select</Button>
                    <div className="flex items-center gap-2 sm:ml-auto">
                      <input
                        type="date"
                        value={beforeDate}
                        onChange={e => setBeforeDate(e.target.value)}
                        className="text-sm border rounded px-2 py-1 bg-background h-8 flex-1 sm:flex-none"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive hover:text-destructive-foreground whitespace-nowrap"
                        disabled={!beforeDate}
                        onClick={handleDeleteBefore}
                      >
                        🗑 Delete before date
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline"
                      onClick={() => setSelected(new Set(jobs.map(j => j.id)))}>
                      Select All
                    </Button>
                    <Button size="sm" variant="outline"
                      onClick={() => setSelected(new Set())}
                      disabled={selected.size === 0}>
                      Deselect All
                    </Button>
                    <Button size="sm" variant="destructive"
                      onClick={handleBulkDelete}
                      disabled={selected.size === 0 || bulkDeleting}>
                      {bulkDeleting ? '…' : `Delete (${selected.size})`}
                    </Button>
                    <Button size="sm" variant="outline" onClick={exitSelectMode}>Cancel</Button>
                  </div>
                )}
              </div>
            )}

            {/* Job list */}
            {jobs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <p className="text-muted-foreground text-sm">No downloads yet. Paste a YouTube URL above.</p>
                <Button variant="outline" size="sm" onClick={fetchJobs}>↻ Refresh</Button>
              </div>
            ) : (
              jobs.map((j) => (
                <JobRow
                  key={j.id}
                  job={j}
                  onPlay={(job) => {
                    stopPlaylistPlayback();
                    setPlayingJob(job);
                  }}
                  onDeleted={(id) => setJobs(prev => prev.filter(j => j.id !== id))}
                  onAddToPlaylist={handleAddJobToPlaylist}
                  selectMode={selectMode}
                  selected={selected.has(j.id)}
                  onToggleSelect={() => handleToggleSelect(j.id)}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="playlist">
            <section className="rounded-lg border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Playlist</h2>
                  <p className="text-xs text-muted-foreground">Keep a global playlist of videos, reorder entries, and stop playback after a timer.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => startPlaylistPlayback(0)}
                    disabled={!hasPlayablePlaylistItems()}
                  >
                    ▶ Play playlist
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleClearPlaylist}
                    disabled={playlist.length === 0}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground mt-4">
                <span>Stop after</span>
                {PLAYLIST_TIMER_OPTIONS.map((minutes) => (
                  <Button
                    key={minutes}
                    size="sm"
                    variant={playlistTimer === minutes ? 'default' : 'outline'}
                    onClick={() => setPlaylistTimer(minutes)}
                  >
                    {minutes}m
                  </Button>
                ))}
              </div>
              {playlist.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-4">No playlist entries yet. Add videos by clicking + Playlist on completed downloads.</p>
              ) : (
                <div className="space-y-2">
                  {playlist.map((item, index) => {
                    const job = findPlaylistJob(item);
                    const playable = !!job && job.status === 'completed' && !!job.output_path;
                    return (
                      <div key={item.id} className="rounded-lg border p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{item.title}</p>
                          <p className="text-xs text-muted-foreground break-words">{item.url}</p>
                          <p className="text-xs text-muted-foreground">
                            {playable ? 'Playable' : job ? `${job.status} - waiting for download` : 'No downloaded version found'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          <Button size="sm" onClick={() => handlePlayPlaylistItem(index)} disabled={!playable}>▶</Button>
                          <Button size="sm" variant="outline" onClick={() => handleEditPlaylistItem(index)}>✏️</Button>
                          <Button size="sm" variant="outline" onClick={() => handleMovePlaylistItem(index, -1)} disabled={index === 0}>↑</Button>
                          <Button size="sm" variant="outline" onClick={() => handleMovePlaylistItem(index, 1)} disabled={index === playlist.length - 1}>↓</Button>
                          <Button size="sm" variant="destructive" onClick={() => handleRemovePlaylistItem(index)}>✖</Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </main>

      <PlayerModal job={playingJob} jobs={jobs} onClose={() => { stopPlaylistPlayback(); setPlayingJob(null); }} onEnded={advancePlaylist} />

      <Button
        onClick={handlePasteIntoInput}
        disabled={submitting}
        className="fixed left-4 bottom-4 z-40 gap-2"
        title="Paste YouTube URL from clipboard and queue"
      >
        📋 Paste+Queue
      </Button>
    </div>
  );
}

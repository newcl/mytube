import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, ClipboardPaste, Captions, CaptionsOff, MoreHorizontal, Play, Trash2, ListPlus, ExternalLink, Copy, Info, ListMusic, X, CheckSquare, Settings, RefreshCw } from 'lucide-react';
import { listJobs, createJob, deleteJob, type Job, searchSubtitles, type SubtitleSearchResult } from '../api';
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

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
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
    return true;
  } catch {
    return false;
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
  job, onPlay, onDeleted, onAddToPlaylist, isInPlaylist,
  selectMode = false, selected = false, onToggleSelect,
}: {
  job: Job;
  onPlay: (job: Job) => void;
  onDeleted: (id: number) => void;
  onAddToPlaylist?: (job: Job) => boolean;
  isInPlaylist?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [videoDuration, setVideoDuration] = useState('');
  const [playlistFeedback, setPlaylistFeedback] = useState<'added' | 'already' | null>(null);
  const playlistFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (playlistFeedbackTimerRef.current) {
        clearTimeout(playlistFeedbackTimerRef.current);
      }
    };
  }, []);

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

  async function handleRetry() {
    setRetrying(true);
    try {
      await createJob(job.url);
    } catch {
      // silently fail
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Card
      className={`mb-3 group relative overflow-hidden rounded-lg transition-colors ${
        selectMode ? 'cursor-pointer select-none' : ''
      } ${selected ? 'ring-2 ring-primary' : ''}`}
      onClick={selectMode ? onToggleSelect : undefined}
    >
      <CardContent className="p-0">
        {job.thumbnail_url ? (
          <div className="relative aspect-video bg-muted">
            <img
              src={job.thumbnail_url}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {/* gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

            {/* select checkbox */}
            {selectMode && (
              <div className="absolute top-2 right-2 z-10">
                <input
                  type="checkbox"
                  checked={selected}
                  readOnly
                  className="w-4 h-4 cursor-pointer accent-primary"
                />
              </div>
            )}

            {/* badges top-left */}
            <div className="absolute top-2 left-2 z-10 flex gap-1">
              <Badge variant={statusColor(job.status)} className="text-[10px] px-1.5 py-0">
                {job.status}
              </Badge>
              {job.subtitles_checked ? (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                  <Captions className="w-3 h-3" />
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 bg-black/40 text-white/80 border-white/20">
                  <CaptionsOff className="w-3 h-3" />
                </Badge>
              )}
            </div>

            {/* progress overlay */}
            {job.status === 'downloading' && job.progress && (
              <div className="absolute bottom-0 left-0 right-0 z-10 px-3 pb-3">
                <Progress value={job.progress.percent} className="h-1 mb-1 [&>div]:bg-white" />
                <p className="text-[11px] text-white/80">
                  {job.progress.percent.toFixed(1)}% · {job.progress.speed} · ETA {job.progress.eta}
                </p>
              </div>
            )}

            {/* queued state */}
            {job.status === 'queued' && (
              <p className="absolute bottom-0 left-0 right-0 z-10 px-3 pb-3 text-xs text-white/70">
                Waiting to start…
              </p>
            )}

            {/* failed state */}
            {job.status === 'failed' && job.error && (
              <p className="absolute bottom-0 left-0 right-0 z-10 px-3 pb-3 text-xs text-red-300 truncate">
                {job.error}
              </p>
            )}

            {/* duration badge */}
            {videoDuration && job.status !== 'downloading' && job.status !== 'failed' && (
              <span className="absolute bottom-2 left-2 z-10 text-[11px] font-mono text-white/80 bg-black/50 px-1.5 py-0.5 rounded">
                {videoDuration}
              </span>
            )}

            {/* action buttons - visible on mobile, hover on desktop */}
            {!selectMode && (
              <div className="absolute bottom-2 right-2 z-20 flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      className="h-7 w-7 p-0 bg-white/20 text-white hover:bg-white/40 backdrop-blur"
                      onClick={(e) => e.stopPropagation()}
                      title="Show title"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3" align="end">
                    <p className="text-sm font-medium mb-1">{job.title || job.url}</p>
                    {job.uploader && <p className="text-xs text-muted-foreground mb-1">{job.uploader}</p>}
                    {videoDuration && <p className="text-xs text-muted-foreground mb-1">Duration: {videoDuration}</p>}
                    <p className="text-xs text-muted-foreground break-all">{job.url}</p>
                  </PopoverContent>
                </Popover>
                {job.output_path && (
                  <Button
                    size="sm"
                    className="h-7 w-7 p-0 bg-white/90 hover:bg-white text-black backdrop-blur"
                    onClick={(e) => { e.stopPropagation(); onPlay(job); }}
                    title="Play"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </Button>
                )}
                {job.output_path && job.status === 'completed' && onAddToPlaylist && (
                  <Button
                    size="sm"
                    className={`h-7 px-2 py-0 text-[11px] backdrop-blur ${
                      isInPlaylist || playlistFeedback === 'added'
                        ? 'bg-white/90 text-black'
                        : 'bg-white/20 text-white hover:bg-white/40'
                    } ${!isInPlaylist && playlistFeedback === 'already' ? 'opacity-60' : ''}`}
                    disabled={isInPlaylist}
                    onClick={(e) => {
                      if (isInPlaylist) return;
                      e.stopPropagation();
                      (e.currentTarget as HTMLButtonElement).blur();
                      const added = onAddToPlaylist(job);
                      if (added) {
                        setPlaylistFeedback('added');
                        if (playlistFeedbackTimerRef.current) clearTimeout(playlistFeedbackTimerRef.current);
                        playlistFeedbackTimerRef.current = setTimeout(() => setPlaylistFeedback(null), 1500);
                      } else {
                        setPlaylistFeedback('already');
                        if (playlistFeedbackTimerRef.current) clearTimeout(playlistFeedbackTimerRef.current);
                        playlistFeedbackTimerRef.current = setTimeout(() => setPlaylistFeedback(null), 1200);
                      }
                    }}
                    title="Add to playlist"
                  >
                    <ListPlus className="w-3 h-3 mr-1" />
                    {isInPlaylist ? 'Added' : playlistFeedback === 'added' ? 'Added' : playlistFeedback === 'already' ? 'In list' : 'Add'}
                  </Button>
                )}
                {job.status === 'failed' && (
                  <Button
                    size="sm"
                    className="h-7 w-7 p-0 bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/60 hover:text-white backdrop-blur"
                    disabled={retrying}
                    onClick={(e) => { e.stopPropagation(); handleRetry(); }}
                    title="Retry download"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-7 w-7 p-0 bg-white/20 text-white hover:bg-red-500/80 hover:text-white backdrop-blur"
                  disabled={deleting}
                  onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      className="h-7 w-7 p-0 bg-white/20 text-white hover:bg-white/40 backdrop-blur"
                      onClick={(e) => e.stopPropagation()}
                      title="More actions"
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2" align="end">
                    <div className="flex flex-col gap-1">
                      {job.output_path && job.status === 'completed' && (
                        <DownloadButton job={job} />
                      )}
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-md text-xs font-medium border border-input bg-background px-2 py-1.5 h-8 hover:bg-accent hover:text-accent-foreground whitespace-nowrap"
                        title="Open original URL"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Source
                      </a>
                      <Button size="sm" variant="outline" onClick={handleCopyUrl} title="Copy source URL" className="justify-start gap-2">
                        <Copy className="w-3.5 h-3.5" />
                        Copy URL
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>
        ) : (
          /* fallback: no thumbnail */
          <div className="p-3">
            <div className="flex gap-3 items-start">
              {selectMode && (
                <input
                  type="checkbox"
                  checked={selected}
                  readOnly
                  className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="mb-1">
                  <Badge variant={statusColor(job.status)} className="mb-1">{job.status}</Badge>
                  {job.subtitles_checked ? (
                    <Badge variant="secondary" className="mb-1 ml-1 gap-1">
                      <Captions className="w-3 h-3" />
                      Subs
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="mb-1 ml-1 gap-1 text-muted-foreground border-dashed">
                      <CaptionsOff className="w-3 h-3" />
                      Subs
                    </Badge>
                  )}
                  <div className="text-sm font-medium leading-snug line-clamp-2">
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
                {!selectMode && <div className="flex flex-wrap gap-1.5 mt-2">
                  {job.output_path && (
                    <Button size="sm" onClick={() => onPlay(job)}>
                      <Play className="w-3.5 h-3.5 mr-1" /> Play
                    </Button>
                  )}
                  {job.output_path && job.status === 'completed' && onAddToPlaylist && (
                    <Button
                      size="sm"
                      variant={isInPlaylist || playlistFeedback === 'added' ? 'default' : 'outline'}
                      className={!isInPlaylist && playlistFeedback === 'already' ? 'opacity-60' : ''}
                      disabled={isInPlaylist}
                      onClick={(e) => {
                        if (isInPlaylist) return;
                        (e.currentTarget as HTMLButtonElement).blur();
                        const added = onAddToPlaylist(job);
                        if (added) {
                          setPlaylistFeedback('added');
                          if (playlistFeedbackTimerRef.current) clearTimeout(playlistFeedbackTimerRef.current);
                          playlistFeedbackTimerRef.current = setTimeout(() => setPlaylistFeedback(null), 1500);
                        } else {
                          setPlaylistFeedback('already');
                          if (playlistFeedbackTimerRef.current) clearTimeout(playlistFeedbackTimerRef.current);
                          playlistFeedbackTimerRef.current = setTimeout(() => setPlaylistFeedback(null), 1200);
                        }
                      }}
                    >
                      <ListPlus className="w-3.5 h-3.5 mr-1" />
                      {isInPlaylist ? '✓ Added' : playlistFeedback === 'added' ? '✓ Added' : playlistFeedback === 'already' ? 'In playlist' : '+ Playlist'}
                    </Button>
                  )}
                  {job.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-emerald-600 hover:bg-emerald-500 hover:text-white"
                      disabled={retrying}
                      onClick={handleRetry}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 mr-1 ${retrying ? 'animate-spin' : ''}`} />
                      {retrying ? '…' : 'Retry'}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={deleting} onClick={handleDelete}
                    className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    {deleting ? '…' : 'Delete'}
                  </Button>
                  <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="More actions">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-2" align="start">
                      <div className="flex flex-col gap-1">
                        {job.output_path && job.status === 'completed' && (
                          <DownloadButton job={job} />
                        )}
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-md text-xs font-medium border border-input bg-background px-2 py-1.5 h-8 hover:bg-accent hover:text-accent-foreground whitespace-nowrap"
                          title="Open original URL"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Source
                        </a>
                        <Button size="sm" variant="outline" onClick={handleCopyUrl} title="Copy source URL" className="justify-start gap-2">
                          <Copy className="w-3.5 h-3.5" />
                          Copy URL
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlayerModal({ job, jobs, onClose, onEnded, startTime }: { job: Job | null; jobs: Job[]; onClose: () => void; onEnded?: () => void; startTime?: number }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pipActiveRef = useRef(false);
  const [pipAvailable, setPipAvailable] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [bgPlaybackWarning, setBgPlaybackWarning] = useState('');
  const liveJob = job ? (jobs.find(j => j.id === job.id) ?? job) : null;
  const isDownloading = liveJob?.status === 'downloading';
  const pct = liveJob?.progress?.percent ?? 0;
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
    if (startTime === undefined || startTime <= 0) return;
    const video = videoRef.current;
    if (!video) return;
    const seek = () => {
      if (video.readyState >= 2) {
        video.currentTime = startTime;
        video.removeEventListener('loadedmetadata', seek);
        video.removeEventListener('canplay', seek);
      }
    };
    if (video.readyState >= 2) {
      video.currentTime = startTime;
    } else {
      video.addEventListener('loadedmetadata', seek);
      video.addEventListener('canplay', seek);
      return () => {
        video.removeEventListener('loadedmetadata', seek);
        video.removeEventListener('canplay', seek);
      };
    }
  }, [job, startTime]);

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
      const pipVideo = video as PictureInPictureVideo;
      if (
        document.pictureInPictureElement === video ||
        pipVideo.webkitPresentationMode === 'picture-in-picture'
      ) return;

      try {
        if (
          document.pictureInPictureEnabled &&
          typeof video.requestPictureInPicture === 'function'
        ) {
          await video.requestPictureInPicture();
          return;
        }

        if (
          pipVideo.webkitSupportsPresentationMode?.('picture-in-picture')
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
        if (pauseCheckTimer) clearTimeout(pauseCheckTimer);
        pauseCheckTimer = setTimeout(() => {
          if (document.visibilityState === 'hidden' && video.paused && !video.ended) {
            video.play().catch(() => {});
          }
        }, BACKGROUND_PAUSE_CHECK_DELAY_MS);
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
      if (document.visibilityState === 'hidden' && !video.ended) {
        const isInPiP = pipActiveRef.current
          || document.pictureInPictureElement === video
          || (video as PictureInPictureVideo).webkitPresentationMode === 'picture-in-picture';
        if (isInPiP) {
          video.play().catch(() => {});
          return;
        }
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
      <div className="fixed inset-0 z-50 flex flex-col bg-black pb-[env(safe-area-inset-bottom,12px)] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[min(90vw,56rem)] sm:rounded-lg sm:overflow-hidden sm:pb-0">
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
        <div className="relative flex-1 bg-black sm:flex-none sm:aspect-video">
          <video
            ref={videoRef}
            controls
            autoPlay
            playsInline
            className="w-full h-full object-contain"
            src={fileUrl(job.id)}
            key={job.id}
            onEnded={onEnded}
          />
          <button
            onClick={handlePictureInPicture}
            disabled={!pipAvailable}
            className="absolute top-3 left-3 z-10 flex items-center justify-center w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white/80 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label={pipActive ? 'Exit Picture-in-Picture' : 'Enter Picture-in-Picture'}
            title={pipAvailable ? (pipActive ? 'Exit Picture-in-Picture' : 'Enter Picture-in-Picture') : 'Picture-in-Picture is not available in this browser'}
          >
            {pipActive ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M21 3a1 1 0 0 1 1 1v7h-2V5H4v14h6v2H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h18zm-1 10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h8zm-1 2h-6v4h6v-4z"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M21 3a1 1 0 0 1 1 1v7h-2V5H4v14h6v2H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h18zm0 10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h8z"/>
              </svg>
            )}
          </button>
          {bgPlaybackWarning && (
            <div className="absolute bottom-10 left-3 right-3 z-10">
              <p className="text-xs text-amber-300 bg-black/70 px-3 py-1.5 rounded">
                {bgPlaybackWarning}
              </p>
            </div>
          )}
        </div>
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
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Settings">
          <Settings className="w-4 h-4" />
        </Button>
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
  const playlistStartTimeRef = useRef<number>(0);
  const playlistInitializedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bulk select
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Delete before date
  const [beforeDate, setBeforeDate] = useState('');
  const appVersion = getAppVersion();
  const appVersionShort = getAppVersionShort();

  // Subtitle search
  const [subQuery, setSubQuery] = useState('');
  const [subResults, setSubResults] = useState<SubtitleSearchResult[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [subSearched, setSubSearched] = useState(false);
  const seekTimeRef = useRef<number | undefined>(undefined);

  const [showQueueForm, setShowQueueForm] = useState(false);
  const [showSubSearch, setShowSubSearch] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);

  async function handleSubSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = subQuery.trim();
    if (!q) return;
    setSubLoading(true);
    setSubSearched(true);
    setSubResults([]);
    try {
      const res = await searchSubtitles(q);
      setSubResults(res.results ?? []);
    } catch {
      setSubResults([]);
    } finally {
      setSubLoading(false);
    }
  }

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
    playlistInitializedRef.current = true;
  }, []);

  useEffect(() => {
    if (playlistInitializedRef.current) {
      if (!savePlaylistItems(playlist)) {
        alert('Warning: Could not save playlist. Local storage may be full. Try clearing some data.');
      }
    }
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
    playlistStartTimeRef.current = 0;
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

    playlistStartTimeRef.current = Date.now();
    playlistTimerRef.current = setTimeout(() => {
      stopPlaylistPlayback();
    }, playlistTimer * 60 * 1000);
  }

  function advancePlaylist() {
    if (playlistIndex === null) return;

    if (playlistStartTimeRef.current > 0) {
      const elapsed = Date.now() - playlistStartTimeRef.current;
      const limit = playlistTimer * 60 * 1000;
      if (elapsed >= limit) {
        stopPlaylistPlayback();
        return;
      }
    }

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

    if (playlistStartTimeRef.current > 0) {
      const elapsed = Date.now() - playlistStartTimeRef.current;
      const limit = playlistTimer * 60 * 1000;
      const remaining = limit - elapsed;
      if (remaining <= 0) {
        stopPlaylistPlayback();
        return;
      }
      clearPlaylistTimer();
      playlistTimerRef.current = setTimeout(() => {
        stopPlaylistPlayback();
      }, remaining);
    }
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
    const duplicate = playlist.some((current, i) => i !== index && current.url === trimmedUrl);
    if (duplicate) {
      alert('Another playlist item already has this URL.');
      return;
    }
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

  function handleAddJobToPlaylist(job: Job): boolean {
    if (!job.url) return false;
    const already = playlist.some((item) => item.jobId === job.id || item.url === job.url);
    if (already) return false;
    addPlaylistItem(job.url, job.title || job.url, job.id);
    return true;
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
    setShowQueueForm(false);
  }

  const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'downloading');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/mytube.svg" alt="MyTube" className="w-7 h-7" />
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
        {/* Action toolbar */}
        {!selectMode ? (
          <div className="flex items-center gap-1.5 mb-4">
            <Button
              variant={showQueueForm ? 'default' : 'outline'}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => { setShowQueueForm(!showQueueForm); setShowSubSearch(false); }}
              title="Add URL"
            >
              <Plus className="w-4 h-4" />
            </Button>
            <Button
              variant={showSubSearch ? 'default' : 'outline'}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => { setShowSubSearch(!showSubSearch); setShowQueueForm(false); }}
              title="Search subtitles"
            >
              <Search className="w-4 h-4" />
            </Button>
            {jobs.length > 0 && (
              <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setSelectMode(true)} title="Select videos">
                <CheckSquare className="w-4 h-4" />
              </Button>
            )}
            <div className="flex items-center gap-1.5 ml-auto">
              <Button
                variant={showPlaylist ? 'default' : 'outline'}
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setShowPlaylist(!showPlaylist)}
                title={`Playlist${playlist.length > 0 ? ` (${playlist.length})` : ''}`}
              >
                <ListMusic className="w-4 h-4" />
              </Button>
              {jobs.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" className="h-8 w-8 p-0" title="Prune old videos">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-3" align="end">
                    <p className="text-sm font-medium mb-2">Delete videos before date</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={beforeDate}
                        onChange={e => setBeforeDate(e.target.value)}
                        className="text-sm border rounded px-2 py-1 bg-background h-8"
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!beforeDate}
                        onClick={handleDeleteBefore}
                      >
                        Delete
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-4">
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

        {/* Queue form (collapsible) */}
        {showQueueForm && (
          <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 mb-4">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste YouTube URL…"
              className="flex-1"
              disabled={submitting}
              autoFocus
            />
            <Button type="submit" disabled={submitting || !url.trim()}>
              {submitting ? '…' : 'Queue'}
            </Button>
          </form>
        )}
        {error && <p className="text-sm text-destructive mb-4">{error}</p>}

        {/* Subtitle search (collapsible) */}
        {showSubSearch && (
          <>
            <form onSubmit={handleSubSearch} className="flex items-center gap-2 mb-4">
              <Input
                value={subQuery}
                onChange={(e) => setSubQuery(e.target.value)}
                placeholder="Search subtitles…"
                className="flex-1"
                disabled={subLoading}
                autoFocus
              />
              <Button type="submit" disabled={subLoading || !subQuery.trim()}>
                {subLoading ? '…' : 'Search'}
              </Button>
            </form>
            {subSearched && (
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-2">
                  {subResults.length} result{subResults.length !== 1 ? 's' : ''} for "{subQuery}"
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {subResults.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        seekTimeRef.current = r.start;
                        setPlayingJob(jobs.find(j => j.id === r.job_id) ?? null);
                      }}
                      className="w-full text-left rounded-lg border p-2 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {formatTimestamp(r.start)}
                        </span>
                        <span className="text-xs font-medium truncate">{r.title || 'Video'}</span>
                      </div>
                      <p className="text-sm leading-relaxed">{r.text}</p>
                    </button>
                  ))}
                  {subResults.length === 0 && (
                    <p className="text-sm text-muted-foreground">No results found.</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Job list */}
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-muted-foreground text-sm">No downloads yet. Click Add URL or paste a YouTube link.</p>
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
              isInPlaylist={playlist.some((item) => item.jobId === j.id || item.url === j.url)}
              selectMode={selectMode}
              selected={selected.has(j.id)}
              onToggleSelect={() => handleToggleSelect(j.id)}
            />
          ))
        )}
      </main>

      {/* Playlist slide-over panel */}
      {showPlaylist && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/50 transition-opacity"
            onClick={() => setShowPlaylist(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 z-40 w-80 sm:w-96 bg-background shadow-xl overflow-y-auto animate-in slide-in-from-right">
            <div className="sticky top-0 bg-background border-b px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Playlist{playlist.length > 0 ? ` (${playlist.length})` : ''}
              </h2>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => setShowPlaylist(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-4">
              <div className="flex flex-wrap gap-2 mb-4">
                <Button
                  size="sm"
                  onClick={() => startPlaylistPlayback(0)}
                  disabled={!hasPlayablePlaylistItems()}
                >
                  <Play className="w-3.5 h-3.5 mr-1" />
                  Play all
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

              <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground mb-4">
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
                <p className="text-sm text-muted-foreground">No playlist entries yet. Add videos via the + button on completed downloads.</p>
              ) : (
                <div className="space-y-2">
                  {playlist.map((item, index) => {
                    const job = findPlaylistJob(item);
                    const playable = !!job && job.status === 'completed' && !!job.output_path;
                    return (
                      <div key={item.id} className="rounded-lg border p-2 flex gap-3 items-start">
                        {job?.thumbnail_url ? (
                          <img src={job.thumbnail_url} alt="" className="w-20 h-12 object-cover rounded flex-shrink-0" />
                        ) : (
                          <div className="w-20 h-12 rounded bg-muted flex-shrink-0 flex items-center justify-center">
                            <span className="text-xs text-muted-foreground">🎬</span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{item.url}</p>
                          <p className="text-xs text-muted-foreground">
                            {playable ? 'Ready to play' : job ? job.status : 'Not downloaded'}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            <Button size="sm" onClick={() => handlePlayPlaylistItem(index)} disabled={!playable}>▶</Button>
                            <Button size="sm" variant="outline" onClick={() => handleEditPlaylistItem(index)}>✏️</Button>
                            <Button size="sm" variant="outline" onClick={() => handleMovePlaylistItem(index, -1)} disabled={index === 0}>↑</Button>
                            <Button size="sm" variant="outline" onClick={() => handleMovePlaylistItem(index, 1)} disabled={index === playlist.length - 1}>↓</Button>
                            <Button size="sm" variant="destructive" onClick={() => handleRemovePlaylistItem(index)}>✖</Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <PlayerModal job={playingJob} jobs={jobs} onClose={() => { stopPlaylistPlayback(); setPlayingJob(null); seekTimeRef.current = undefined; }} onEnded={advancePlaylist} startTime={seekTimeRef.current} />

      <Button
        onClick={handlePasteIntoInput}
        disabled={submitting}
        className="fixed left-4 bottom-4 z-40 w-14 h-14 rounded-full shadow-lg p-0"
        title="Paste YouTube URL from clipboard and queue"
      >
        <ClipboardPaste className="w-6 h-6" />
      </Button>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, ClipboardPaste, Captions, CaptionsOff, MoreHorizontal, Play, Trash2, ListPlus, ExternalLink, Copy, Info, ListMusic, X, CheckSquare, Settings, RefreshCw, Clock, PictureInPicture2, SkipBack, SkipForward, RotateCcw } from 'lucide-react';
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
import {
  enterPictureInPicture,
  exitPictureInPicture,
  isPictureInPictureActive,
  supportsPictureInPicture,
  type PictureInPictureVideo,
} from '../utils/pictureInPicture';
import {
  ACTIVE_JOB_POLL_INTERVAL_MS,
  shouldPollJobs,
} from '../utils/jobPolling';
import { getPlaylistPlaybackState } from '../utils/playlistPlayback';
import { telemetry } from '../telemetry';
import {
  clearPlaybackProgress,
  getPlaybackProgress,
  savePlaybackProgress,
} from '../utils/playbackProgress';
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

const BACKGROUND_PLAYBACK_WARNING = 'Chrome stopped playback while the iPhone was locked. Resume playback, then tap Background before locking the screen.';

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

function setMediaSessionAction(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // WebKit exposes Media Session before it supports every action. One
    // unsupported action must not prevent play/pause lock-screen controls.
  }
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

      let readResult = await reader.read();
      while (!readResult.done) {
        const value = readResult.value;
        chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
        received += value.length;
        if (total > 0) setProgress(Math.round(received / total * 100));
        readResult = await reader.read();
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
  const videoDuration = formatDuration(job.duration_seconds ?? 0);
  const [playlistFeedback, setPlaylistFeedback] = useState<'added' | 'already' | null>(null);
  const playlistFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (playlistFeedbackTimerRef.current) {
        clearTimeout(playlistFeedbackTimerRef.current);
      }
    };
  }, []);

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
      telemetry.track('download_submitted', { outcome_code: 'retry' });
    } catch {
      telemetry.track('download_failed', { outcome_code: 'submit_error' });
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

type PlaylistPlayerContext = {
  position: number;
  total: number;
  sessionMinutes: number;
  previousTitle?: string;
  nextTitle?: string;
  onPrevious?: () => void;
  onNext?: () => void;
};

function PlayerModal({ job, jobs, onClose, onEnded, startTime, playlistContext }: {
  job: Job | null;
  jobs: Job[];
  onClose: () => void;
  onEnded?: () => void;
  startTime?: number;
  playlistContext?: PlaylistPlayerContext;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previousJobStatusRef = useRef<{ id: number; status: Job['status'] } | null>(null);
  const previousMediaJobIDRef = useRef<number | null>(null);
  const [bgPlaybackWarning, setBgPlaybackWarning] = useState('');
  const [pipSupported, setPipSupported] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [pipActivating, setPipActivating] = useState(false);
  const [pipError, setPipError] = useState('');
  const [pipHint, setPipHint] = useState('');
  const [hasSavedProgress, setHasSavedProgress] = useState(false);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const playbackStartedJobRef = useRef<number | null>(null);
  const playbackFailurePendingRef = useRef(false);
  const liveJob = job ? (jobs.find(j => j.id === job.id) ?? job) : null;
  const currentJobID = job?.id ?? null;
  const playbackMode = playlistContext ? 'playlist' : 'standalone';
  const progressKey = job
    ? (job.url.trim() ? `url:${job.url.trim()}` : `job:${job.id}`)
    : '';
  const playerOpen = job !== null;
  const isDownloading = liveJob?.status === 'downloading';
  const pct = liveJob?.progress?.percent ?? 0;
  useEffect(() => {
    if (!job) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handler);
    };
  }, [job, onClose]);

  useEffect(() => {
    if (!job) return;
    setBgPlaybackWarning('');
    setPipError('');
    setPipHint('');
  }, [job]);

  useEffect(() => {
    if (!job) return;
    const video = videoRef.current as PictureInPictureVideo | null;
    if (!video) return;

    const updatePiPState = () => {
      const active = isPictureInPictureActive(video);
      setPipActive(active);
      setPipSupported(supportsPictureInPicture(video));
      if (active) {
        setPipActivating(false);
        setPipHint(isIOS() ? 'PiP ready — swipe Home once, then lock the screen.' : '');
      } else {
        setPipHint('');
      }
    };
    updatePiPState();
    video.addEventListener('loadedmetadata', updatePiPState);
    video.addEventListener('canplay', updatePiPState);
    video.addEventListener('enterpictureinpicture', updatePiPState);
    video.addEventListener('leavepictureinpicture', updatePiPState);
    video.addEventListener('webkitpresentationmodechanged', updatePiPState as EventListener);
    return () => {
      video.removeEventListener('loadedmetadata', updatePiPState);
      video.removeEventListener('canplay', updatePiPState);
      video.removeEventListener('enterpictureinpicture', updatePiPState);
      video.removeEventListener('leavepictureinpicture', updatePiPState);
      video.removeEventListener('webkitpresentationmodechanged', updatePiPState as EventListener);
    };
  }, [job]);

  const handlePictureInPicture = useCallback(async () => {
    const video = videoRef.current as PictureInPictureVideo | null;
    if (!video) return;

    setPipError('');
    setPipHint('');
    try {
      if (isPictureInPictureActive(video)) {
        await exitPictureInPicture(video);
        return;
      }

      // Start both operations during the button's user activation. Awaiting
      // play() first causes iOS Chrome to reject the subsequent PiP request.
      setPipActivating(true);
      const enterPromise = enterPictureInPicture(video);
      const playPromise = video.paused ? video.play() : Promise.resolve();
      await enterPromise;
      await playPromise;
      setBgPlaybackWarning('');
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      setPipError(detail || 'Could not start Picture-in-Picture. Start the video, then tap Background again.');
    } finally {
      setPipActivating(false);
    }
  }, []);

  useEffect(() => {
    if (!job) return;
    const video = videoRef.current;
    if (!video) return;
    setHasSavedProgress(false);
    setResumedFrom(null);

    const seek = () => {
      const explicitStart = startTime !== undefined && startTime > 0
        ? startTime
        : null;
      const position = explicitStart
        ?? getPlaybackProgress(progressKey, video.duration);
      if (position !== null && position > 0) {
        video.currentTime = Math.min(
          position,
          Number.isFinite(video.duration) ? video.duration : position,
        );
      }
      if (explicitStart === null && position !== null) {
        setHasSavedProgress(true);
        setResumedFrom(position);
      }
    };
    if (video.readyState >= 1) {
      seek();
    } else {
      video.addEventListener('loadedmetadata', seek);
      return () => {
        video.removeEventListener('loadedmetadata', seek);
      };
    }
  }, [job, progressKey, startTime]);

  useEffect(() => {
    if (!job) return;
    const video = videoRef.current;
    if (!video) return;
    let lastPosition = video.currentTime;
    let lastDuration = video.duration;
    let lastPersistedPosition = lastPosition;
    const isCurrentSource = () =>
      video.getAttribute('src') === fileUrl(job.id);

    const persist = (force = false) => {
      if (!force && Math.abs(lastPosition - lastPersistedPosition) < 5) return;
      lastPersistedPosition = lastPosition;
      const saved = savePlaybackProgress(
        progressKey,
        lastPosition,
        lastDuration,
      );
      setHasSavedProgress(saved);
      if (!saved) setResumedFrom(null);
    };
    const capture = () => {
      if (!isCurrentSource()) return;
      lastPosition = video.currentTime;
      lastDuration = video.duration;
      persist();
    };
    const flush = () => {
      if (!isCurrentSource()) {
        persist(true);
        return;
      }
      lastPosition = video.currentTime;
      lastDuration = video.duration;
      persist(true);
    };
    const clearCompleted = () => {
      lastPosition = video.duration;
      lastDuration = video.duration;
      lastPersistedPosition = video.duration;
      clearPlaybackProgress(progressKey);
      setHasSavedProgress(false);
      setResumedFrom(null);
    };

    video.addEventListener('timeupdate', capture);
    video.addEventListener('pause', flush);
    video.addEventListener('ended', clearCompleted);
    window.addEventListener('pagehide', flush);
    return () => {
      video.removeEventListener('timeupdate', capture);
      video.removeEventListener('pause', flush);
      video.removeEventListener('ended', clearCompleted);
      window.removeEventListener('pagehide', flush);
      persist(true);
    };
  }, [job, progressKey]);

  const handleStartOver = useCallback(() => {
    if (!job) return;
    clearPlaybackProgress(progressKey);
    setHasSavedProgress(false);
    setResumedFrom(null);
    telemetry.track('playback_started_over', {
      playback_mode: playbackMode,
    });
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    video.play().catch(() => undefined);
  }, [job, playbackMode, progressKey]);

  useEffect(() => {
    if (currentJobID === null) return;
    const video = videoRef.current;
    if (!video) return;
    playbackStartedJobRef.current = null;
    playbackFailurePendingRef.current = false;

    const onPlaying = () => {
      if (playbackStartedJobRef.current !== currentJobID) {
        playbackStartedJobRef.current = currentJobID;
        telemetry.track('video_started', { playback_mode: playbackMode });
      }
      if (playbackFailurePendingRef.current) {
        playbackFailurePendingRef.current = false;
        telemetry.track('playback_recovered', { playback_mode: playbackMode });
      }
    };
    const recordFailure = (outcome: 'media_error' | 'network_stall') => {
      if (playbackFailurePendingRef.current) return;
      playbackFailurePendingRef.current = true;
      telemetry.track('playback_failed', { playback_mode: playbackMode, outcome_code: outcome });
    };
    const onError = () => recordFailure('media_error');
    const onStalled = () => recordFailure('network_stall');
    const onEndedEvent = () => telemetry.track('video_completed', {
      playback_mode: playbackMode,
      elapsed_seconds: Number.isFinite(video.currentTime) ? Math.round(video.currentTime) : undefined,
    });

    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('ended', onEndedEvent);
    return () => {
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('ended', onEndedEvent);
    };
  }, [currentJobID, playbackMode]);

  useEffect(() => {
    if (!job) return;
    const previousJobID = previousMediaJobIDRef.current;
    previousMediaJobIDRef.current = job.id;
    if (previousJobID === null || previousJobID === job.id) return;

    // Keep one video element for the entire playlist. iOS grants background
    // playback/PiP to that element; replacing it at a track boundary loses the
    // active lock-screen session. Explicitly continue the new source on the
    // already-authorized element.
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {
      setBgPlaybackWarning('Chrome paused at the playlist transition. Unlock once and tap play to continue.');
    });
  }, [job]);

  useEffect(() => {
    if (!job || !liveJob) return;

    const previous = previousJobStatusRef.current;
    previousJobStatusRef.current = { id: job.id, status: liveJob.status };
    if (
      !previous
      || previous.id !== job.id
      || previous.status !== 'downloading'
      || liveJob.status !== 'completed'
    ) return;

    // A request opened while the file is growing has the old Content-Length.
    // Reload after completion so iOS background playback sees the final file,
    // while preserving the viewer's current position and play state.
    const video = videoRef.current;
    if (!video) return;
    const resumeAt = video.currentTime;
    const shouldResume = !video.paused && !video.ended;
    const restorePlayback = () => {
      if (Number.isFinite(resumeAt) && resumeAt > 0) {
        video.currentTime = Math.min(resumeAt, Number.isFinite(video.duration) ? video.duration : resumeAt);
      }
      if (shouldResume) {
        video.play().catch(() => setBgPlaybackWarning('Download finished. Tap play once, then use Background.'));
      }
    };

    video.addEventListener('loadedmetadata', restorePlayback, { once: true });
    video.load();
    return () => video.removeEventListener('loadedmetadata', restorePlayback);
  }, [job, liveJob]);

  useEffect(() => {
    if (!job) return;
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;

    const artwork = job.thumbnail_url ? [{ src: job.thumbnail_url }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: job.title || 'MyTube video',
      artist: job.uploader || 'MyTube',
      artwork,
    });
  }, [job]);

  useEffect(() => {
    if (!playerOpen) return;
    const video = videoRef.current;
    if (!video || !('mediaSession' in navigator)) return;

    setMediaSessionAction('play', () => { video.play().catch(() => undefined); });
    setMediaSessionAction('pause', () => video.pause());
    setMediaSessionAction('stop', () => video.pause());
    setMediaSessionAction('seekbackward', () => {
      video.currentTime = Math.max(0, video.currentTime - 10);
    });
    setMediaSessionAction('seekforward', () => {
      const nextTime = video.currentTime + 10;
      const hasFiniteDuration = Number.isFinite(video.duration) && video.duration > 0;
      video.currentTime = hasFiniteDuration ? Math.min(video.duration, nextTime) : nextTime;
    });
    setMediaSessionAction('previoustrack', playlistContext?.onPrevious ?? null);
    setMediaSessionAction('nexttrack', playlistContext?.onNext ?? null);
    navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';

    const onPlay = () => { navigator.mediaSession.playbackState = 'playing'; };
    const onPause = () => { navigator.mediaSession.playbackState = 'paused'; };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      setMediaSessionAction('play', null);
      setMediaSessionAction('pause', null);
      setMediaSessionAction('stop', null);
      setMediaSessionAction('seekbackward', null);
      setMediaSessionAction('seekforward', null);
      setMediaSessionAction('previoustrack', null);
      setMediaSessionAction('nexttrack', null);
    };
  }, [playerOpen, playlistContext]);

  useEffect(() => {
    if (!job) return;
    const video = videoRef.current;
    if (!video) return;
    let wasPlayingWhenHidden = false;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wasPlayingWhenHidden = !video.paused && !video.ended;
        return;
      }

      if (wasPlayingWhenHidden && video.paused && !video.ended) {
        setBgPlaybackWarning(BACKGROUND_PLAYBACK_WARNING);
      }
    };
    const onPlay = () => setBgPlaybackWarning('');

    document.addEventListener('visibilitychange', onVisibilityChange);
    video.addEventListener('play', onPlay);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      video.removeEventListener('play', onPlay);
    };
  }, [job]);

  if (!job) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/80" onClick={onClose} />
      <div
        className="player-modal fixed inset-0 z-50 flex flex-col bg-black pb-[env(safe-area-inset-bottom,12px)] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[min(90vw,56rem)] sm:rounded-lg sm:overflow-hidden sm:pb-0"
        role="dialog"
        aria-modal="true"
        aria-label={job.title || 'Video player'}
      >
        <div className="player-modal-header flex items-center gap-3 px-4 py-3 bg-neutral-900 shrink-0">
          <div className="player-modal-title min-w-0 flex-1" aria-live="polite">
            {playlistContext && (
              <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                <ListMusic className="h-3 w-3" />
                <span>Playlist · {playlistContext.position} of {playlistContext.total}</span>
              </div>
            )}
            <p className="truncate text-sm font-medium text-white">{job.title || 'Video'}</p>
          </div>
          {hasSavedProgress && (
            <button
              type="button"
              onClick={handleStartOver}
              className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-white/10 px-2.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
              title={resumedFrom === null
                ? 'Clear saved progress and play from the beginning'
                : `Resumed at ${formatTimestamp(resumedFrom)} — play from the beginning`}
              aria-label="Clear saved progress and start over"
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">Start over</span>
            </button>
          )}
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-white/10 px-2.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
            aria-label="Open original video on YouTube"
            title="Open original URL"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">Source</span>
          </a>
          {pipSupported && (
            <button
              type="button"
              onClick={handlePictureInPicture}
              disabled={isDownloading || pipActivating}
              className={`flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                pipActive ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
              } disabled:cursor-not-allowed disabled:opacity-40`}
              aria-pressed={pipActive}
              title={isDownloading
                ? 'Background playback is available when this download finishes'
                : 'Use Picture-in-Picture for reliable playback when switching apps or locking your iPhone'}
            >
              <PictureInPicture2 className="h-4 w-4" />
              <span>{pipActivating ? 'Starting…' : pipActive ? 'PiP ready' : 'Background'}</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl leading-none text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="player-video-shell relative flex-1 bg-black sm:flex-none sm:aspect-video">
          <video
            ref={videoRef}
            controls
            autoPlay
            playsInline
            preload="none"
            className="w-full h-full object-contain"
            src={fileUrl(job.id)}
            onEnded={onEnded}
          />
          {(pipError || bgPlaybackWarning || pipHint) && (
            <div className="absolute bottom-10 left-3 right-3 z-10">
              <p className={`text-xs bg-black/70 px-3 py-1.5 rounded ${pipHint && !pipError && !bgPlaybackWarning ? 'text-sky-200' : 'text-amber-300'}`}>
                {pipError || bgPlaybackWarning || pipHint}
              </p>
            </div>
          )}
        </div>
        {playlistContext && (
          <div className="player-playlist-bar flex shrink-0 items-center gap-3 border-t border-white/10 bg-neutral-900 px-3 py-2.5 sm:px-4">
            <button
              type="button"
              onClick={playlistContext.onPrevious}
              disabled={!playlistContext.onPrevious}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Previous playlist video"
              title={playlistContext.previousTitle ? `Previous: ${playlistContext.previousTitle}` : 'No previous video'}
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] text-white/50">
                <span>Playing from playlist</span>
                <span aria-hidden="true">·</span>
                <span>{playlistContext.sessionMinutes} min session</span>
              </div>
              <p className="truncate text-xs text-white/80">
                {playlistContext.nextTitle ? `Up next: ${playlistContext.nextTitle}` : 'Last video in playlist'}
              </p>
            </div>
            <button
              type="button"
              onClick={playlistContext.onNext}
              disabled={!playlistContext.onNext}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-400 text-neutral-950 transition-colors hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white disabled:opacity-30"
              aria-label="Next playlist video"
              title={playlistContext.nextTitle ? `Next: ${playlistContext.nextTitle}` : 'No next video'}
            >
              <SkipForward className="h-4 w-4" />
            </button>
          </div>
        )}
        {isDownloading && (
          <div className="player-download-progress px-4 py-2 bg-neutral-900 shrink-0">
            <div className="flex justify-between text-xs text-white/60 mb-1">
              <span>Downloading… {pct.toFixed(1)}%</span>
              <span>{liveJob.progress?.speed ?? ''}{liveJob.progress?.eta ? ` · ETA ${liveJob.progress.eta}` : ''}</span>
            </div>
            <Progress value={pct} className="h-1" />
            <p className="text-xs text-white/40 mt-1">You can only seek within the downloaded portion above. Background playback becomes available when the download finishes.</p>
          </div>
        )}
      </div>
    </>
  );
}

function SettingsModal() {
  const [apiBase, setApiBase] = useState(getApiBase);
  const [token, setToken] = useState(getToken);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(() => telemetry.isEnabled());
  const [saved, setSaved] = useState(false);

  function handleSave() {
    saveSettings(apiBase, token);
    telemetry.setEnabled(analyticsEnabled);
    if (analyticsEnabled) {
      telemetry.trackOpenedOnce();
      void telemetry.flush();
    }
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
              placeholder="https://mytubeapi.elladali.com"
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
          <label className="flex items-start gap-3 rounded-md border p-3">
            <input
              type="checkbox"
              checked={analyticsEnabled}
              onChange={(event) => setAnalyticsEnabled(event.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-medium">Share private usage analytics</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Sends playback, playlist, and download outcomes to your Mytube server. Never sends video URLs, titles, tokens, email, or device identifiers. Turning this off deletes queued events.
              </span>
            </span>
          </label>
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
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pageVisibility, setPageVisibility] = useState<DocumentVisibilityState>(
    () => document.visibilityState,
  );

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
  const pollingActive = shouldPollJobs(jobs, pageVisibility);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    const onVisibilityChange = () => {
      setPageVisibility(document.visibilityState);
      if (document.visibilityState === 'visible') fetchJobs();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [fetchJobs]);

  useEffect(() => {
    if (!pollingActive) return;

    let cancelled = false;
    const poll = async () => {
      await fetchJobs();
      if (!cancelled) {
        pollRef.current = setTimeout(poll, ACTIVE_JOB_POLL_INTERVAL_MS);
      }
    };
    pollRef.current = setTimeout(poll, ACTIVE_JOB_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = null;
    };
  }, [fetchJobs, pollingActive]);

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
      telemetry.track('download_submitted', { outcome_code: 'new' });
      setUrl('');
      fetchJobs();
    } catch (err) {
      telemetry.track('download_failed', { outcome_code: 'submit_error' });
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function findPlaylistJob(item: PlaylistItem) {
    return jobs.find((j) => item.jobId === j.id || j.url === item.url);
  }

  function isPlaylistItemPlayable(item: PlaylistItem) {
    const job = findPlaylistJob(item);
    return job?.status === 'completed' && !!job.output_path;
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

  function startPlaylistPlayback(startIndex = 0) {
    const nextIndex = playlist.slice(startIndex).findIndex(isPlaylistItemPlayable);
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
    seekTimeRef.current = undefined;

    playlistStartTimeRef.current = Date.now();
    telemetry.track('playlist_started', { playback_mode: 'playlist' });
    playlistTimerRef.current = setTimeout(() => {
      telemetry.track('playlist_completed', { playback_mode: 'playlist', outcome_code: 'timer' });
      stopPlaylistPlayback();
    }, playlistTimer * 60 * 1000);
  }

  function playPlaylistItem(index: number) {
    const item = playlist[index];
    if (!item) return false;
    const job = findPlaylistJob(item);
    if (!job || job.status !== 'completed' || !job.output_path) return false;
    setPlaylistIndex(index);
    setPlayingJob(job);
    seekTimeRef.current = undefined;
    return true;
  }

  function advancePlaylist(reason: 'completed' | 'skipped' = 'skipped') {
    if (playlistIndex === null) return;

    telemetry.track(reason === 'completed' ? 'playlist_item_completed' : 'playlist_item_skipped', {
      playback_mode: 'playlist',
    });

    if (playlistStartTimeRef.current > 0) {
      const elapsed = Date.now() - playlistStartTimeRef.current;
      const limit = playlistTimer * 60 * 1000;
      if (elapsed >= limit) {
        telemetry.track('playlist_completed', { playback_mode: 'playlist', outcome_code: 'timer' });
        stopPlaylistPlayback();
        return;
      }
    }

    const playbackState = getPlaylistPlaybackState(playlist, playlistIndex, isPlaylistItemPlayable);
    if (!playbackState || playbackState.nextIndex === null) {
      telemetry.track('playlist_completed', {
        playback_mode: 'playlist',
        outcome_code: reason === 'completed' ? 'finished' : 'stopped',
      });
      stopPlaylistPlayback();
      return;
    }
    if (!playPlaylistItem(playbackState.nextIndex)) {
      stopPlaylistPlayback();
    }
  }

  function previousPlaylistItem() {
    const playbackState = getPlaylistPlaybackState(playlist, playlistIndex, isPlaylistItemPlayable);
    if (playbackState?.previousIndex !== null && playbackState?.previousIndex !== undefined) {
      telemetry.track('playlist_item_skipped', { playback_mode: 'playlist', outcome_code: 'previous' });
      playPlaylistItem(playbackState.previousIndex);
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
    return playlist.some(isPlaylistItemPlayable);
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function handleToggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
  const playlistPlaybackState = getPlaylistPlaybackState(playlist, playlistIndex, isPlaylistItemPlayable);
  const playlistPlayerContext: PlaylistPlayerContext | undefined = playlistPlaybackState ? {
    position: playlistPlaybackState.position,
    total: playlistPlaybackState.total,
    sessionMinutes: playlistTimer,
    previousTitle: playlistPlaybackState.previousIndex === null
      ? undefined
      : playlist[playlistPlaybackState.previousIndex]?.title,
    nextTitle: playlistPlaybackState.nextIndex === null
      ? undefined
      : playlist[playlistPlaybackState.nextIndex]?.title,
    onPrevious: playlistPlaybackState.previousIndex === null ? undefined : previousPlaylistItem,
    onNext: playlistPlaybackState.nextIndex === null ? undefined : () => advancePlaylist('skipped'),
  } : undefined;

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

              <div className="flex gap-2 items-center text-xs text-muted-foreground mb-4">
                <Clock className="w-3.5 h-3.5 flex-shrink-0" />
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
                      <div
                        key={item.id}
                        className={`rounded-lg border p-2 flex gap-3 items-start transition-colors ${
                          playlistIndex === index ? 'border-sky-500/60 bg-sky-500/10' : ''
                        }`}
                      >
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
                          <p className={`text-xs ${playlistIndex === index ? 'font-medium text-sky-600 dark:text-sky-400' : 'text-muted-foreground'}`}>
                            {playlistIndex === index ? 'Now playing' : playable ? 'Ready to play' : job ? job.status : 'Not downloaded'}
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

      <PlayerModal
        job={playingJob}
        jobs={jobs}
        onClose={() => { stopPlaylistPlayback(); setPlayingJob(null); seekTimeRef.current = undefined; }}
        onEnded={() => advancePlaylist('completed')}
        startTime={seekTimeRef.current}
        playlistContext={playlistPlayerContext}
      />

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

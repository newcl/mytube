import { getApiBase, authHeaders } from './config';

export interface Progress {
  percent: number;
  speed: string;
  eta: string;
  downloaded_bytes: number;
  total_bytes: number;
}

export interface Job {
  id: number;
  url: string;
  status: 'queued' | 'downloading' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
  published_at: string;
  title: string;
  uploader: string;
  thumbnail_url: string;
  duration_seconds?: number;
  subtitles_checked: boolean;
  output_path: string;
  error: string;
  progress: Progress | null;
}

export interface MobilePairing {
  code: string;
  expires_at: string;
}

export interface MobileDevice {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string;
  revoked_at?: string;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

export type JobListStatus = 'active' | Job['status'];

export async function listJobs(limit = 50, status?: JobListStatus, beforeId?: number): Promise<Job[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set('status', status);
  if (beforeId) params.set('before_id', String(beforeId));
  const res = await apiFetch(`/api/jobs?${params}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// Fetch every page so a busy queue can never hide older completed videos.
export async function listAllJobs(status: JobListStatus): Promise<Job[]> {
  const pageSize = 200;
  const jobs: Job[] = [];
  let beforeId: number | undefined;
  do {
    const page = await listJobs(pageSize, status, beforeId);
    jobs.push(...page);
    beforeId = page.at(-1)?.id;
    if (page.length < pageSize) return jobs;
  } while (beforeId);
  return jobs;
}

export async function getJob(id: number): Promise<Job> {
  const res = await apiFetch(`/api/jobs/${id}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function createJob(url: string): Promise<{ id: number }> {
  const res = await apiFetch('/api/jobs', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status}`);
  }
  return res.json();
}

export async function retryJob(id: number): Promise<{ id: number }> {
  const res = await apiFetch(`/api/jobs/${id}/retry`, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status}`);
  }
  return res.json();
}

export async function getJobLog(id: number): Promise<string> {
  const res = await apiFetch(`/api/jobs/${id}/log`);
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return data.tail ?? '';
}

export async function deleteJob(id: number): Promise<void> {
  const res = await apiFetch(`/api/jobs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status}`);
}

export async function createMobilePairing(): Promise<MobilePairing> {
  const res = await apiFetch('/api/auth/pairings', { method: 'POST' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function listMobileDevices(): Promise<MobileDevice[]> {
  const res = await apiFetch('/api/auth/devices');
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function revokeMobileDevice(id: string): Promise<void> {
  const res = await apiFetch(`/api/auth/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status}`);
}

// --- Subtitles ---------------------------------------------------------------

export interface SubtitleEntry {
  lang: string;
  name: string;
}

export interface SubtitleList {
  subtitles: SubtitleEntry[];
  automatic_captions: SubtitleEntry[];
}

export interface SubtitleSearchResult {
  job_id: number;
  title: string;
  uploader: string;
  start: number;
  duration: number;
  text: string;
}

export interface SubtitleSearchResponse {
  results: SubtitleSearchResult[];
}

export async function getSubtitles(jobId: number): Promise<SubtitleList> {
  const res = await apiFetch(`/api/jobs/${jobId}/subtitles`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function searchSubtitles(q: string, lang?: string, limit?: number): Promise<SubtitleSearchResponse> {
  const params = new URLSearchParams({ q });
  if (lang) params.set('lang', lang);
  if (limit) params.set('limit', String(limit));
  const res = await apiFetch(`/api/subtitles/search?${params.toString()}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

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
  title: string;
  uploader: string;
  thumbnail_url: string;
  output_path: string;
  error: string;
  progress: Progress | null;
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

export async function listJobs(limit = 50): Promise<Job[]> {
  const res = await apiFetch(`/api/jobs?limit=${limit}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
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

import type { Job } from '../api';

export const ACTIVE_JOB_POLL_INTERVAL_MS = 3000;

export function hasActiveJobs(jobs: Pick<Job, 'status'>[]): boolean {
  return jobs.some((job) => job.status === 'queued' || job.status === 'downloading');
}

export function shouldPollJobs(
  jobs: Pick<Job, 'status'>[],
  visibilityState: DocumentVisibilityState,
): boolean {
  return visibilityState === 'visible' && hasActiveJobs(jobs);
}

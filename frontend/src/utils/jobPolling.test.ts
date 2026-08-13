import { describe, expect, it } from 'vitest';
import {
  ACTIVE_JOB_POLL_INTERVAL_MS,
  hasActiveJobs,
  shouldPollJobs,
} from './jobPolling';

describe('job polling', () => {
  it('polls at a modest interval while queued or downloading jobs exist', () => {
    expect(ACTIVE_JOB_POLL_INTERVAL_MS).toBe(3000);
    expect(hasActiveJobs([{ status: 'queued' }])).toBe(true);
    expect(hasActiveJobs([{ status: 'downloading' }])).toBe(true);
    expect(shouldPollJobs([{ status: 'queued' }], 'visible')).toBe(true);
  });

  it('does not poll an idle job list', () => {
    expect(hasActiveJobs([{ status: 'completed' }, { status: 'failed' }])).toBe(false);
    expect(shouldPollJobs([{ status: 'completed' }], 'visible')).toBe(false);
  });

  it('does not poll while the page is hidden', () => {
    expect(shouldPollJobs([{ status: 'downloading' }], 'hidden')).toBe(false);
  });
});

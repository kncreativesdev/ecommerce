import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPatch } from '../../lib/apiClient.js';
import { RETENTION_POLICIES, fetchRetentionPolicy, updateRetentionPolicy } from '../retention.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

const retention = {
  policy: '30_DAYS',
  description: 'Audit logs are deleted after 30 days.',
  updatedAt: '2026-03-01T10:00:00.000Z',
  updatedBy: 'u9',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('retention.service vocabulary', () => {
  it('mirrors exactly the backend policy enum', () => {
    expect([...RETENTION_POLICIES]).toEqual(['NEVER', '30_DAYS', '1_YEAR']);
  });
});

describe('retention.service read', () => {
  it('fetches the platform policy and returns it verbatim', async () => {
    apiGet.mockResolvedValue({ retention });

    expect(await fetchRetentionPolicy()).toEqual(retention);
    expect(apiGet).toHaveBeenCalledWith('/audit-retention');
  });

  it('falls back to null when the envelope carries nothing', async () => {
    apiGet.mockResolvedValue(null);

    expect(await fetchRetentionPolicy()).toBeNull();
  });
});

describe('retention.service save', () => {
  it('sends exactly { policy } and returns the server state', async () => {
    apiPatch.mockResolvedValue({ retention: { ...retention, policy: '1_YEAR', changed: true } });

    const result = await updateRetentionPolicy('1_YEAR');

    expect(apiPatch).toHaveBeenCalledWith('/audit-retention', { policy: '1_YEAR' });
    expect(apiPatch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ policy: '1_YEAR', changed: true });
  });

  it('passes idempotent responses through untouched', async () => {
    apiPatch.mockResolvedValue({ retention: { ...retention, policy: 'NEVER', changed: false } });

    expect(await updateRetentionPolicy('NEVER')).toMatchObject({ changed: false });
  });
});

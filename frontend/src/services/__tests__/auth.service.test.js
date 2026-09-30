import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPost } from '../../lib/apiClient.js';
import { registerRequest } from '../auth.service.js';

vi.mock('../../lib/apiClient.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerRequest first-name payload', () => {
  it('always includes the trimmed first name', async () => {
    apiPost.mockResolvedValue({ user: { id: 'u1' } });
    await registerRequest({
      email: 'Aarav@Example.COM',
      password: 'TestPass123!',
      firstName: '  Aarav  ',
      lastName: '',
      phone: '',
    });
    expect(apiPost).toHaveBeenCalledWith(
      '/auth/register',
      { email: 'aarav@example.com', password: 'TestPass123!', firstName: 'Aarav' },
      { skipAuthRefresh: true },
    );
  });

  it('keeps optional lastName/phone omission behavior', async () => {
    apiPost.mockResolvedValue({ user: { id: 'u1' } });
    await registerRequest({
      email: 'aarav@example.com',
      password: 'TestPass123!',
      firstName: 'Aarav',
      lastName: '  Tester  ',
      phone: '  ',
    });
    expect(apiPost).toHaveBeenCalledWith(
      '/auth/register',
      { email: 'aarav@example.com', password: 'TestPass123!', firstName: 'Aarav', lastName: 'Tester' },
      { skipAuthRefresh: true },
    );
  });
});

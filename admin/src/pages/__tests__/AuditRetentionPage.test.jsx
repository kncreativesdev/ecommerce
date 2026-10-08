import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { AuditRetentionPage } from '../AuditRetentionPage.jsx';
import { useRetentionStore } from '../../stores/useRetentionStore.js';
import { fetchRetentionPolicy, updateRetentionPolicy } from '../../services/retention.service.js';

vi.mock('../../services/retention.service.js', () => ({
  RETENTION_POLICIES: ['NEVER', '30_DAYS', '1_YEAR'],
  fetchRetentionPolicy: vi.fn(),
  updateRetentionPolicy: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const NEVER_STATE = {
  policy: 'NEVER',
  description: 'Audit logs are retained indefinitely.',
  updatedAt: null,
  updatedBy: null,
};

function resetStore() {
  useRetentionStore.setState({ retention: null, status: 'idle', error: null, saving: false });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/audit-retention']}>
      <AuditRetentionPage />
    </MemoryRouter>,
  );
}

/**
 * Select a policy radio and wait for the committed selection. React
 * may not commit the radio's state update before a back-to-back Save
 * click resolves, which would read a stale draft and skip the
 * confirmation modal — synchronizing here keeps reduction tests
 * deterministic without touching production code.
 */
async function selectPolicy(user, container, value) {
  await user.click(container.querySelector(`input[value="${value}"]`));
  await waitFor(() => {
    expect(container.querySelector(`input[value="${value}"]`).checked).toBe(true);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('AuditRetentionPage load', () => {
  it('fetches the policy on load and renders the NEVER state', async () => {
    fetchRetentionPolicy.mockResolvedValue({ ...NEVER_STATE });
    renderPage();

    expect(fetchRetentionPolicy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Audit Retention')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Never' })).toBeInTheDocument();
    // The current-state card renders the SERVER description; the
    // option cards below carry the static choice copy.
    const card = screen.getByRole('heading', { name: 'Never' }).closest('section');
    expect(within(card).getByText('Audit logs are retained indefinitely.')).toBeInTheDocument();
  });

  it.each([['30_DAYS', '30 days'], ['1_YEAR', '1 year']])('renders the %s state', async (policy, label) => {
    fetchRetentionPolicy.mockResolvedValue({
      policy,
      description: 'Server description.',
      updatedAt: '2026-03-01T10:00:00.000Z',
      updatedBy: 'actor-9',
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    const card = screen.getByRole('heading', { name: label }).closest('section');
    expect(within(card).getByText('Server description.')).toBeInTheDocument();
    // Timestamps and actor come from the server, rendered readably.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText('actor-9')).toBeInTheDocument();
  });

  it('renders null updatedBy cleanly', async () => {
    fetchRetentionPolicy.mockResolvedValue({ ...NEVER_STATE, updatedAt: '2026-03-01T10:00:00.000Z', updatedBy: null });
    renderPage();
    await screen.findByRole('heading', { name: 'Never' });

    const label = screen.getByText('Updated by');
    expect(label.closest('div').querySelector('dd')).toHaveTextContent('—');
  });

  it('shows loading, error with retry, and no mutation controls', async () => {
    fetchRetentionPolicy.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByRole('status', { name: 'Loading retention policy' })).toBeInTheDocument();

    // Back to idle so the manual reload below actually runs (the
    // mounted page is still showing its pending skeleton); an
    // unconsumed queued rejection would otherwise leak into the next
    // test's initial fetch.
    useRetentionStore.setState({ status: 'idle' });
    fetchRetentionPolicy.mockRejectedValueOnce({ message: 'Load failed.' });
    await useRetentionStore.getState().loadRetention();
    expect(await screen.findByText('Couldn’t load retention policy')).toBeInTheDocument();
    fetchRetentionPolicy.mockResolvedValue({ ...NEVER_STATE });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Never' })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /delete|purge|clean/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/company/i)).not.toBeInTheDocument();
  });
});

describe('AuditRetentionPage selection', () => {
  it('exposes exactly the three supported policies', async () => {
    fetchRetentionPolicy.mockResolvedValue({ ...NEVER_STATE });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Never' });

    const radios = container.querySelectorAll('input[name="retention-policy"]');
    expect([...radios].map((input) => input.value).sort()).toEqual(['1_YEAR', '30_DAYS', 'NEVER']);
  });
});

describe('AuditRetentionPage save', () => {
  it('sends exactly { policy } on save', async () => {
    const user = userEvent.setup();
    fetchRetentionPolicy.mockResolvedValue({ ...NEVER_STATE });
    updateRetentionPolicy.mockResolvedValue({ policy: '30_DAYS', description: 'd', updatedAt: 't', updatedBy: 'u', changed: true });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Never' });

    await selectPolicy(user, container, '30_DAYS');
    // Reduction opens the confirmation modal first; confirm it to
    // reach the save.
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await user.click(await screen.findByRole('button', { name: /yes, shorten retention/i }));
    expect(updateRetentionPolicy).toHaveBeenCalledTimes(1);
    expect(updateRetentionPolicy).toHaveBeenCalledWith('30_DAYS');
  });

  it('blocks duplicate submission while saving', async () => {
    const user = userEvent.setup();
    fetchRetentionPolicy.mockResolvedValue({ ...NEVER_STATE });
    let resolveSave;
    updateRetentionPolicy.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Never' });

    await selectPolicy(user, container, '30_DAYS');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await user.click(await screen.findByRole('button', { name: /yes, shorten retention/i }));
    // The modal closes on confirm; a second Save while the first is
    // still in flight must not issue another request (store `saving`
    // guard, not just the disabled button).
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(updateRetentionPolicy).toHaveBeenCalledTimes(1);
    resolveSave({ policy: '30_DAYS', changed: true });
  });

  it('announces a real change with success feedback', async () => {
    const user = userEvent.setup();
    fetchRetentionPolicy.mockResolvedValue({ ...NEVER_STATE });
    updateRetentionPolicy.mockResolvedValue({ policy: '30_DAYS', description: 'd', updatedAt: 't', updatedBy: 'u', changed: true });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Never' });

    await selectPolicy(user, container, '30_DAYS');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await user.click(await screen.findByRole('button', { name: /yes, shorten retention/i }));
    expect(toast.success).toHaveBeenCalledWith('Audit retention updated.');
  });

  it('treats same-value saves as idempotent success without confirmation', async () => {
    const user = userEvent.setup();
    fetchRetentionPolicy.mockResolvedValue({ ...NEVER_STATE });
    updateRetentionPolicy.mockResolvedValue({ ...NEVER_STATE, changed: false });
    renderPage();
    await screen.findByRole('heading', { name: 'Never' });

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(updateRetentionPolicy).toHaveBeenCalledWith('NEVER');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/already set/i));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('handles backend 422, 403, and network errors with toasts', async () => {
    const user = userEvent.setup();
    fetchRetentionPolicy.mockResolvedValue({ ...NEVER_STATE });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Never' });

    const confirmSave = async () => {
      await user.click(screen.getByRole('button', { name: /save changes/i }));
      await user.click(await screen.findByRole('button', { name: /yes, shorten retention/i }));
    };

    updateRetentionPolicy.mockRejectedValueOnce({ code: 'VALIDATION_ERROR', message: 'Bad policy.' });
    await selectPolicy(user, container, '30_DAYS');
    await confirmSave();
    expect(toast.error).toHaveBeenCalledWith('Bad policy.');

    updateRetentionPolicy.mockRejectedValueOnce({ code: 'AUTH_FORBIDDEN', message: 'Forbidden.' });
    await confirmSave();
    expect(toast.error).toHaveBeenCalledWith('Forbidden.');
    expect(updateRetentionPolicy).toHaveBeenCalledTimes(2);

    updateRetentionPolicy.mockRejectedValueOnce(new Error('Network error. Check your connection and retry.'));
    await confirmSave();
    expect(toast.error).toHaveBeenCalledWith('Network error. Check your connection and retry.');
  });
});

describe('AuditRetentionPage confirmation', () => {
  it('requires confirmation for reductions and executes on confirm', async () => {
    const user = userEvent.setup();
    fetchRetentionPolicy.mockResolvedValue({ ...NEVER_STATE });
    updateRetentionPolicy.mockResolvedValue({ policy: '1_YEAR', changed: true });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Never' });

    await selectPolicy(user, container, '1_YEAR');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(updateRetentionPolicy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/eligible for automatic cleanup/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /yes, shorten retention/i }));
    expect(updateRetentionPolicy).toHaveBeenCalledWith('1_YEAR');
  });

  it('cancel aborts without saving', async () => {
    const user = userEvent.setup();
    fetchRetentionPolicy.mockResolvedValue({ ...NEVER_STATE });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Never' });

    await selectPolicy(user, container, '30_DAYS');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(updateRetentionPolicy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('increases apply directly without confirmation', async () => {
    const user = userEvent.setup();
    fetchRetentionPolicy.mockResolvedValue({
      policy: '30_DAYS',
      description: 'd',
      updatedAt: 't',
      updatedBy: 'u',
    });
    updateRetentionPolicy.mockResolvedValue({ policy: '1_YEAR', changed: true });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: '30 days' });

    await selectPolicy(user, container, '1_YEAR');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(updateRetentionPolicy).toHaveBeenCalledWith('1_YEAR');
  });
});



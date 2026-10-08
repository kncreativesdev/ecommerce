import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { AuditLogsPage } from '../AuditLogsPage.jsx';
import { useAuditStore } from '../../stores/useAuditStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { downloadAuditLogsCsv, fetchAuditLogs } from '../../services/audit.service.js';

vi.mock('../../services/audit.service.js', () => ({
  fetchAuditLogs: vi.fn(),
  downloadAuditLogsCsv: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function logFixture(overrides = {}) {
  return {
    id: 'log-1',
    actorId: 'u1',
    actorRole: 'ADMIN',
    actorEmail: 'admin@example.test',
    companyId: 'c1',
    action: 'CREATED',
    resource: 'USER',
    resourceId: 'u2',
    outcome: 'SUCCESS',
    details: null,
    createdAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

function resetStores(user = { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] }) {
  useAuditStore.setState({
    logs: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: { action: '', resource: '', outcome: '', role: '', actorId: '', resourceId: '', companyId: '', from: '', to: '' },
    status: 'idle',
    error: null,
    exporting: false,
  });
  useAuthStore.setState({ user, status: 'ready', accessToken: 'token', error: null });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/audit-logs']}>
      <AuditLogsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStores();
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

describe('AuditLogsPage', () => {
  it('loads the list on mount with page 1 and backend pagination meta', async () => {
    fetchAuditLogs.mockResolvedValue({
      logs: [logFixture()],
      pagination: { page: 1, limit: 20, total: 42, totalPages: 3 },
    });
    renderPage();

    expect(fetchAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
    expect(await screen.findByText('42 entries')).toBeInTheDocument();
    expect(screen.getByText('admin@example.test')).toBeInTheDocument();
  });

  it('renders safe audit fields in the table', async () => {
    fetchAuditLogs.mockResolvedValue({
      logs: [logFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();

    const table = await screen.findByRole('table', { name: 'Audit logs' });
    expect(within(table).getByText('admin@example.test')).toBeInTheDocument();
    expect(within(table).getByText('CREATED')).toBeInTheDocument();
    expect(within(table).getByText('USER')).toBeInTheDocument();
    expect(within(table).getByText('SUCCESS')).toBeInTheDocument();
    expect(within(table).getByText('ADMIN')).toBeInTheDocument();
  });

  it('renders SYSTEM and null actors safely', async () => {
    fetchAuditLogs.mockResolvedValue({
      logs: [logFixture({ actorEmail: null, actorId: null })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();

    expect(await screen.findByText('System')).toBeInTheDocument();
  });

  it('maps filter controls to the exact supported query params', async () => {
    const user = userEvent.setup();
    fetchAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const { container } = renderPage();
    await screen.findByText('0 entries');

    await user.selectOptions(container.querySelector('#audit-action-filter'), 'DELETED');
    expect(fetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'DELETED', page: 1 }));

    await user.selectOptions(container.querySelector('#audit-resource-filter'), 'ORDER');
    expect(fetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ resource: 'ORDER', page: 1 }));

    await user.selectOptions(container.querySelector('#audit-outcome-filter'), 'FAILURE');
    expect(fetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'FAILURE', page: 1 }));

    await user.selectOptions(container.querySelector('#audit-role-filter'), 'MEMBER');
    expect(fetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'MEMBER', page: 1 }));

    fireEvent.change(container.querySelector('#audit-from-filter'), { target: { value: '2026-01-01' } });
    expect(fetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-01-01', page: 1 }));
  });

  it('applies text filters on Apply and never sends unsupported params', async () => {
    const user = userEvent.setup();
    fetchAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const { container } = renderPage();
    await screen.findByText('0 entries');

    await user.type(container.querySelector('#audit-actor-filter'), 'u9');
    await user.type(container.querySelector('#audit-resource-id-filter'), 'o9');
    expect(fetchAuditLogs).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const lastCall = fetchAuditLogs.mock.calls[fetchAuditLogs.mock.calls.length - 1][0];
    // The service sends only provided filters plus pagination.
    expect(lastCall).toEqual({ actorId: 'u9', resourceId: 'o9', page: 1, limit: 20 });
  });

  it('resets to page 1 when filters change and keeps filters across pages', async () => {
    const user = userEvent.setup();
    fetchAuditLogs.mockResolvedValue({
      logs: [logFixture()],
      pagination: { page: 1, limit: 20, total: 45, totalPages: 3 },
    });
    const { container } = renderPage();
    await screen.findByText('45 entries');

    await user.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(fetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    await user.selectOptions(container.querySelector('#audit-action-filter'), 'UPDATED');
    const lastCall = fetchAuditLogs.mock.calls[fetchAuditLogs.mock.calls.length - 1][0];
    expect(lastCall).toMatchObject({ action: 'UPDATED', page: 1 });

    await user.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(fetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'UPDATED', page: 2 }));
  });

  it('clears all filters at once', async () => {
    const user = userEvent.setup();
    fetchAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const { container } = renderPage();
    await screen.findByText('0 entries');

    await user.selectOptions(container.querySelector('#audit-action-filter'), 'DELETED');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    // Cleared filters are dropped from the request entirely (service
    // sends only non-empty values); pagination restarts at page 1.
    expect(fetchAuditLogs).toHaveBeenLastCalledWith({ page: 1, limit: 20 });
  });

  it('opens a read-only detail view with the complete safe projection', async () => {
    const user = userEvent.setup();
    fetchAuditLogs.mockResolvedValue({
      logs: [logFixture({ details: { orderId: 'o1', reason: 'DAMAGED' } })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('admin@example.test');

    await user.click(screen.getByRole('button', { name: /view audit log details/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Audit log details' });
    for (const label of ['ID', 'Created at', 'Actor', 'Actor ID', 'Actor role', 'Company', 'Action', 'Resource', 'Resource ID', 'Outcome', 'Details']) {
      expect(within(dialog).getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(within(dialog).getByText(/DAMAGED/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /delete|edit|save/i })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Audit log details' })).not.toBeInTheDocument();
  });

  it('renders null details safely without object placeholders', async () => {
    const user = userEvent.setup();
    fetchAuditLogs.mockResolvedValue({
      logs: [logFixture({ details: null })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('admin@example.test');

    await user.click(screen.getByRole('button', { name: /view audit log details/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Audit log details' });
    expect(within(dialog).queryByText('[object Object]')).not.toBeInTheDocument();
  });

  it('offers no audit mutation controls anywhere', async () => {
    fetchAuditLogs.mockResolvedValue({
      logs: [logFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('admin@example.test');

    expect(screen.queryByRole('button', { name: /delete.*audit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retention|purge|bulk delete/i })).not.toBeInTheDocument();
    const headers = within(screen.getByRole('table', { name: 'Audit logs' })).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).not.toContain('Actions');
  });

  it('shows loading, empty, and error states with retry', async () => {
    fetchAuditLogs.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByRole('status', { name: 'Loading audit logs' })).toBeInTheDocument();

    fetchAuditLogs.mockRejectedValueOnce({ message: 'List failed.' });
    useAuditStore.getState().refreshLogs();
    expect(await screen.findByText('Couldn’t load audit logs')).toBeInTheDocument();
    fetchAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No audit logs yet')).toBeInTheDocument();
  });

  it('shows a filtered-empty state distinct from the pristine empty state', async () => {
    fetchAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const { container } = renderPage();
    await screen.findByText('No audit logs yet');

    await userEvent.setup().selectOptions(container.querySelector('#audit-action-filter'), 'DELETED');
    expect(await screen.findByText('No audit logs match')).toBeInTheDocument();
  });

  it('exports the backend CSV with active filters and no pagination', async () => {
    const user = userEvent.setup();
    fetchAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    downloadAuditLogsCsv.mockResolvedValue({ blob: new Blob(['id\n1']), filename: 'audit-logs-20260304.csv' });
    const { container } = renderPage();
    await screen.findByText('0 entries');

    await user.selectOptions(container.querySelector('#audit-resource-filter'), 'ORDER');
    await user.click(screen.getByRole('button', { name: /export csv/i }));

    expect(downloadAuditLogsCsv).toHaveBeenCalledTimes(1);
    const [params] = downloadAuditLogsCsv.mock.calls[0];
    expect(params).toMatchObject({ resource: 'ORDER' });
    expect(params).not.toHaveProperty('page');
    expect(params).not.toHaveProperty('limit');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Audit logs exported.');
  });

  it('surfaces an actionable error when the export is too large', async () => {
    const user = userEvent.setup();
    fetchAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    downloadAuditLogsCsv.mockRejectedValue({ code: 'AUDIT_EXPORT_TOO_LARGE', message: 'Too large.' });
    renderPage();
    await screen.findByText('0 entries');

    await user.click(screen.getByRole('button', { name: /export csv/i }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/narrow the filters/i));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('loads through the same API for HEAD with no page-level role assumption', async () => {
    resetStores({ id: 'h1', email: 'head@example.test', roles: ['HEAD'] });
    fetchAuditLogs.mockResolvedValue({
      logs: [logFixture({ actorRole: 'HEAD', actorEmail: 'head@example.test' })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();

    expect(fetchAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
    expect(await screen.findByText('head@example.test')).toBeInTheDocument();
  });

  it('shows the company filter only for SUPER_ADMIN users', async () => {
    fetchAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const { container, unmount } = renderPage();
    await screen.findByText('0 entries');
    expect(container.querySelector('#audit-company-filter')).toBeNull();

    resetStores({ id: 's1', email: 'super@example.test', roles: ['SUPER_ADMIN'] });
    fetchAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    unmount();
    const second = render(
      <MemoryRouter initialEntries={['/audit-logs']}>
        <AuditLogsPage />
      </MemoryRouter>,
    );
    await screen.findByText('0 entries');
    const companyInput = second.container.querySelector('#audit-company-filter');
    expect(companyInput).not.toBeNull();
    await userEvent.setup().type(companyInput, 'c9');
    await userEvent.setup().keyboard('{Enter}');
    expect(fetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 'c9', page: 1 }));
  });
});

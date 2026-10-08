import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuditDashboardPage } from '../AuditDashboardPage.jsx';
import { useAuditDashboardStore } from '../../stores/useAuditDashboardStore.js';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { fetchAuditSummary } from '../../services/audit.service.js';

vi.mock('../../services/audit.service.js', () => ({
  fetchAuditLogs: vi.fn(),
  downloadAuditLogsCsv: vi.fn(),
  fetchAuditSummary: vi.fn(),
}));

function summaryFixture(overrides = {}) {
  return {
    total: 4,
    period: { from: '2026-02-01T00:00:00.000Z', to: '2026-03-03T00:00:00.000Z' },
    byOutcome: [
      { outcome: 'SUCCESS', count: 3 },
      { outcome: 'FAILURE', count: 1 },
    ],
    byAction: [
      { action: 'CREATED', count: 3 },
      { action: 'UPDATED', count: 1 },
    ],
    byResource: [
      { resource: 'USER', count: 3 },
      { resource: 'ORDER', count: 1 },
    ],
    topActors: [{ actorId: 'u1', actorRole: 'ADMIN', count: 4 }],
    byDay: [
      { date: '2026-03-01', count: 0 },
      { date: '2026-03-02', count: 4 },
    ],
    recent: {
      id: 'log-9',
      actorId: 'u1',
      actorRole: 'ADMIN',
      actorEmail: 'admin@example.test',
      companyId: 'c1',
      action: 'CREATED',
      resource: 'USER',
      resourceId: 'u2',
      outcome: 'SUCCESS',
      details: null,
      createdAt: '2026-03-02T10:00:00.000Z',
    },
    ...overrides,
  };
}

function resetStores(user = { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] }) {
  useAuditDashboardStore.setState({
    summary: null,
    filters: { action: '', resource: '', outcome: '', companyId: '', from: '', to: '' },
    status: 'idle',
    error: null,
  });
  useAuthStore.setState({ user, status: 'ready', accessToken: 'token', error: null });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/audit-dashboard']}>
      <AuditDashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStores();
});

describe('AuditDashboardPage', () => {
  it('loads the summary on mount and renders cards, chart, tables, and recent activity', async () => {
    fetchAuditSummary.mockResolvedValue(summaryFixture());
    renderPage();

    expect(fetchAuditSummary).toHaveBeenCalledTimes(1);
    expect(fetchAuditSummary).toHaveBeenCalledWith({});
    expect(await screen.findByText('4 events', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Activity over time')).toBeInTheDocument();
    // Chart buckets render verbatim (backend-supplied, no smoothing).
    expect(screen.getByRole('img', { name: /Audit events per day: total 4 events/ })).toBeInTheDocument();
    const actionTable = screen.getByRole('table', { name: 'Audit events by action' });
    expect(within(actionTable).getByText('CREATED')).toBeInTheDocument();
    const resourceTable = screen.getByRole('table', { name: 'Audit events by resource' });
    expect(within(resourceTable).getByText('USER')).toBeInTheDocument();
    const actorsTable = screen.getByRole('table', { name: 'Most active actors' });
    expect(within(actorsTable).getByText('ADMIN')).toBeInTheDocument();
    expect(screen.getByText('admin@example.test')).toBeInTheDocument();
  });

  it('maps filter controls to the exact supported query params', async () => {
    const user = userEvent.setup();
    fetchAuditSummary.mockResolvedValue(summaryFixture());
    const { container } = renderPage();
    await screen.findByText('4 events', { selector: 'p' });

    await user.selectOptions(container.querySelector('#audit-summary-action'), 'DELETED');
    expect(fetchAuditSummary).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'DELETED' }));

    await user.selectOptions(container.querySelector('#audit-summary-resource'), 'ORDER');
    expect(fetchAuditSummary).toHaveBeenLastCalledWith(expect.objectContaining({ resource: 'ORDER' }));

    await user.selectOptions(container.querySelector('#audit-summary-outcome'), 'FAILURE');
    expect(fetchAuditSummary).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'FAILURE' }));

    fireEvent.change(container.querySelector('#audit-summary-from'), { target: { value: '2026-01-01' } });
    expect(fetchAuditSummary).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-01-01' }));
  });

  it('sends only supported filter keys, never pagination or invented params', async () => {
    const user = userEvent.setup();
    fetchAuditSummary.mockResolvedValue(summaryFixture());
    const { container } = renderPage();
    await screen.findByText('4 events', { selector: 'p' });

    await user.selectOptions(container.querySelector('#audit-summary-action'), 'UPDATED');
    const [params] = fetchAuditSummary.mock.calls[fetchAuditSummary.mock.calls.length - 1];
    expect(Object.keys(params).sort()).toEqual(['action']);
  });

  it('clears all filters at once', async () => {
    const user = userEvent.setup();
    fetchAuditSummary.mockResolvedValue(summaryFixture());
    const { container } = renderPage();
    await screen.findByText('4 events', { selector: 'p' });

    await user.selectOptions(container.querySelector('#audit-summary-action'), 'DELETED');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(fetchAuditSummary).toHaveBeenLastCalledWith({});
  });

  it('shows the company filter only for SUPER_ADMIN users', async () => {
    fetchAuditSummary.mockResolvedValue(summaryFixture());
    const { container, unmount } = renderPage();
    await screen.findByText('4 events', { selector: 'p' });
    expect(container.querySelector('#audit-summary-company')).toBeNull();

    resetStores({ id: 's1', email: 'super@example.test', roles: ['SUPER_ADMIN'] });
    fetchAuditSummary.mockResolvedValue(summaryFixture());
    unmount();
    const second = render(
      <MemoryRouter initialEntries={['/audit-dashboard']}>
        <AuditDashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText('4 events', { selector: 'p' });
    const companyInput = second.container.querySelector('#audit-summary-company');
    expect(companyInput).not.toBeNull();
    await userEvent.setup().type(companyInput, 'c9');
    await userEvent.setup().keyboard('{Enter}');
    expect(fetchAuditSummary).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 'c9' }));
  });

  it('loads for HEAD and MEMBER with no page-level role assumption', async () => {
    for (const roles of [['HEAD'], ['MEMBER']]) {
      resetStores({ id: 'u1', email: 'staff@example.test', roles });
      fetchAuditSummary.mockResolvedValue(summaryFixture({ total: 1 }));
      const { unmount } = render(
        <MemoryRouter initialEntries={['/audit-dashboard']}>
          <AuditDashboardPage />
        </MemoryRouter>,
      );
      expect(await screen.findByText('1 event', { selector: 'p' })).toBeInTheDocument();
      expect(fetchAuditSummary).toHaveBeenCalled();
      unmount();
    }
  });

  it('shows loading, empty, and error states with retry', async () => {
    fetchAuditSummary.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByRole('status', { name: 'Loading audit analytics' })).toBeInTheDocument();

    useAuditDashboardStore.setState({ status: 'idle' });
    fetchAuditSummary.mockRejectedValueOnce({ message: 'Load failed.' });
    await useAuditDashboardStore.getState().refreshSummary();
    expect(await screen.findByText('Couldn’t load audit analytics')).toBeInTheDocument();
    fetchAuditSummary.mockResolvedValue(summaryFixture({ total: 0, byAction: [], byResource: [], topActors: [], byDay: [], recent: null }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No audit activity')).toBeInTheDocument();
  });

  it('shows a filtered-empty state distinct from the pristine empty state', async () => {
    fetchAuditSummary.mockResolvedValue(summaryFixture({ total: 0, byAction: [], byResource: [], topActors: [], byDay: [], recent: null }));
    const { container } = renderPage();
    await screen.findByText('Audit events will appear here as they happen.');

    await userEvent.setup().selectOptions(container.querySelector('#audit-summary-action'), 'DELETED');
    expect(await screen.findByText('Nothing matches the current filters. Adjust or clear them to see activity.')).toBeInTheDocument();
  });

  it('offers no audit mutation controls anywhere', async () => {
    fetchAuditSummary.mockResolvedValue(summaryFixture());
    renderPage();
    await screen.findByText('4 events', { selector: 'p' });

    expect(screen.queryByRole('button', { name: /delete|purge|clean|edit|save/i })).not.toBeInTheDocument();
  });
});



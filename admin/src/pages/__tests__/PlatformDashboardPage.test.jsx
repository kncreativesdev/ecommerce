import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PlatformDashboardPage } from '../PlatformDashboardPage.jsx';
import { fetchPlatformSummary } from '../../services/company.service.js';

vi.mock('../../services/company.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchPlatformSummary: vi.fn() };
});

function leanCompany(overrides = {}) {
  return {
    id: 'c1',
    name: 'Acme Store',
    status: 'ACTIVE',
    primaryDomain: 'acme.test',
    aggregates: { totalUsers: 7, totalProducts: 25, totalOrders: 40 },
    ...overrides,
  };
}

function summaryFixture() {
  return {
    totalCompanies: 2,
    activeCompanies: 1,
    suspendedCompanies: 1,
    totals: {
      totalUsers: 10,
      totalCustomers: 6,
      totalHeads: 2,
      totalMembers: 1,
      totalProducts: 25,
      totalOrders: 40,
    },
    companies: [
      leanCompany(),
      leanCompany({ id: 'c2', name: 'Beta Shop', status: 'SUSPENDED', primaryDomain: null,
        aggregates: { totalUsers: 3, totalProducts: 0, totalOrders: 0 } }),
    ],
  };
}

function manyCompaniesFixture(count) {
  return {
    ...summaryFixture(),
    totalCompanies: count,
    companies: Array.from({ length: count }, (_, index) =>
      leanCompany({ id: `c${index + 1}`, name: `Company ${index + 1}` }),
    ),
  };
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/platform']}>
      <Routes>
        <Route path="/platform" element={<PlatformDashboardPage />} />
        <Route path="/companies/:id" element={<div>Company detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlatformDashboardPage', () => {
  it('renders platform counts, totals, and per-company aggregates — never operational rows', async () => {
    fetchPlatformSummary.mockResolvedValue(summaryFixture());
    renderDashboard();

    expect(await screen.findByText('Platform Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Acme Store')).toBeInTheDocument();
    expect(screen.getByText('Beta Shop')).toBeInTheDocument();
    expect(screen.getByText('SUSPENDED')).toBeInTheDocument();
    expect(screen.getByText('acme.test')).toBeInTheDocument();
    expect(fetchPlatformSummary).toHaveBeenCalledTimes(1);
    // Aggregate metadata only — operational company records are never rendered.
    expect(screen.queryByText(/pending reviews/i)).not.toBeInTheDocument();
    const serialized = document.body.innerHTML;
    expect(serialized).not.toMatch(/password/i);
  });

  it('links each company to its Details page', async () => {
    const user = userEvent.setup();
    fetchPlatformSummary.mockResolvedValue(summaryFixture());
    renderDashboard();

    const links = await screen.findAllByText('Details');
    expect(links).toHaveLength(2);
    await user.click(links[0]);
    expect(await screen.findByText('Company detail')).toBeInTheDocument();
  });

  it('shows the empty state when no companies exist', async () => {
    fetchPlatformSummary.mockResolvedValue({
      totalCompanies: 0,
      activeCompanies: 0,
      suspendedCompanies: 0,
      totals: { totalUsers: 0, totalCustomers: 0, totalHeads: 0, totalMembers: 0, totalProducts: 0, totalOrders: 0 },
      companies: [],
    });
    renderDashboard();

    expect(await screen.findByText('No companies yet')).toBeInTheDocument();
  });

  it('shows an error with retry that refetches', async () => {
    const user = userEvent.setup();
    fetchPlatformSummary.mockRejectedValueOnce({ message: 'Load failed.' });
    renderDashboard();

    expect(await screen.findByText('Couldn’t load platform summary')).toBeInTheDocument();
    fetchPlatformSummary.mockResolvedValue(summaryFixture());
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Acme Store')).toBeInTheDocument();
    expect(fetchPlatformSummary).toHaveBeenCalledTimes(2);
  });

  it('paginates the company table so only one page renders at a time', async () => {
    const user = userEvent.setup();
    fetchPlatformSummary.mockResolvedValue(manyCompaniesFixture(45));
    renderDashboard();

    expect(await screen.findByText('Company 1')).toBeInTheDocument();
    expect(screen.getByText('Company 20')).toBeInTheDocument();
    // Page 2 rows stay out of the DOM until navigated to — one fetch total.
    expect(screen.queryByText('Company 21')).not.toBeInTheDocument();
    expect(fetchPlatformSummary).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(await screen.findByText('Company 21')).toBeInTheDocument();
    expect(screen.queryByText('Company 1')).not.toBeInTheDocument();
    // Client-side paging issues no further summary requests.
    expect(fetchPlatformSummary).toHaveBeenCalledTimes(1);
  });
});

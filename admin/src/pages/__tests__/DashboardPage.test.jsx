import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from '../DashboardPage.jsx';
import { fetchDashboardSummary } from '../../services/dashboard.service.js';
import { fetchCategories } from '../../services/category.service.js';
import { fetchProducts } from '../../services/product.service.js';
import { fetchCustomers } from '../../services/customer.service.js';
import { fetchReviewsAdmin } from '../../services/review.service.js';
import { fetchOrdersAdmin } from '../../services/order.service.js';

vi.mock('../../services/dashboard.service.js', () => ({ fetchDashboardSummary: vi.fn() }));
vi.mock('../../services/category.service.js', () => ({ fetchCategories: vi.fn() }));
vi.mock('../../services/product.service.js', () => ({ fetchProducts: vi.fn() }));
vi.mock('../../services/customer.service.js', () => ({
  fetchCustomers: vi.fn(),
  fetchCustomerById: vi.fn(),
  setCustomerActive: vi.fn(),
}));
vi.mock('../../services/review.service.js', () => ({
  fetchReviewsAdmin: vi.fn(),
  setReviewApproved: vi.fn(),
  deleteReviewAdmin: vi.fn(),
}));
vi.mock('../../services/order.service.js', () => ({
  fetchOrdersAdmin: vi.fn(),
  fetchOrderAdmin: vi.fn(),
  updateOrderStatus: vi.fn(),
  updatePaymentStatus: vi.fn(),
}));

function summaryFixture(overrides = {}) {
  return {
    range: 'today',
    periodStart: '2026-09-19T00:00:00.000Z',
    periodEnd: '2026-09-19T12:00:00.000Z',
    generatedAt: '2026-09-19T12:00:00.000Z',
    granularity: 'hour',
    orders: { total: 10, pending: 3, confirmed: 1, processing: 1, shipped: 1, delivered: 3, cancelled: 1 },
    revenue: { total: '9000.00' },
    period: { orders: 4, revenue: '4321.09' },
    buckets: [
      { bucketStart: '2026-09-19T10:00:00.000Z', orders: 1, revenue: '1000.00' },
      { bucketStart: '2026-09-19T11:00:00.000Z', orders: 2, revenue: '2321.09' },
      { bucketStart: '2026-09-19T12:00:00.000Z', orders: 1, revenue: '1000.00' },
    ],
    inventory: { tracked: 12, outOfStock: 2, uninitialized: 1 },
    ...overrides,
  };
}

function mockOps({ customersTotal = 7, pendingReviews = 2, recentOrders = [] } = {}) {
  fetchCategories.mockResolvedValue([{ id: 'c1', name: 'Audio', parentId: null }]);
  fetchProducts.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
  fetchCustomers.mockResolvedValue({
    customers: [],
    pagination: { page: 1, limit: 1, total: customersTotal, totalPages: customersTotal },
  });
  fetchReviewsAdmin.mockResolvedValue({
    reviews: [],
    pagination: { page: 1, limit: 1, total: pendingReviews, totalPages: Math.max(1, pendingReviews) },
  });
  fetchOrdersAdmin.mockResolvedValue({
    orders: recentOrders,
    pagination: { page: 1, limit: 5, total: recentOrders.length, totalPages: 1 },
  });
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DashboardPage analytics', () => {
  it('loads the today summary with revenue, counts, and real chart buckets', async () => {
    fetchDashboardSummary.mockResolvedValue(summaryFixture());
    mockOps();
    const { container } = renderDashboard();

    expect(fetchDashboardSummary).toHaveBeenCalledWith('today');
    // Recognized period revenue formatted as INR — never a raw sum.
    expect(await screen.findByText('₹4,321.09')).toBeInTheDocument();
    expect(screen.getByText('Pending · today')).toBeInTheDocument();
    expect(screen.getByText('Delivered · today')).toBeInTheDocument();
    // Charts render exactly the backend buckets (3 bars × 2 charts).
    expect(container.querySelectorAll('svg[role="img"]')).toHaveLength(2);
    expect(container.querySelectorAll('svg rect')).toHaveLength(6);
    // Accessible text summaries accompany the charts.
    expect(screen.getByText(/Revenue in this today/)).toBeInTheDocument();
  });

  it('switches ranges with the correct query param and keeps cards mounted', async () => {
    const user = userEvent.setup();
    fetchDashboardSummary.mockResolvedValue(summaryFixture());
    mockOps();
    renderDashboard();
    await screen.findByText('₹4,321.09');

    let resolveWeek;
    fetchDashboardSummary.mockImplementationOnce(
      () => new Promise((resolve) => { resolveWeek = resolve; }),
    );
    await user.click(screen.getByRole('button', { name: 'Week' }));

    expect(fetchDashboardSummary).toHaveBeenLastCalledWith('week');
    // Shell stays mounted: old values visible with a subtle indicator.
    expect(screen.getByText('₹4,321.09')).toBeInTheDocument();
    expect(screen.getByText('Updating…')).toBeInTheDocument();

    resolveWeek(summaryFixture({ range: 'week', granularity: 'day', period: { orders: 9, revenue: '8000.00' } }));
    expect(await screen.findByText('₹8,000.00')).toBeInTheDocument();
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
  });

  it('refresh keeps old values while loading and swaps in new server data', async () => {
    const user = userEvent.setup();
    fetchDashboardSummary.mockResolvedValue(summaryFixture());
    mockOps();
    renderDashboard();
    await screen.findByText('₹4,321.09');

    let resolveRefresh;
    fetchDashboardSummary.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRefresh = resolve; }),
    );
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    // One fresh request per source, old values still mounted.
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(2);
    expect(screen.getByText('₹4,321.09')).toBeInTheDocument();

    resolveRefresh(summaryFixture({ period: { orders: 5, revenue: '5000.00' } }));
    expect(await screen.findByText('₹5,000.00')).toBeInTheDocument();
  });

  it('never shows failure as zero — initial failure errors, background failure keeps values', async () => {
    const user = userEvent.setup();
    fetchDashboardSummary.mockRejectedValueOnce({ message: 'Analytics down.' });
    mockOps();
    renderDashboard();

    expect(await screen.findByText('Couldn’t load dashboard analytics')).toBeInTheDocument();
    expect(screen.queryByText('₹0.00')).not.toBeInTheDocument();

    fetchDashboardSummary.mockResolvedValue(summaryFixture());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('₹4,321.09')).toBeInTheDocument();

    fetchDashboardSummary.mockRejectedValueOnce({ message: 'Flaky backend.' });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    // Old values survive; the failure is an alert banner, not zeros.
    expect(await screen.findByText(/showing the last good values/)).toBeInTheDocument();
    expect(screen.getByText('₹4,321.09')).toBeInTheDocument();
    expect(screen.queryByText('₹0.00')).not.toBeInTheDocument();
  });

  it('refetches on remount so new orders appear (no frozen bootstrap)', async () => {
    fetchDashboardSummary.mockResolvedValue(summaryFixture());
    mockOps();
    const first = renderDashboard();
    expect(await screen.findByText('₹4,321.09')).toBeInTheDocument();
    first.unmount();

    fetchDashboardSummary.mockResolvedValue(summaryFixture({ period: { orders: 6, revenue: '6000.00' } }));
    renderDashboard();
    expect(await screen.findByText('₹6,000.00')).toBeInTheDocument();
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it('reads operational totals from server meta and links to valid routes', async () => {
    fetchDashboardSummary.mockResolvedValue(summaryFixture());
    mockOps({
      customersTotal: 57,
      pendingReviews: 4,
      recentOrders: [{ id: 'o1', orderNumber: 'ORD-2026-000007', grandTotal: '250.00', createdAt: '2026-09-19T10:00:00.000Z' }],
    });
    renderDashboard();

    // Meta totals with empty rows prove counts never come from page length.
    expect(await screen.findByText('57')).toBeInTheDocument();
    expect(fetchCustomers).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 1 }));
    // Every dashboard link targets a real admin route.
    expect(screen.getByRole('link', { name: /Out of stock/ }).getAttribute('href')).toBe('/inventory');
    expect(screen.getByRole('link', { name: /Pending reviews/ }).getAttribute('href')).toBe('/reviews');
    expect(screen.getByRole('link', { name: /Active products/ }).getAttribute('href')).toBe('/catalog/products');
    expect(screen.getByRole('link', { name: /Customers/ }).getAttribute('href')).toBe('/customers');
    expect(screen.getByRole('link', { name: /ORD-2026-000007/ }).getAttribute('href')).toBe('/orders/o1');
    const pendingLinks = screen.getAllByRole('link', { name: /Open orders/ });
    expect(pendingLinks.every((link) => link.getAttribute('href') === '/orders')).toBe(true);
  });
});

describe('DashboardPage ranges and authoritative metrics', () => {
  it('queries month and year ranges and renders their period metrics with captions', async () => {
    const user = userEvent.setup();
    fetchDashboardSummary.mockResolvedValue(summaryFixture());
    mockOps();
    renderDashboard();
    await screen.findByText('₹4,321.09');

    fetchDashboardSummary.mockResolvedValueOnce(
      summaryFixture({ range: 'month', granularity: 'day', period: { orders: 21, revenue: '15000.50' } }),
    );
    await user.click(screen.getByRole('button', { name: 'Month' }));
    expect(fetchDashboardSummary).toHaveBeenLastCalledWith('month');
    expect(await screen.findByText('₹15,000.50')).toBeInTheDocument();
    expect(screen.getAllByText(/Daily · calendar month/).length).toBeGreaterThanOrEqual(1);

    fetchDashboardSummary.mockResolvedValueOnce(
      summaryFixture({ range: 'year', granularity: 'month', period: { orders: 120, revenue: '99000.00' } }),
    );
    await user.click(screen.getByRole('button', { name: 'Year' }));
    expect(fetchDashboardSummary).toHaveBeenLastCalledWith('year');
    expect(await screen.findByText('₹99,000.00')).toBeInTheDocument();
    expect(screen.getAllByText(/Monthly · calendar year/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders authoritative order counts (total, pending, delivered) from backend fields', async () => {
    fetchDashboardSummary.mockResolvedValue(
      summaryFixture({
        orders: { total: 10, pending: 3, confirmed: 1, processing: 1, shipped: 1, delivered: 3, cancelled: 1 },
        revenue: { total: '9000.00' },
        period: { orders: 4, revenue: '4321.09' },
      }),
    );
    mockOps({ recentOrders: [{ id: 'o9', orderNumber: 'ORD-2026-000009', grandTotal: '100.00', createdAt: '2026-09-19T10:00:00.000Z' }] });
    renderDashboard();

    await screen.findByText('₹4,321.09');
    // All-time total comes from orders.total, not recent-orders page length (1 row).
    expect(screen.getByText(/10 total received/)).toBeInTheDocument();
    // All-time recognized revenue from revenue.total.
    expect(screen.getByText(/₹9,000.00 all-time recognized/)).toBeInTheDocument();
    // Pending + delivered hero cards carry the exact server counts.
    const pendingCard = screen.getByText('Pending · today').closest('div');
    expect(within(pendingCard).getByText('3')).toBeInTheDocument();
    const deliveredCard = screen.getByText('Delivered · today').closest('div');
    expect(within(deliveredCard).getByText('3')).toBeInTheDocument();
    // Selected-period metrics: period orders + period revenue.
    expect(screen.getByText(/4 received in this today/)).toBeInTheDocument();
  });

  it('renders genuine zero ranges as measured zeros (never an error, never hidden)', async () => {
    fetchDashboardSummary.mockResolvedValue(
      summaryFixture({
        period: { orders: 0, revenue: '0.00' },
        revenue: { total: '0.00' },
        buckets: [
          { bucketStart: '2026-09-19T10:00:00.000Z', orders: 0, revenue: '0.00' },
          { bucketStart: '2026-09-19T11:00:00.000Z', orders: 0, revenue: '0.00' },
        ],
      }),
    );
    mockOps();
    renderDashboard();

    expect(await screen.findAllByText('₹0.00')).not.toHaveLength(0);
    expect(screen.queryByText(/No recognized revenue in this period yet/)).not.toBeInTheDocument();
    // Charts still render the backend buckets (2 bars × 2 charts = 4 rects).
    expect(document.querySelectorAll('svg rect')).toHaveLength(4);
    expect(screen.queryByText('Couldn’t load dashboard analytics')).not.toBeInTheDocument();
  });

  it('does not duplicate requests when the active range is clicked again', async () => {
    const user = userEvent.setup();
    fetchDashboardSummary.mockResolvedValue(summaryFixture());
    mockOps();
    renderDashboard();
    await screen.findByText('₹4,321.09');
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(1);
  });

  it('performs no hard navigation on range change or refresh', async () => {
    const user = userEvent.setup();
    fetchDashboardSummary.mockResolvedValue(summaryFixture());
    mockOps();
    renderDashboard();
    await screen.findByText('₹4,321.09');
    const hrefBefore = window.location.href;

    fetchDashboardSummary.mockResolvedValueOnce(summaryFixture({ range: 'week', granularity: 'day' }));
    await user.click(screen.getByRole('button', { name: 'Week' }));
    expect((await screen.findAllByText(/Daily · Monday–Sunday/)).length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('₹4,321.09');
    expect(window.location.href).toBe(hrefBefore);
  });

  it('renders chart buckets in backend order with backend values', async () => {
    fetchDashboardSummary.mockResolvedValue(summaryFixture());
    mockOps();
    renderDashboard();
    await screen.findByText('₹4,321.09');

    // Screen-reader tables expose every bucket value in order — proves the
    // charts render actual backend buckets, not recomputed totals.
    const tables = document.querySelectorAll('table.sr-only');
    expect(tables).toHaveLength(2);
    const revenueRows = within(tables[0]).getAllByRole('row');
    expect(revenueRows).toHaveLength(3);
    expect(revenueRows[0]).toHaveTextContent('₹1,000.00');
    expect(revenueRows[1]).toHaveTextContent('₹2,321.09');
    const orderRows = within(tables[1]).getAllByRole('row');
    expect(orderRows[0]).toHaveTextContent('1');
    expect(orderRows[1]).toHaveTextContent('2');
  });
});

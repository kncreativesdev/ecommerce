import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CouponsPage } from '../CouponsPage.jsx';
import { CouponNewPage } from '../CouponNewPage.jsx';
import { useCouponStore, COUPON_PAGE_SIZE } from '../../stores/useCouponStore.js';
import { deactivateCoupon, deleteCoupon, fetchCoupons, fetchCouponHistory } from '../../services/coupon.service.js';

vi.mock('../../services/coupon.service.js', () => ({
  fetchCoupons: vi.fn(),
  fetchCouponById: vi.fn(),
  fetchCouponHistory: vi.fn(),
  createCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  activateCoupon: vi.fn(),
  deactivateCoupon: vi.fn(),
  deleteCoupon: vi.fn(),
}));

vi.mock('../../services/product.service.js', () => ({
  fetchProducts: vi.fn().mockResolvedValue([]),
}));

function couponFixture(overrides = {}) {
  return {
    id: 'coupon-1',
    code: 'SAVE10',
    description: null,
    discountType: 'PERCENTAGE',
    discountValue: '10.00',
    minimumOrderAmount: null,
    maximumDiscountAmount: null,
    usageLimit: 100,
    usedCount: 14,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    products: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function resetStore() {
  useCouponStore.setState({
    coupons: [],
    pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 0, totalPages: 1 },
    scope: 'all',
    search: '',
    status: 'idle',
    refreshing: false,
    error: null,
  });
}

function renderCoupons(initialEntries = ['/catalog/coupons']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/catalog/coupons" element={<CouponsPage />} />
        <Route path="/catalog/coupons/new" element={<CouponNewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('CouponsPage initial load', () => {
  it('shows the loading state, calls the default query, then renders rows', async () => {
    const gate = deferred();
    fetchCoupons.mockReturnValue(gate.promise);
    renderCoupons();

    expect(screen.getByRole('status', { name: 'Loading coupons' })).toBeInTheDocument();
    expect(fetchCoupons).toHaveBeenCalledWith({ page: 1, limit: COUPON_PAGE_SIZE, status: 'all', search: undefined });

    gate.resolve({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading coupons' })).not.toBeInTheDocument();
  });
});

describe('CouponsPage filters keep the list visible (Bug 1 regression)', () => {
  it('Active re-queries without replacing the page with the initial skeleton', async () => {
    const user = userEvent.setup();
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    renderCoupons();
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();

    const gate = deferred();
    fetchCoupons.mockReturnValue(gate.promise);
    await user.click(screen.getByRole('button', { name: 'Active' }));

    expect(fetchCoupons).toHaveBeenCalledWith({ page: 1, limit: COUPON_PAGE_SIZE, status: 'active', search: undefined });
    // Existing rows stay mounted; the initial-load skeleton never returns.
    expect(screen.getByText('SAVE10')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading coupons' })).not.toBeInTheDocument();
    expect(screen.getByText(/Refreshing/)).toBeInTheDocument();

    gate.resolve({
      coupons: [couponFixture({ id: 'coupon-2', code: 'ACTIVE5' })],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    expect(await screen.findByText('ACTIVE5')).toBeInTheDocument();
    expect(screen.queryByText('SAVE10')).not.toBeInTheDocument();
  });

  it('Inactive sends the inactive scope', async () => {
    const user = userEvent.setup();
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    renderCoupons();
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Inactive' }));

    expect(fetchCoupons).toHaveBeenCalledWith({ page: 1, limit: COUPON_PAGE_SIZE, status: 'inactive', search: undefined });
    expect(screen.getByText('SAVE10')).toBeInTheDocument();
  });

  it('All returns to the all scope query', async () => {
    const user = userEvent.setup();
    useCouponStore.setState({ scope: 'active', status: 'success', coupons: [couponFixture()] });
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    renderCoupons();
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));

    expect(fetchCoupons).toHaveBeenCalledWith({ page: 1, limit: COUPON_PAGE_SIZE, status: 'all', search: undefined });
    expect(screen.getByText('SAVE10')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading coupons' })).not.toBeInTheDocument();
  });

  it('clearing search refreshes without a full-page blink', async () => {
    const user = userEvent.setup();
    useCouponStore.setState({ search: 'save', status: 'success', coupons: [couponFixture()] });
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    renderCoupons();
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(fetchCoupons).toHaveBeenCalledWith({ page: 1, limit: COUPON_PAGE_SIZE, status: 'all', search: undefined });
    expect(screen.getByText('SAVE10')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading coupons' })).not.toBeInTheDocument();
  });

  it('pagination swaps pages while the current rows stay mounted', async () => {
    const user = userEvent.setup();
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 40, totalPages: 2 },
    });
    renderCoupons();
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();

    const gate = deferred();
    fetchCoupons.mockReturnValue(gate.promise);
    await user.click(screen.getByRole('button', { name: 'Go to page 2' }));

    expect(fetchCoupons).toHaveBeenCalledWith({ page: 2, limit: COUPON_PAGE_SIZE, status: 'all', search: undefined });
    expect(screen.getByText('SAVE10')).toBeInTheDocument();

    gate.resolve({
      coupons: [couponFixture({ id: 'coupon-3', code: 'PAGE2' })],
      pagination: { page: 2, limit: COUPON_PAGE_SIZE, total: 40, totalPages: 2 },
    });
    expect(await screen.findByText('PAGE2')).toBeInTheDocument();
  });
});

describe('CouponsPage count and pagination (count regression)', () => {
  it('shows the server total and page controls from meta — never a stale 0', async () => {
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 42, totalPages: 3 },
    });
    renderCoupons();
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();

    // Total comes from server meta (12 rows on this page would still say
    // "42 coupons"); pagination renders because totalPages > 1.
    expect(screen.getByText('42 coupons')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to page 2' })).toBeInTheDocument();
    expect(screen.getByText('Showing 1–20 of 42 coupons')).toBeInTheDocument();
  });
});

describe('CouponsPage create navigation (Bug 2 regression)', () => {
  it('Add Coupon navigates to the create page which renders the form', async () => {
    const user = userEvent.setup();
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    renderCoupons();
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Add Coupon' }));

    expect(await screen.findByRole('heading', { name: 'New Coupon' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. FESTIVE10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create coupon' })).toBeInTheDocument();
  });
});

describe('CouponsPage refresh failure', () => {
  it('keeps previous rows with an inline retry instead of a full error page', async () => {
    const user = userEvent.setup();
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    renderCoupons();
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();

    fetchCoupons.mockRejectedValueOnce({ message: 'List refresh failed.' });
    await user.click(screen.getByRole('button', { name: 'Inactive' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('List refresh failed.');
    expect(screen.getByText('SAVE10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('SAVE10')).toBeInTheDocument();
  });
});

describe('CouponsPage row history action', () => {
  const historyEntry = {
    id: 'history-1',
    couponId: 'coupon-1',
    action: 'CREATED',
    actor: { id: 'admin-1', email: 'admin@example.test' },
    metadata: { snapshot: { code: 'SAVE10' } },
    createdAt: '2026-09-01T10:00:00.000Z',
  };

  function renderTwoRows() {
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture(), couponFixture({ id: 'coupon-2', code: 'ACTIVE5', isActive: false })],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 2, totalPages: 1 },
    });
    fetchCouponHistory.mockResolvedValue({
      history: [historyEntry],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    renderCoupons();
  }

  it('shows a History action for every coupon row', async () => {
    const user = userEvent.setup();
    renderTwoRows();
    expect(await screen.findByText('SAVE10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View coupon history for SAVE10' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View coupon history for ACTIVE5' })).toBeInTheDocument();
    expect(fetchCouponHistory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'View coupon history for SAVE10' }));
  });

  it('opens the correct coupon history without touching other actions', async () => {
    const user = userEvent.setup();
    renderTwoRows();
    await screen.findByText('SAVE10');

    await user.click(screen.getByRole('button', { name: 'View coupon history for ACTIVE5' }));

    const dialog = await screen.findByRole('dialog', { name: 'Coupon history — ACTIVE5' });
    expect(fetchCouponHistory).toHaveBeenCalledWith('coupon-2', { page: 1, limit: 10 });
    expect(await within(dialog).findByText('Created')).toBeInTheDocument();
    expect(within(dialog).getByText('admin@example.test')).toBeInTheDocument();
    expect(deactivateCoupon).not.toHaveBeenCalled();
    expect(deleteCoupon).not.toHaveBeenCalled();
  });

  it('closes back to the list and refetches on reopen', async () => {
    const user = userEvent.setup();
    renderTwoRows();
    await screen.findByText('SAVE10');

    await user.click(screen.getByRole('button', { name: 'View coupon history for SAVE10' }));
    await screen.findByRole('dialog', { name: 'Coupon history — SAVE10' });
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('SAVE10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View coupon history for SAVE10' }));
    await screen.findByRole('dialog', { name: 'Coupon history — SAVE10' });
    expect(fetchCouponHistory).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('resets to the newly selected coupon without cross-contamination', async () => {
    const user = userEvent.setup();
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture(), couponFixture({ id: 'coupon-2', code: 'ACTIVE5', isActive: false })],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 2, totalPages: 1 },
    });
    const codes = { 'coupon-1': 'SAVE10', 'coupon-2': 'ACTIVE5' };
    fetchCouponHistory.mockImplementation(async (id) => ({
      history: [{
        ...historyEntry,
        id: `history-${id}`,
        couponId: id,
        metadata: { snapshot: { code: codes[id] } },
      }],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    }));
    renderCoupons();
    await screen.findByText('SAVE10');

    await user.click(screen.getByRole('button', { name: 'View coupon history for SAVE10' }));
    await screen.findByRole('dialog', { name: 'Coupon history — SAVE10' });
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));

    await user.click(screen.getByRole('button', { name: 'View coupon history for ACTIVE5' }));
    const dialog = await screen.findByRole('dialog', { name: 'Coupon history — ACTIVE5' });
    expect(fetchCouponHistory).toHaveBeenLastCalledWith('coupon-2', { page: 1, limit: 10 });
    expect(within(dialog).getByText('ACTIVE5')).toBeInTheDocument();
    expect(within(dialog).queryByText('SAVE10')).not.toBeInTheDocument();
  });

  it('shows loading then error states inside the dialog', async () => {
    const user = userEvent.setup();
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    fetchCouponHistory.mockRejectedValueOnce(new Error('History unavailable'));
    fetchCouponHistory.mockResolvedValueOnce({
      history: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
    });
    renderCoupons();
    await screen.findByText('SAVE10');

    await user.click(screen.getByRole('button', { name: 'View coupon history for SAVE10' }));
    expect(await screen.findByText('Couldn’t load coupon history')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No history yet')).toBeInTheDocument();
  });
});

describe('CouponsPage header refresh', () => {
  it('offers a single top-right Refresh button that re-fetches the list', async () => {
    const user = userEvent.setup();
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    renderCoupons();
    await screen.findByText('SAVE10');

    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Refresh list' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(fetchCoupons).toHaveBeenCalledTimes(2);
    expect(fetchCoupons).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'all' }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCouponStore, COUPON_PAGE_SIZE } from '../useCouponStore.js';
import {
  activateCoupon,
  createCoupon,
  deactivateCoupon,
  deleteCoupon,
  fetchCoupons,
  updateCoupon,
} from '../../services/coupon.service.js';

vi.mock('../../services/coupon.service.js', () => ({
  fetchCoupons: vi.fn(),
  fetchCouponById: vi.fn(),
  createCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  activateCoupon: vi.fn(),
  deactivateCoupon: vi.fn(),
  deleteCoupon: vi.fn(),
}));

const basePagination = { page: 1, limit: COUPON_PAGE_SIZE, total: 0, totalPages: 1 };

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
    pagination: { ...basePagination },
    scope: 'all',
    search: '',
    status: 'idle',
    refreshing: false,
    error: null,
  });
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

describe('useCouponStore initial load', () => {
  it('fetches the first page with backend defaults and stores rows + meta', async () => {
    const rows = [couponFixture()];
    fetchCoupons.mockResolvedValue({
      coupons: rows,
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });

    await useCouponStore.getState().refreshCoupons();

    expect(fetchCoupons).toHaveBeenCalledWith({ page: 1, limit: COUPON_PAGE_SIZE, status: 'all', search: undefined });
    const state = useCouponStore.getState();
    expect(state.status).toBe('success');
    expect(state.refreshing).toBe(false);
    expect(state.coupons).toEqual(rows);
    expect(state.pagination.total).toBe(1);
  });

  it('reports initial failure with no rows', async () => {
    fetchCoupons.mockRejectedValue({ message: 'Network error.' });

    await useCouponStore.getState().refreshCoupons();

    const state = useCouponStore.getState();
    expect(state.status).toBe('error');
    expect(state.coupons).toEqual([]);
    expect(state.error.message).toBe('Network error.');
  });
});

describe('useCouponStore background refresh (Bug 1 regression)', () => {
  it('keeps existing rows and flags refreshing — never global loading — on scope change', async () => {
    const before = [couponFixture()];
    const after = [couponFixture({ id: 'coupon-2', code: 'FLAT50' })];
    useCouponStore.setState({
      coupons: before,
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
      scope: 'all',
      search: '',
      status: 'success',
      refreshing: false,
      error: null,
    });
    const gate = deferred();
    fetchCoupons.mockReturnValue(gate.promise);

    const pending = useCouponStore.getState().refreshCoupons({ scope: 'active' });

    // While the request is in flight the authoritative rows stay put and
    // the page must NOT see the initial-load state.
    let state = useCouponStore.getState();
    expect(state.refreshing).toBe(true);
    expect(state.status).toBe('success');
    expect(state.status).not.toBe('loading');
    expect(state.coupons).toEqual(before);
    expect(fetchCoupons).toHaveBeenCalledWith({ page: 1, limit: COUPON_PAGE_SIZE, status: 'active', search: undefined });

    gate.resolve({ coupons: after, pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 } });
    await pending;

    state = useCouponStore.getState();
    expect(state.refreshing).toBe(false);
    expect(state.coupons).toEqual(after);
  });

  it('preserves rows and records the error when a background refresh fails', async () => {
    const before = [couponFixture()];
    useCouponStore.setState({
      coupons: before,
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
      scope: 'all',
      search: '',
      status: 'success',
      refreshing: false,
      error: null,
    });
    fetchCoupons.mockRejectedValue({ message: 'Server exploded.' });

    await useCouponStore.getState().refreshCoupons({ search: 'save' });

    const state = useCouponStore.getState();
    expect(state.refreshing).toBe(false);
    expect(state.coupons).toEqual(before);
    expect(state.status).toBe('success');
    expect(state.error.message).toBe('Server exploded.');
  });

  it('restarts at page 1 on scope/search edits but keeps the page on moves', async () => {
    useCouponStore.setState({
      coupons: [couponFixture()],
      pagination: { page: 3, limit: COUPON_PAGE_SIZE, total: 60, totalPages: 3 },
      scope: 'all',
      search: 'save',
      status: 'success',
      refreshing: false,
      error: null,
    });
    fetchCoupons.mockResolvedValue({ coupons: [], pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 0, totalPages: 1 } });

    await useCouponStore.getState().setPage(2);
    expect(fetchCoupons).toHaveBeenLastCalledWith({ page: 2, limit: COUPON_PAGE_SIZE, status: 'all', search: 'save' });

    await useCouponStore.getState().setScope('active');
    expect(fetchCoupons).toHaveBeenLastCalledWith({ page: 1, limit: COUPON_PAGE_SIZE, status: 'active', search: 'save' });
  });
});

describe('useCouponStore mutations', () => {
  it('deactivating drops the row only under the active scope', async () => {
    const active = couponFixture();
    const released = { ...active, isActive: false };
    deactivateCoupon.mockResolvedValue(released);
    // Scope-drop triggers an authoritative refresh for truthful totals.
    fetchCoupons.mockResolvedValue({
      coupons: [],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 0, totalPages: 1 },
    });

    useCouponStore.setState({ coupons: [active], scope: 'active', status: 'success' });
    await useCouponStore.getState().deactivateCoupon(active.id);
    expect(useCouponStore.getState().coupons).toEqual([]);
    expect(fetchCoupons).toHaveBeenCalled();

    useCouponStore.setState({ coupons: [active], scope: 'all', status: 'success' });
    await useCouponStore.getState().deactivateCoupon(active.id);
    expect(useCouponStore.getState().coupons).toEqual([released]);
  });

  it('activating upserts the server record', async () => {
    const inactive = couponFixture({ isActive: false });
    const released = { ...inactive, isActive: true };
    activateCoupon.mockResolvedValue(released);

    useCouponStore.setState({ coupons: [inactive], scope: 'all', status: 'success' });
    await useCouponStore.getState().activateCoupon(inactive.id);
    expect(useCouponStore.getState().coupons).toEqual([released]);
  });

  it('creating appends the server record without fabricating state', async () => {
    const existing = couponFixture();
    const created = couponFixture({ id: 'coupon-9', code: 'NEW5' });
    createCoupon.mockResolvedValue(created);

    useCouponStore.setState({ coupons: [existing], scope: 'all', status: 'success' });
    const record = await useCouponStore.getState().createCoupon({ code: 'NEW5' });
    expect(record).toEqual(created);
    expect(useCouponStore.getState().coupons).toEqual([existing, created]);
  });

  it('updating reconciles the row in place', async () => {
    const before = couponFixture();
    const released = { ...before, description: 'Edited' };
    updateCoupon.mockResolvedValue(released);

    useCouponStore.setState({ coupons: [before], scope: 'all', status: 'success' });
    await useCouponStore.getState().updateCoupon(before.id, { description: 'Edited' });
    expect(useCouponStore.getState().coupons).toEqual([released]);
  });

  it('deleting drops the row after server confirmation', async () => {
    const row = couponFixture();
    deleteCoupon.mockResolvedValue({ id: row.id });
    fetchCoupons.mockResolvedValue({
      coupons: [],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 0, totalPages: 1 },
    });

    useCouponStore.setState({ coupons: [row], scope: 'all', status: 'success' });
    await useCouponStore.getState().deleteCoupon(row.id);
    // Instant local removal, then an authoritative refresh for truthful
    // totals (background — rows stay mounted, no full skeleton).
    expect(fetchCoupons).toHaveBeenCalled();
    expect(useCouponStore.getState().pagination.total).toBe(0);
  });

  it('stores server totals from meta instead of deriving counts locally', async () => {
    fetchCoupons.mockResolvedValue({
      coupons: [couponFixture()],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 42, totalPages: 3 },
    });

    await useCouponStore.getState().refreshCoupons();

    const state = useCouponStore.getState();
    expect(state.pagination.total).toBe(42);
    expect(state.pagination.totalPages).toBe(3);
  });

  it('falls back to page 1 when the current page drifts past the last page', async () => {
    useCouponStore.setState({
      coupons: [couponFixture()],
      pagination: { page: 3, limit: COUPON_PAGE_SIZE, total: 41, totalPages: 3 },
      scope: 'all',
      search: '',
      status: 'success',
      refreshing: false,
      error: null,
    });
    fetchCoupons
      .mockResolvedValueOnce({ coupons: [], pagination: { page: 3, limit: COUPON_PAGE_SIZE, total: 40, totalPages: 2 } })
      .mockResolvedValueOnce({
        coupons: [couponFixture()],
        pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 40, totalPages: 2 },
      });

    await useCouponStore.getState().refreshCoupons({ page: 3 });

    // Current rows stay mounted during the correction; the store lands on
    // page 1 with rows instead of a false empty state.
    expect(fetchCoupons).toHaveBeenLastCalledWith({ page: 1, limit: COUPON_PAGE_SIZE, status: 'all', search: undefined });
    const state = useCouponStore.getState();
    expect(state.pagination.page).toBe(1);
    expect(state.coupons).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CouponsPage } from '../CouponsPage.jsx';
import { CouponNewPage } from '../CouponNewPage.jsx';
import { useCouponStore, COUPON_PAGE_SIZE } from '../../stores/useCouponStore.js';
import { createCoupon, fetchCoupons } from '../../services/coupon.service.js';

vi.mock('../../services/coupon.service.js', () => ({
  fetchCoupons: vi.fn(),
  fetchCouponById: vi.fn(),
  createCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  activateCoupon: vi.fn(),
  deactivateCoupon: vi.fn(),
  deleteCoupon: vi.fn(),
}));

vi.mock('../../services/product.service.js', () => ({
  fetchProducts: vi.fn().mockResolvedValue([]),
}));

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

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/catalog/coupons/new']}>
      <Routes>
        <Route path="/catalog/coupons" element={<CouponsPage />} />
        <Route path="/catalog/coupons/new" element={<CouponNewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('CouponNewPage create flow', () => {
  it('posts the form body and lands on the list showing the created coupon', async () => {
    const user = userEvent.setup();
    const created = {
      id: 'coupon-9',
      code: 'NEW10',
      description: null,
      discountType: 'PERCENTAGE',
      discountValue: '10.00',
      minimumOrderAmount: null,
      maximumDiscountAmount: null,
      usageLimit: null,
      usedCount: 0,
      startsAt: null,
      expiresAt: null,
      isActive: true,
      products: [],
      createdAt: '2026-09-19T00:00:00.000Z',
      updatedAt: '2026-09-19T00:00:00.000Z',
    };
    createCoupon.mockResolvedValue(created);
    fetchCoupons.mockResolvedValue({
      coupons: [created],
      pagination: { page: 1, limit: COUPON_PAGE_SIZE, total: 1, totalPages: 1 },
    });
    renderNew();
    expect(await screen.findByRole('heading', { name: 'New Coupon' })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('e.g. FESTIVE10'), 'NEW10');
    await user.type(screen.getByPlaceholderText('e.g. 10 or 200.00'), '10');
    await user.click(screen.getByRole('button', { name: 'Create coupon' }));

    expect(createCoupon).toHaveBeenCalledWith({
      code: 'NEW10',
      description: null,
      discountType: 'PERCENTAGE',
      discountValue: '10',
      minimumOrderAmount: null,
      maximumDiscountAmount: null,
      usageLimit: null,
      startsAt: null,
      expiresAt: null,
      isActive: true,
      productIds: [],
    });
    // Post-create navigation + authoritative list refresh show the record.
    expect(await screen.findByRole('heading', { name: 'Coupons' })).toBeInTheDocument();
    expect(await screen.findByText('NEW10')).toBeInTheDocument();
  });

  it('surfaces a duplicate-code failure without navigating away', async () => {
    const user = userEvent.setup();
    createCoupon.mockRejectedValue({ code: 'COUPON_CODE_EXISTS', message: 'A coupon with this code already exists', details: [] });
    renderNew();
    expect(await screen.findByRole('heading', { name: 'New Coupon' })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('e.g. FESTIVE10'), 'TAKEN');
    await user.type(screen.getByPlaceholderText('e.g. 10 or 200.00'), '10');
    await user.click(screen.getByRole('button', { name: 'Create coupon' }));

    expect(await screen.findByText('This code is already taken.')).toBeInTheDocument();
    // No false success: still on the create page, no list navigation.
    expect(screen.getByRole('heading', { name: 'New Coupon' })).toBeInTheDocument();
    expect(createCoupon).toHaveBeenCalledTimes(1);
  });
});

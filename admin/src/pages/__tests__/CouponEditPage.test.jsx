import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CouponEditPage } from '../CouponEditPage.jsx';
import { useAuthStore } from '../../stores/useAuthStore.js';
import { fetchCouponById, fetchCouponHistory } from '../../services/coupon.service.js';
import { fetchProducts } from '../../services/product.service.js';

vi.mock('../../services/coupon.service.js', () => ({
  fetchCouponById: vi.fn(),
  fetchCouponHistory: vi.fn(),
  updateCoupon: vi.fn(),
}));

vi.mock('../../services/product.service.js', () => ({
  fetchProducts: vi.fn().mockResolvedValue([]),
}));

const COUPON = {
  id: 'coupon-1',
  code: 'SAVE10',
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
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function renderEditPage() {
  return render(
    <MemoryRouter initialEntries={['/catalog/coupons/coupon-1/edit']}>
      <Routes>
        <Route path="/catalog/coupons/:id/edit" element={<CouponEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchCouponById.mockResolvedValue(COUPON);
  fetchCouponHistory.mockResolvedValue({
    history: [
      {
        id: 'history-1',
        couponId: 'coupon-1',
        action: 'CREATED',
        actor: { id: 'admin-1', email: 'admin@example.test' },
        metadata: { snapshot: { code: 'SAVE10' } },
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    ],
    pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
  });
});

describe('CouponEditPage coupon history action', () => {
  it('hides history by default and exposes a history action', async () => {
    renderEditPage();

    // Existing edit behavior intact: form with save action.
    expect(await screen.findByRole('button', { name: 'Save coupon' })).toBeInTheDocument();
    // No history request while closed; entries never render by default.
    expect(screen.getByRole('button', { name: 'View coupon history for SAVE10' })).toBeInTheDocument();
    expect(screen.queryByText('Created')).not.toBeInTheDocument();
    expect(fetchCouponHistory).not.toHaveBeenCalled();
  });

  it('opens history in a dialog with the coupon entries', async () => {
    const user = userEvent.setup();
    renderEditPage();
    await screen.findByRole('button', { name: 'Save coupon' });

    await user.click(screen.getByRole('button', { name: 'View coupon history for SAVE10' }));

    const dialog = await screen.findByRole('dialog', { name: 'Coupon history — SAVE10' });
    expect(fetchCouponHistory).toHaveBeenCalledWith('coupon-1', { page: 1, limit: 10 });
    expect(await within(dialog).findByText('Created')).toBeInTheDocument();
    expect(within(dialog).getByText('admin@example.test')).toBeInTheDocument();
    expect(within(dialog).getByText('SAVE10')).toBeInTheDocument();
  });

  it('closes the dialog back to the form without losing unsaved input', async () => {
    const user = userEvent.setup();
    const { container } = renderEditPage();
    await screen.findByRole('button', { name: 'Save coupon' });

    // Unsaved form input entered before opening history.
    const description = container.querySelector('textarea[name="description"]');
    await user.type(description, 'Draft note');

    await user.click(screen.getByRole('button', { name: 'View coupon history for SAVE10' }));
    await screen.findByRole('dialog', { name: 'Coupon history — SAVE10' });
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save coupon' })).toBeInTheDocument();
    expect(container.querySelector('textarea[name="description"]')).toHaveValue('Draft note');
  });

  it('refetches fresh history on reopen without duplicate dialogs', async () => {
    const user = userEvent.setup();
    renderEditPage();
    await screen.findByRole('button', { name: 'Save coupon' });

    await user.click(screen.getByRole('button', { name: 'View coupon history for SAVE10' }));
    await screen.findByRole('dialog', { name: 'Coupon history — SAVE10' });
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View coupon history for SAVE10' }));
    await screen.findByRole('dialog', { name: 'Coupon history — SAVE10' });
    expect(fetchCouponHistory).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('omits the history action when the coupon cannot be loaded', async () => {
    fetchCouponById.mockResolvedValue(null);
    renderEditPage();

    expect(await screen.findByText('Coupon not found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /coupon history/i })).not.toBeInTheDocument();
    expect(fetchCouponHistory).not.toHaveBeenCalled();
  });
});

describe('CouponEditPage product eligibility scope', () => {
  it("loads all products for ADMIN", async () => {
    useAuthStore.setState({ user: { id: 'a1', email: 'admin@example.test', roles: ['ADMIN'] } });
    renderEditPage();
    await screen.findByText('SAVE10');
    expect(fetchProducts).toHaveBeenCalledWith('all');
  });

  it("loads active products for HEAD (inactive rows stay out of reach)", async () => {
    useAuthStore.setState({ user: { id: 'h1', email: 'head@example.test', roles: ['HEAD'] } });
    renderEditPage();
    await screen.findByText('SAVE10');
    expect(fetchProducts).toHaveBeenCalledWith('active');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CouponHistory } from '../CouponHistory.jsx';
import { fetchCouponHistory } from '../../../services/coupon.service.js';

vi.mock('../../../services/coupon.service.js', () => ({
  fetchCouponHistory: vi.fn(),
}));

function entryFixture(overrides = {}) {
  return {
    id: 'history-1',
    couponId: 'coupon-1',
    action: 'CREATED',
    actor: { id: 'admin-1', email: 'admin@example.test' },
    metadata: { snapshot: { code: 'SAVE10', discountType: 'PERCENTAGE', discountValue: '10.00', isActive: true } },
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function renderHistory() {
  return render(
    <MemoryRouter>
      <CouponHistory couponId="coupon-1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CouponHistory', () => {
  it('shows a loading state while fetching', async () => {
    fetchCouponHistory.mockImplementation(() => new Promise(() => {}));
    renderHistory();
    expect(await screen.findByRole('status', { name: 'Loading coupon history' })).toBeInTheDocument();
  });

  it('renders created events with actor, timestamp, and snapshot', async () => {
    fetchCouponHistory.mockResolvedValue({
      history: [entryFixture()],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    renderHistory();

    expect(await screen.findByText('Created')).toBeInTheDocument();
    expect(screen.getByText('admin@example.test')).toBeInTheDocument();
    expect(screen.getByText('SAVE10')).toBeInTheDocument();
    expect(fetchCouponHistory).toHaveBeenCalledWith('coupon-1', { page: 1, limit: 10 });
  });

  it('renders updated events with before → after changes', async () => {
    fetchCouponHistory.mockResolvedValue({
      history: [
        entryFixture({
          id: 'history-2',
          action: 'UPDATED',
          metadata: { changes: { discountValue: { before: '10.00', after: '15.00' } } },
        }),
      ],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    renderHistory();

    expect(await screen.findByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('Discount value')).toBeInTheDocument();
    expect(screen.getByText('10.00', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('15.00', { exact: false })).toBeInTheDocument();
  });

  it('renders deactivated and reactivated events with active-state changes', async () => {
    fetchCouponHistory.mockResolvedValue({
      history: [
        entryFixture({ id: 'h2', action: 'REACTIVATED', metadata: { changes: { isActive: { before: false, after: true } } } }),
        entryFixture({ id: 'h1', action: 'DEACTIVATED', metadata: { changes: { isActive: { before: true, after: false } } } }),
      ],
      pagination: { page: 1, limit: 10, total: 2, totalPages: 1 },
    });
    renderHistory();

    expect(await screen.findByText('Deactivated')).toBeInTheDocument();
    expect(screen.getByText('Reactivated')).toBeInTheDocument();
    expect(screen.getAllByText(/Inactive/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Active/).length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to an unknown-admin label when the actor is gone', async () => {
    fetchCouponHistory.mockResolvedValue({
      history: [entryFixture({ actor: { id: 'admin-9', email: null } })],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    renderHistory();

    expect(await screen.findByText('Unknown admin')).toBeInTheDocument();
  });

  it('never renders customer usage rows as history', async () => {
    fetchCouponHistory.mockResolvedValue({
      history: [entryFixture()],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    const { container } = renderHistory();
    await screen.findByText('Created');

    expect(container.textContent).not.toMatch(/coupon_usage|used by customer/i);
    expect(screen.queryByText(/already used/i)).not.toBeInTheDocument();
  });

  it('shows an empty state when there is no history', async () => {
    fetchCouponHistory.mockResolvedValue({
      history: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
    });
    renderHistory();

    expect(await screen.findByText('No history yet')).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    const user = userEvent.setup();
    fetchCouponHistory.mockRejectedValueOnce(new Error('History unavailable'));
    fetchCouponHistory.mockResolvedValueOnce({
      history: [entryFixture()],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    renderHistory();

    expect(await screen.findByText('Couldn’t load coupon history')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Created')).toBeInTheDocument();
    expect(fetchCouponHistory).toHaveBeenCalledTimes(2);
  });

  it('pages through history without losing rows', async () => {
    const user = userEvent.setup();
    const page1 = [entryFixture({ id: 'h-new', action: 'UPDATED' })];
    const page2 = [entryFixture({ id: 'h-old', action: 'CREATED' })];
    fetchCouponHistory.mockImplementation(async (id, { page }) => ({
      history: page === 1 ? page1 : page2,
      pagination: { page, limit: 1, total: 2, totalPages: 2 },
    }));
    renderHistory();

    expect(await screen.findByText('Updated')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(await screen.findByText('Created')).toBeInTheDocument();
    expect(fetchCouponHistory).toHaveBeenCalledWith('coupon-1', { page: 2, limit: 10 });
  });

  it('keeps entries readable in a stacked layout', async () => {
    fetchCouponHistory.mockResolvedValue({
      history: [entryFixture()],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    const { container } = renderHistory();
    await screen.findByText('Created');

    // Stacked list (not a wide table): no horizontal-scroll table wrapper.
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('ul')).toBeInTheDocument();
  });
});

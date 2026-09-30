import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ReviewsPage } from '../ReviewsPage.jsx';
import { useReviewStore } from '../../stores/useReviewStore.js';
import { fetchReviewsAdmin } from '../../services/review.service.js';

vi.mock('../../services/review.service.js', () => ({
  fetchReviewsAdmin: vi.fn(),
}));

function reviewFixture(overrides = {}) {
  return {
    id: 'r1',
    productId: 'p1',
    orderItemId: 'oi1',
    rating: 5,
    title: 'Excellent gadget',
    comment: 'Works great every day.',
    isApproved: true,
    product: { id: 'p1', name: 'Test Gadget', slug: 'test-gadget' },
    customer: { id: 'c1', email: 'ada@example.test', firstName: 'Ada', lastName: 'Lovelace' },
    orderItem: { id: 'oi1', orderId: 'o1' },
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

function resetStore() {
  useReviewStore.setState({
    reviews: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: { search: '', isApproved: '', rating: '', sortOrder: 'desc' },
    status: 'idle',
    error: null,
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reviews']}>
      <Toaster />
      <ReviewsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('ReviewsPage (view-only)', () => {
  it('renders the review list with product, customer, rating, and status', async () => {
    fetchReviewsAdmin.mockResolvedValue({
      reviews: [reviewFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();

    expect(await screen.findByText('1 review')).toBeInTheDocument();
    // Badge assertions are scoped to the table: the status filter uses
    // the same words ("Pending"/"Approved") in its options.
    const table = screen.getByRole('table', { name: 'Customer reviews' });
    expect(within(table).getByText('Excellent gadget')).toBeInTheDocument();
    expect(within(table).getByText('Test Gadget')).toBeInTheDocument();
    expect(within(table).getByText('ada@example.test')).toBeInTheDocument();
    expect(within(table).getByText('Approved')).toBeInTheDocument();
    expect(within(table).getByText('5/5')).toBeInTheDocument();
  });

  it('offers no approve, reject, edit, or delete controls', async () => {
    fetchReviewsAdmin.mockResolvedValue({
      reviews: [reviewFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderPage();
    await screen.findByText('Excellent gadget');

    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete.*review/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    // No actions column at all on the view-only table.
    const headers = within(screen.getByRole('table', { name: 'Customer reviews' })).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).not.toContain('Actions');
  });

  it('exposes no review mutation API from the admin surface', async () => {
    // The real admin service module is read-only: listing only, with no
    // approve/reject/edit/delete helpers for the page to call.
    const actualService = await vi.importActual('../../services/review.service.js');
    expect(Object.keys(actualService).sort()).toEqual(['fetchReviewsAdmin']);
    expect(useReviewStore.getState().setApproved).toBeUndefined();
    expect(useReviewStore.getState().removeReview).toBeUndefined();
  });

  it('filters by moderation status through the server param', async () => {
    const user = userEvent.setup();
    fetchReviewsAdmin.mockResolvedValue({ reviews: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const { container } = renderPage();
    await screen.findByText('0 reviews');

    await user.selectOptions(container.querySelector('#review-status-filter'), 'false');
    expect(fetchReviewsAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ isApproved: 'false' }));

    await user.selectOptions(container.querySelector('#review-status-filter'), 'true');
    expect(fetchReviewsAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ isApproved: 'true' }));
  });

  it('filters by rating through the server param', async () => {
    const user = userEvent.setup();
    fetchReviewsAdmin.mockResolvedValue({ reviews: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const { container } = renderPage();
    await screen.findByText('0 reviews');

    await user.selectOptions(container.querySelector('#review-rating-filter'), '5');
    expect(fetchReviewsAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ rating: '5' }));
  });

  it('searches through the server on Enter', async () => {
    const user = userEvent.setup();
    fetchReviewsAdmin.mockResolvedValue({ reviews: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    renderPage();
    await screen.findByText('0 reviews');

    await user.type(screen.getByLabelText('Search reviews by text, product, or reviewer'), 'gadget');
    await user.keyboard('{Enter}');
    expect(fetchReviewsAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'gadget' }));
  });

  it('shows the error state with retry on server failure', async () => {
    fetchReviewsAdmin.mockRejectedValueOnce({ message: 'List failed.' });
    renderPage();

    expect(await screen.findByText('Couldn’t load reviews')).toBeInTheDocument();
    fetchReviewsAdmin.mockResolvedValue({ reviews: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(fetchReviewsAdmin).toHaveBeenCalledTimes(2);
  });
});

describe('ReviewsPage header refresh', () => {
  it('offers a single top-right Refresh button that re-fetches the list', async () => {
    const user = userEvent.setup();
    fetchReviewsAdmin.mockResolvedValue({ reviews: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    renderPage();
    await screen.findByText('0 reviews');

    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Refresh list' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(fetchReviewsAdmin).toHaveBeenCalledTimes(2);
  });
});

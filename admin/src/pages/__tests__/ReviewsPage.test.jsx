import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ReviewsPage } from '../ReviewsPage.jsx';
import { useReviewStore } from '../../stores/useReviewStore.js';
import { deleteReviewAdmin, fetchReviewsAdmin, setReviewApproved } from '../../services/review.service.js';

vi.mock('../../services/review.service.js', () => ({
  fetchReviewsAdmin: vi.fn(),
  setReviewApproved: vi.fn(),
  deleteReviewAdmin: vi.fn(),
}));

function reviewFixture(overrides = {}) {
  return {
    id: 'r1',
    productId: 'p1',
    orderItemId: 'oi1',
    rating: 5,
    title: 'Excellent gadget',
    comment: 'Works great every day.',
    isApproved: false,
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

describe('ReviewsPage', () => {
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
    expect(within(table).getByText('Pending')).toBeInTheDocument();
    expect(within(table).getByText('5/5')).toBeInTheDocument();
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

  it('approves a pending review and reconciles server state', async () => {
    const user = userEvent.setup();
    fetchReviewsAdmin.mockResolvedValue({
      reviews: [reviewFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    setReviewApproved.mockResolvedValue(reviewFixture({ isApproved: true }));
    const hrefBefore = window.location.href;
    renderPage();
    await screen.findByText('Excellent gadget');

    await user.click(screen.getByRole('button', { name: 'Approve review by ada@example.test' }));
    expect(setReviewApproved).toHaveBeenCalledWith('r1', true);
    expect(await within(screen.getByRole('table', { name: 'Customer reviews' })).findByText('Approved')).toBeInTheDocument();
    expect(await screen.findByText('Review approved.')).toBeInTheDocument();
    expect(window.location.href).toBe(hrefBefore);
  });

  it('rejects an approved review back to pending (never deletes)', async () => {
    const user = userEvent.setup();
    fetchReviewsAdmin.mockResolvedValue({
      reviews: [reviewFixture({ isApproved: true })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    setReviewApproved.mockResolvedValue(reviewFixture({ isApproved: false }));
    renderPage();
    const table = await screen.findByRole('table', { name: 'Customer reviews' });
    expect(within(table).getByText('Approved')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reject review by ada@example.test' }));
    expect(setReviewApproved).toHaveBeenCalledWith('r1', false);
    expect(await within(screen.getByRole('table', { name: 'Customer reviews' })).findByText('Pending')).toBeInTheDocument();
    expect(await screen.findByText(/stays listed under Pending/)).toBeInTheDocument();
  });

  it('deletes behind a confirmation without touching orders', async () => {
    const user = userEvent.setup();
    fetchReviewsAdmin.mockResolvedValue({
      reviews: [reviewFixture()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    deleteReviewAdmin.mockResolvedValue({ id: 'r1' });
    // Initial load shows the row; the post-delete refresh returns empty.
    fetchReviewsAdmin
      .mockResolvedValueOnce({
        reviews: [reviewFixture()],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      })
      .mockResolvedValue({ reviews: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    renderPage();
    await screen.findByText('Excellent gadget');

    await user.click(screen.getByRole('button', { name: 'Delete review by ada@example.test' }));
    expect(screen.getByRole('dialog', { name: 'Delete this review?' })).toBeInTheDocument();
    expect(deleteReviewAdmin).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(deleteReviewAdmin).toHaveBeenCalledWith('r1');
    expect(await screen.findByText('Review deleted. The order record is untouched.')).toBeInTheDocument();
    expect(screen.queryByText('Excellent gadget')).not.toBeInTheDocument();
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

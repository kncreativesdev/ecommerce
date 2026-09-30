import { useEffect, useState } from 'react';
import { Search, Star, X } from 'lucide-react';
import { useReviewStore } from '../stores/useReviewStore.js';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { RatingStars, ReviewStatusBadge } from '../components/reviews/ReviewBadges.jsx';
import { formatDate } from '../lib/format.js';

/**
 * Reviews (`/reviews`): real backend data only, via ADMIN-only
 * `GET /reviews/admin`. Filtering/sorting/pagination are SERVER-driven —
 * every control maps to a documented query param
 * (`search/isApproved/rating/sortOrder`); the store refetches on each
 * change. No invented params, no client-side slicing.
 *
 * Strictly VIEW-ONLY: the page renders review details (rating, text,
 * product, customer, status, submitted date) and never offers approve,
 * reject, edit, delete, or status-change controls. No mutation request
 * can be triggered from this page — the backend exposes no admin review
 * mutation endpoints.
 */
const REVIEW_COLUMNS = [
  { key: 'review', label: 'Review' },
  { key: 'product', label: 'Product' },
  { key: 'customer', label: 'Customer' },
  { key: 'status', label: 'Status' },
  { key: 'created', label: 'Submitted' },
];

const selectClass =
  'min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30';

function reviewTitle(review) {
  if (typeof review?.title === 'string' && review.title.trim() !== '') return review.title;
  return 'Untitled review';
}

export function ReviewsPage() {
  const reviews = useReviewStore((state) => state.reviews);
  const pagination = useReviewStore((state) => state.pagination);
  const filters = useReviewStore((state) => state.filters);
  const status = useReviewStore((state) => state.status);
  const error = useReviewStore((state) => state.error);
  const refreshReviews = useReviewStore((state) => state.refreshReviews);
  const setPage = useReviewStore((state) => state.setPage);
  const clearFilters = useReviewStore((state) => state.clearFilters);
  const ensureReviews = useReviewStore((state) => state.ensureReviews);

  // Search input is local until submitted (avoids a request per keystroke);
  // every other control applies immediately via the store (server fetch).
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');
  const [searchHelpOpen, setSearchHelpOpen] = useState(false);

  useEffect(() => {
    document.title = 'Reviews — Tech Pulse Admin';
    ensureReviews();
  }, [ensureReviews]);

  const isLoading = status === 'idle' || status === 'loading';
  const hasActiveFilters = Boolean(filters.search || filters.isApproved || filters.rating);

  const applySearch = () => {
    refreshReviews({ filters: { ...filters, search: searchDraft.trim() } });
  };

  const handleClearAll = () => {
    setSearchDraft('');
    clearFilters();
  };

  const handleFilterChange = (patch) => {
    refreshReviews({ filters: { ...filters, ...patch } });
  };

  const meta = isLoading
    ? 'Loading reviews…'
    : `${pagination.total} ${pagination.total === 1 ? 'review' : 'reviews'}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reviews"
        meta={meta}
        actions={
          <Button variant="secondary" size="sm" onClick={() => refreshReviews()} disabled={isLoading}>
            Refresh
          </Button>
        }
      />

      {!isLoading && !error && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div role="search" className="relative w-full lg:max-w-md">
              <label htmlFor="review-search" className="sr-only">
                Search reviews by text, product, or reviewer
              </label>
              <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="review-search"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applySearch();
                }}
                placeholder="Search review text, product, reviewer…"
                autoComplete="off"
                className="min-h-[44px] w-full rounded-lg border border-input bg-surface pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 hover:border-border-strong"
              />
              {searchDraft ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchDraft('');
                    refreshReviews({ filters: { ...filters, search: '' } });
                  }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={applySearch}>
                Search
              </Button>
              <button
                type="button"
                onClick={() => setSearchHelpOpen(true)}
                aria-label="What can review search find?"
                className="inline-flex min-h-[36px] cursor-pointer items-center rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                What&apos;s searchable?
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="review-status-filter" className="sr-only">
              Filter by moderation status
            </label>
            <select
              id="review-status-filter"
              value={filters.isApproved}
              onChange={(event) => handleFilterChange({ isApproved: event.target.value })}
              className={selectClass}
            >
              <option value="">All statuses</option>
              <option value="false">Pending</option>
              <option value="true">Approved</option>
            </select>

            <label htmlFor="review-rating-filter" className="sr-only">
              Filter by rating
            </label>
            <select
              id="review-rating-filter"
              value={filters.rating}
              onChange={(event) => handleFilterChange({ rating: event.target.value })}
              className={selectClass}
            >
              <option value="">All ratings</option>
              {[5, 4, 3, 2, 1].map((value) => (
                <option key={value} value={String(value)}>
                  {value} star{value === 1 ? '' : 's'}
                </option>
              ))}
            </select>

            <label htmlFor="review-sort" className="sr-only">
              Sort reviews
            </label>
            <select
              id="review-sort"
              value={filters.sortOrder}
              onChange={(event) => handleFilterChange({ sortOrder: event.target.value })}
              className={selectClass}
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>

            {hasActiveFilters ? (
              <button
                type="button"
                onClick={handleClearAll}
                className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label="Loading reviews" className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load reviews" message={error.message} onRetry={() => refreshReviews()} />
      ) : reviews.length === 0 && !hasActiveFilters ? (
        <EmptyState
          icon={Star}
          title="No reviews yet"
          message="Customer reviews submitted from order history will appear here."
        />
      ) : reviews.length === 0 ? (
        <EmptyState
          icon={Star}
          title="No reviews match"
          message="Nothing matches the current filters. Adjust or clear them to see more reviews."
        />
      ) : (
        <>
          <Table caption="Customer reviews" columns={REVIEW_COLUMNS} minWidth="min-w-[860px]">
            {reviews.map((review) => (
              <tr key={review.id} className="transition-colors hover:bg-surface-muted/50">
                <td className="max-w-sm px-4 py-3">
                  <span className="flex items-center gap-2">
                    <RatingStars rating={review.rating} />
                    <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                      {review.rating}/5
                    </span>
                  </span>
                  <p className="mt-1 truncate font-semibold text-foreground">{reviewTitle(review)}</p>
                  {review.comment ? (
                    <p className="truncate text-xs text-muted-foreground">{review.comment}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{review.product?.name ?? '—'}</p>
                  {review.orderItem?.orderId ? (
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      item {review.orderItem.id.slice(0, 8)}…
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">
                    {[review.customer?.firstName, review.customer?.lastName]
                      .filter((part) => typeof part === 'string' && part.trim() !== '')
                      .join(' ')
                      .trim() || '—'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{review.customer?.email ?? '—'}</p>
                </td>
                <td className="px-4 py-3">
                  <ReviewStatusBadge isApproved={review.isApproved} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(review.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            itemLabel={pagination.total === 1 ? 'review' : 'reviews'}
            onPageChange={setPage}
            disabled={isLoading}
          />
        </>
      )}

      {searchHelpOpen ? (
        <Modal title="What can review search find?" onClose={() => setSearchHelpOpen(false)}>
          <p className="text-sm leading-6 text-muted-foreground">
            One search box covers the server-supported fields: the review
            title or body, the reviewed product&apos;s name, and the
            reviewer&apos;s email or name. Partial matches work — typing a
            few characters of any of these narrows the list.
          </p>
          <div className="mt-5 flex justify-end">
            <Button variant="secondary" onClick={() => setSearchHelpOpen(false)}>
              Got it
            </Button>
          </div>
        </Modal>
      ) : null}

      {pagination.total > 0 && !isLoading && !error ? (
        <p className="sr-only" aria-live="polite">
          {pagination.total} {pagination.total === 1 ? 'review' : 'reviews'} ({filters.isApproved === 'true' ? 'approved' : filters.isApproved === 'false' ? 'pending' : 'all statuses'})
        </p>
      ) : null}
    </div>
  );
}

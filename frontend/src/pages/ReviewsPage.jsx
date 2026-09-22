import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Pencil, Star, Trash2 } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { ReviewCard } from '../components/reviews/ReviewCard.jsx';
import { ReviewForm } from '../components/reviews/ReviewForm.jsx';
import { deleteReview, fetchMyReviews, updateReview } from '../services/reviews.service.js';

/**
 * My Reviews (`/account/reviews`, protected): own reviews newest-first
 * with edit + hard-delete. Unreviewed-purchase discovery lives on each
 * order detail page ("Write a review" per order item). No public listing
 * exists — only the signed-in user's reviews ever render.
 */
export function ReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Mount + retry fetching (state updates only in async continuations).
  useEffect(() => {
    document.title = 'My Reviews — Tech Pulse';
    const controller = new AbortController();
    const signal = controller.signal;
    fetchMyReviews()
      .then((data) => {
        if (signal.aborted) return;
        setReviews(data);
        setStatus('success');
      })
      .catch((error) => {
        if (signal.aborted) return;
        setLoadError(error);
        setStatus('error');
      });
    return () => controller.abort();
  }, [reloadToken]);

  const retry = () => {
    setStatus('loading');
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  const handleUpdate = async (id, values) => {
    setSubmitting(true);
    try {
      const updated = await updateReview(id, values);
      if (updated) {
        setReviews((previous) => previous.map((review) => (review.id === id ? updated : review)));
      } else {
        retry();
      }
      toast.success('Review updated.');
      setEditingId(null);
    } catch (error) {
      if (error?.code === 'REVIEW_UPDATE_INVALID' || error?.status === 422) {
        throw error;
      }
      toast.error(error?.message ?? 'Update failed. Please try again.');
      throw error;
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    setDeleting(true);
    try {
      await deleteReview(id);
      toast.success('Review deleted.');
      setConfirmDeleteId(null);
      setReviews((previous) => previous.filter((review) => review.id !== id));
    } catch (error) {
      if (error?.status === 404 || error?.code === 'REVIEW_NOT_FOUND') {
        toast.success('Review already deleted.');
        setConfirmDeleteId(null);
        setReviews((previous) => previous.filter((review) => review.id !== id));
      } else {
        toast.error(error?.message ?? 'Delete failed. Please try again.');
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Container className="flex max-w-3xl flex-col gap-6 py-10 sm:py-14">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'My Account', to: '/account' }, { label: 'My Reviews' }]} />
      <h1 className="text-2xl font-bold tracking-tight">My reviews</h1>

      {status === 'loading' ? (
        <div role="status" aria-label="Loading reviews" className="flex flex-col gap-3">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      ) : status === 'error' ? (
        <ErrorState
          title="Couldn’t load your reviews"
          message={loadError?.message ?? 'Please try again.'}
          onRetry={retry}
        />
      ) : reviews.length === 0 ? (
        <EmptyState
          icon={Star}
          title="No reviews yet"
          message="After an order arrives, you can review each item from its order page."
          actionTo="/account/orders"
          actionLabel="Go to my orders"
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => {
            const editing = editingId === review.id;
            const productName = review?.product?.name ?? null;
            return (
              <li key={review.id} className="flex flex-col gap-2">
                <ReviewCard
                  review={review}
                  productName={productName}
                  actions={
                      editing ? (
                        <span className="text-[13px] font-semibold text-accent-link">Editing…</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(review.id);
                              setConfirmDeleteId(null);
                            }}
                            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Pencil size={15} aria-hidden="true" />
                            Edit
                          </button>
                          {confirmDeleteId === review.id ? (
                            <span className="inline-flex items-center gap-2" role="group" aria-label="Confirm delete">
                              <span className="text-[13px] text-muted-foreground">Delete this review?</span>
                              <button
                                type="button"
                                onClick={() => handleDelete(review.id)}
                                disabled={deleting}
                                className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg bg-destructive px-3 text-[13px] font-semibold text-destructive-foreground disabled:cursor-wait disabled:opacity-60"
                              >
                                Yes, delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={deleting}
                                className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-border px-3 text-[13px] font-semibold disabled:opacity-60"
                              >
                                Keep
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteId(review.id);
                                setEditingId(null);
                              }}
                              className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-destructive"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                              Delete
                            </button>
                          )}
                        </>
                      )
                    }
                />
                {editing ? (
                  <div className="mt-2 rounded-2xl border border-border bg-card p-5 shadow-sm">
                    <h2 className="mb-3 text-base font-bold text-foreground">Edit review</h2>
                    <ReviewForm
                      initialValue={review}
                      submitting={submitting}
                      onCancel={() => setEditingId(null)}
                      onSubmit={(values) => handleUpdate(review.id, values)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Only reviews you wrote appear here. Write new ones from any <Link to="/account/orders" className="font-semibold text-accent-link hover:no-underline">order detail page</Link>.
      </p>
    </Container>
  );
}

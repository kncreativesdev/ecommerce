import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PackageSearch, PenLine } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import {
  AddressSnapshot,
  OrderItemThumb,
  OrderStatusBadge,
  OrderTotals,
  PaymentSnapshot,
} from '../components/orders/OrderBits.jsx';
import { OrderTimeline } from '../components/orders/OrderTimeline.jsx';
import { ReviewForm } from '../components/reviews/ReviewForm.jsx';
import { fetchOrderById } from '../services/orders.service.js';
import { createReview, fetchMyReviews } from '../services/reviews.service.js';
import { formatDate, formatINR } from '../lib/format.js';

/**
 * Order detail (`/account/orders/:id`, protected): immutable snapshot view
 * (items/addresses/payment/totals) + display-only status + per-unreviewed-
 * order-item "Write a review" entry points. `404` → not-found UI (missing
 * or another user's — never distinguished). No mutation UI exists.
 */
export function OrderDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [reviewedItemIds, setReviewedItemIds] = useState(new Set());
  const [reviewingItemId, setReviewingItemId] = useState(null);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Mount + retry fetching (state updates only in async continuations).
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    Promise.all([fetchOrderById(id), fetchMyReviews().catch(() => [])])
      .then(([record, mine]) => {
        if (signal.aborted) return;
        if (!record) {
          setNotFound(true);
          setStatus('success');
          return;
        }
        setOrder(record);
        setReviewedItemIds(new Set((mine ?? []).map((review) => review.orderItemId).filter(Boolean)));
        setStatus('success');
      })
      .catch((error) => {
        if (signal.aborted) return;
        if (error?.status === 404 || error?.code === 'ORDER_NOT_FOUND') {
          setNotFound(true);
          setStatus('success');
        } else {
          setLoadError(error);
          setStatus('error');
        }
      });
    return () => controller.abort();
  }, [id, reloadToken]);

  const retry = () => {
    setStatus('loading');
    setLoadError(null);
    setNotFound(false);
    setReloadToken((token) => token + 1);
  };

  useEffect(() => {
    document.title = order?.orderNumber ? `Order ${order.orderNumber} — Tech Pulse` : 'Order — Tech Pulse';
  }, [order]);

  const handleCreateReview = async (orderItemId, values) => {
    setSubmittingReview(true);
    try {
      await createReview({ orderItemId, ...values });
      toast.success('Thanks! Your review is live.');
      setReviewingItemId(null);
      setReviewedItemIds((previous) => new Set(previous).add(orderItemId));
    } catch (error) {
      if (error?.code === 'REVIEW_ALREADY_EXISTS' || error?.status === 409) {
        toast.error('You already reviewed this item — see My Reviews to edit it.');
        setReviewedItemIds((previous) => new Set(previous).add(orderItemId));
        setReviewingItemId(null);
      } else {
        throw error;
      }
    } finally {
      setSubmittingReview(false);
    }
  };

  const shipping = order?.addresses?.find((address) => address.type === 'SHIPPING') ?? order?.addresses?.[0] ?? null;
  const billing = order?.addresses?.find((address) => address.type === 'BILLING') ?? null;
  const payment = order?.payments?.[0] ?? null;

  return (
    <Container className="flex max-w-3xl flex-col gap-6 py-10 sm:py-14">
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/' },
          { label: 'My Account', to: '/account' },
          { label: 'Orders', to: '/account/orders' },
          { label: order?.orderNumber ?? 'Order' },
        ]}
      />

      {status === 'loading' ? (
        <div role="status" aria-label="Loading order" className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : status === 'error' ? (
        <ErrorState
          title="Couldn’t load this order"
          message={loadError?.message ?? 'Please try again.'}
          onRetry={retry}
        />
      ) : notFound || !order ? (
        <EmptyState
          icon={PackageSearch}
          title="Order not found"
          message="This order doesn’t exist or belongs to another account."
          actionTo="/account/orders"
          actionLabel="Back to orders"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tabular-nums tracking-tight">{order.orderNumber}</h1>
              <p className="mt-1 text-sm text-muted-foreground">Placed {formatDate(order.createdAt)}</p>
            </div>
            <OrderStatusBadge status={order.status} />
          </div>

          <OrderTimeline order={order} />

          <section aria-label="Order items" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-base font-bold text-foreground">Items</h2>
            <ul className="flex flex-col gap-4">
              {(order.items ?? []).map((item) => {
                const reviewed = reviewedItemIds.has(item.id);
                const reviewing = reviewingItemId === item.id;
                return (
                  <li key={item.id} className="flex flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      <OrderItemThumb item={item} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">{item.productName}</p>
                        {item.variantName ? (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {item.variantName}{item.sku ? ` · ${item.sku}` : ''}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                          {formatINR(item.unitPrice)} × {item.quantity}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                        {formatINR(item.lineTotal)}
                      </p>
                    </div>
                    {!reviewed && !reviewing ? (
                      <button
                        type="button"
                        onClick={() => setReviewingItemId(item.id)}
                        className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 self-start rounded-lg px-2 text-[13px] font-semibold text-accent-link"
                      >
                        <PenLine size={15} aria-hidden="true" />
                        Write a review
                      </button>
                    ) : null}
                    {reviewed && !reviewing ? (
                      <p className="text-xs text-muted-foreground">
                        Reviewed — <Link to="/account/reviews" className="font-semibold text-accent-link hover:no-underline">manage in My Reviews</Link>
                      </p>
                    ) : null}
                    {reviewing ? (
                      <div className="rounded-xl bg-surface-muted/60 p-4">
                        <ReviewForm
                          submitting={submittingReview}
                          submitLabel="Submit review"
                          onCancel={() => setReviewingItemId(null)}
                          onSubmit={(values) => handleCreateReview(item.id, values)}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <section aria-label="Shipping address" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-2 text-sm font-bold text-foreground">Shipping address</h2>
              <AddressSnapshot address={shipping} />
            </section>
            {billing ? (
              <section aria-label="Billing address" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <h2 className="mb-2 text-sm font-bold text-foreground">Billing address</h2>
                <AddressSnapshot address={billing} />
              </section>
            ) : null}
          </div>

          <section aria-label="Payment" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-foreground">Payment</h2>
            <PaymentSnapshot payment={payment} />
          </section>

          <section aria-label="Order totals" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <OrderTotals order={order} />
          </section>
        </>
      )}
    </Container>
  );
}

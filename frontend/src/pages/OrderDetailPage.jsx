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
  OrderCoupon,
  OrderItemThumb,
  OrderStatusBadge,
  OrderTotals,
  PaymentSnapshot,
} from '../components/orders/OrderBits.jsx';
import { OrderTimeline } from '../components/orders/OrderTimeline.jsx';
import { ReviewForm } from '../components/reviews/ReviewForm.jsx';
import { ReturnRequestForm } from '../components/orders/ReturnRequestForm.jsx';
import { fetchOrderById, cancelOrder, fetchReturnRequest, requestReturn } from '../services/orders.service.js';
import { createReview, fetchMyReviews } from '../services/reviews.service.js';
import { formatDate, formatINR } from '../lib/format.js';
import { isOrderCancellable, isOrderReturnable, returnReasonLabel, returnStatusLabel } from '../lib/orderStatus.js';

/**
 * Order detail (`/account/orders/:id`, protected): immutable snapshot view
 * (items/addresses/payment/totals) + display-only status + per-unreviewed-
 * order-item "Write a review" entry points. `404` → not-found UI (missing
 * or another user's — never distinguished). Eligible orders
 * (PENDING/CONFIRMED/PROCESSING) offer a confirmed customer cancellation
 * (`POST /orders/:id/cancel`); delivered/completed orders without a return
 * request offer a return request (`POST /orders/:id/returns`) shown as a
 * separate section that never mutates the order timeline. The backend owns
 * every eligibility decision.
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
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [returnRequest, setReturnRequest] = useState(null);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [submittingReturn, setSubmittingReturn] = useState(false);

  // Mount + retry fetching (state updates only in async continuations).
  // The return request loads tolerantly: a returns-endpoint failure never
  // blocks the order view (the request action re-checks server-side).
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    Promise.all([fetchOrderById(id), fetchMyReviews().catch(() => []), fetchReturnRequest(id).catch(() => null)])
      .then(([record, mine, existingReturn]) => {
        if (signal.aborted) return;
        if (!record) {
          setNotFound(true);
          setStatus('success');
          return;
        }
        setOrder(record);
        setReviewedItemIds(new Set((mine ?? []).map((review) => review.orderItemId).filter(Boolean)));
        setReturnRequest(existingReturn ?? null);
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
    setShowCancelConfirm(false);
    setShowReturnForm(false);
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

  const handleConfirmCancel = async () => {
    if (cancelling || !order?.id) return;
    setCancelling(true);
    try {
      const updated = await cancelOrder(order.id);
      if (updated) setOrder(updated);
      else setReloadToken((token) => token + 1);
      setShowCancelConfirm(false);
      toast.success('Order cancelled. Your items are released from this order.');
    } catch (error) {
      // Preserve the current order state — never display as cancelled on
      // failure. Surface the authoritative backend message.
      toast.error(error?.message ?? 'Could not cancel this order. Please try again.');
    } finally {
      setCancelling(false);
    }
  };
  const shipping = order?.addresses?.find((address) => address.type === 'SHIPPING') ?? order?.addresses?.[0] ?? null;
  const billing = order?.addresses?.find((address) => address.type === 'BILLING') ?? null;
  const payment = order?.payments?.[0] ?? null;
  const cancellable = isOrderCancellable(order);
  // Return action is display-gated only (delivered/completed, no request
  // yet); the backend re-validates ownership, eligibility, and duplicates.
  const returnable = isOrderReturnable(order) && !returnRequest;

  const handleSubmitReturn = async (values) => {
    if (submittingReturn || !order?.id) return;
    setSubmittingReturn(true);
    try {
      const created = await requestReturn(order.id, values);
      setReturnRequest(created);
      setShowReturnForm(false);
      toast.success('Return requested. We’ll update you here on next steps.');
    } catch (error) {
      if (error?.code === 'RETURN_ALREADY_REQUESTED' || error?.status === 409) {
        // Another request already exists (e.g. submitted twice): reconcile
        // to the stored request instead of showing a false form state.
        const current = await fetchReturnRequest(order.id).catch(() => null);
        if (current) setReturnRequest(current);
        setShowReturnForm(false);
        toast.error(error?.message ?? 'A return request already exists for this order.');
        return;
      }
      throw error;
    } finally {
      setSubmittingReturn(false);
    }
  };

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

          {cancellable || returnable ? (
            <div className="flex flex-wrap items-center justify-end gap-2" aria-label="Order actions">
              {cancellable ? (
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(true)}
                  className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-destructive/40 px-5 text-sm font-semibold text-destructive transition-colors duration-200 hover:bg-destructive/10"
                >
                  Cancel Order
                </button>
              ) : null}
              {returnable ? (
                <button
                  type="button"
                  onClick={() => setShowReturnForm(true)}
                  className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground transition-colors duration-200 hover:bg-surface-muted"
                >
                  Request Return
                </button>
              ) : null}
            </div>
          ) : null}

          {showCancelConfirm && cancellable ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Confirm order cancellation"
              className="flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-card p-5 shadow-sm"
            >
              <h2 className="text-base font-bold text-foreground">Cancel this order?</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Cancelling {order.orderNumber} is an order action and cannot be undone. The order will
                be marked cancelled and its items released.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={cancelling}
                  className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-border px-5 text-sm font-semibold disabled:opacity-60"
                >
                  Keep order
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancel}
                  disabled={cancelling}
                  aria-busy={cancelling}
                  className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl bg-destructive px-6 text-sm font-semibold text-destructive-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                >
                  {cancelling ? 'Cancelling…' : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          ) : null}

          {showReturnForm && returnable ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Request a return"
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm"
            >
              <h2 className="text-base font-bold text-foreground">Request a return</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Tell us why you want to return {order.orderNumber}. This creates a return request —
                your order status and timeline stay unchanged.
              </p>
              <ReturnRequestForm
                submitting={submittingReturn}
                submitLabel="Submit return request"
                onCancel={() => setShowReturnForm(false)}
                onSubmit={handleSubmitReturn}
              />
            </div>
          ) : null}

          {returnRequest ? (
            <section aria-label="Return request" className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold text-foreground">Return request</h2>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  {returnStatusLabel(returnRequest.status)}
                </span>
              </div>
              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-semibold text-foreground">Reason</dt>
                  <dd className="text-muted-foreground">{returnReasonLabel(returnRequest.reason)}</dd>
                </div>
                {returnRequest.details ? (
                  <div className="flex flex-col gap-0.5">
                    <dt className="font-semibold text-foreground">Details</dt>
                    <dd className="break-words leading-6 text-muted-foreground">{returnRequest.details}</dd>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-semibold text-foreground">Requested</dt>
                  <dd className="tabular-nums text-muted-foreground">{formatDate(returnRequest.createdAt)}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          <OrderTimeline order={order} />

          <section aria-label="Order items" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-base font-bold text-foreground">Items</h2>
            <ul className="flex flex-col gap-4">
              {(order.items ?? []).map((item) => {
                const reviewed = reviewedItemIds.has(item.id);
                const reviewing = reviewingItemId === item.id;
                // Ordered products link to the live product detail page
                // (`/product/:id`); the snapshot text stays historical.
                const productTo = item.productId ? `/product/${item.productId}` : null;
                return (
                  <li key={item.id} className="flex flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      {productTo ? (
                        <Link to={productTo} aria-label={`View ${item.productName}`}>
                          <OrderItemThumb item={item} />
                        </Link>
                      ) : (
                        <OrderItemThumb item={item} />
                      )}
                      <div className="min-w-0 flex-1">
                        {productTo ? (
                          <Link
                            to={productTo}
                            className="text-sm font-semibold text-foreground transition-colors duration-200 hover:text-accent hover:no-underline"
                          >
                            {item.productName}
                          </Link>
                        ) : (
                          <p className="text-sm font-semibold text-foreground">{item.productName}</p>
                        )}
                        {item.variantName ? (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {item.variantName}{item.sku ? ` · ${item.sku}` : ''}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                          {formatINR(item.unitPrice)} × {item.quantity}
                        </p>
                        {productTo ? (
                          <Link
                            to={productTo}
                            className="mt-1 inline-flex min-h-[36px] items-center text-[13px] font-semibold text-accent-link hover:no-underline"
                          >
                            View Product
                          </Link>
                        ) : null}
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

          <section aria-label="Order totals" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <OrderCoupon order={order} />
            <OrderTotals order={order} />
          </section>
        </>
      )}
    </Container>
  );
}

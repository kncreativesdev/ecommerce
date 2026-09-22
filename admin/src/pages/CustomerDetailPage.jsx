import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, PackageSearch, Star, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../stores/useAuthStore.js';
import { useCustomerStore } from '../stores/useCustomerStore.js';
import { customerDisplayName, customerRoleLabel } from '../utils/customerDisplay.js';
import { fetchOrdersAdmin } from '../services/order.service.js';
import { fetchReviewsAdmin } from '../services/review.service.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { formatDate, formatDateTime } from '../lib/format.js';

/**
 * Customer Detail (`/customers/:id`). Loads the documented
 * `GET /users/:id` directly (deep-link safe), then reconciles lifecycle
 * mutations from the authoritative `PATCH /users/:id` response.
 *
 * Sections show safe fields only (name, email, phone, roles, status,
 * dates). Order and review summaries reuse the REAL admin APIs
 * (`GET /orders/admin?search=<email>`, `GET /reviews/admin?userId=<id>`)
 * — no second order/review state source, no mutation of order state.
 * Order rows navigate to the existing `/orders/:id` page; review rows to
 * `/reviews`. Customer addresses are intentionally absent: addresses stay
 * owner-scoped with no admin override by design.
 *
 * Lifecycle follows the established pattern: Active/Inactive badge,
 * Activate (immediate, pending-guarded), Deactivate (confirm modal —
 * destructive because the account cannot log in afterwards). An admin
 * cannot deactivate their own account.
 */
export function CustomerDetailPage() {
  const { id } = useParams();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const detail = useCustomerStore((state) => state.detail);
  const detailStatus = useCustomerStore((state) => state.detailStatus);
  const detailError = useCustomerStore((state) => state.detailError);
  const fetchCustomerDetail = useCustomerStore((state) => state.fetchCustomerDetail);
  const setActive = useCustomerStore((state) => state.setActive);
  const clearDetail = useCustomerStore((state) => state.clearDetail);

  const [orders, setOrders] = useState(null);
  const [ordersTotal, setOrdersTotal] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [reviewsTotal, setReviewsTotal] = useState(null);
  const [deactivating, setDeactivating] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [prevId, setPrevId] = useState(id);

  // Render-time reset when navigating between customer ids (sanctioned
  // derived-state pattern); effects below only sync async fetches.
  if (prevId !== id) {
    setPrevId(id);
    setOrders(null);
    setOrdersTotal(null);
    setReviews(null);
    setReviewsTotal(null);
    setDeactivating(false);
  }

  useEffect(() => {
    document.title = detail
      ? `Customer ${customerDisplayName(detail)} — Tech Pulse Admin`
      : 'Customer — Tech Pulse Admin';
  }, [detail]);

  useEffect(() => {
    fetchCustomerDetail(id);
    return () => clearDetail();
  }, [id, fetchCustomerDetail, clearDetail]);

  // Linked summaries: real admin APIs, scoped to this customer. Order
  // search matches the customer's email; review listing filters the exact
  // user id. Failures stay silent (the profile is the page; summaries
  // degrade to "unavailable" rather than breaking it).
  useEffect(() => {
    if (!detail?.id) return undefined;
    let cancelled = false;
    fetchOrdersAdmin({ page: 1, limit: 5, search: detail.email })
      .then(({ orders: rows, pagination }) => {
        if (cancelled) return;
        setOrders(Array.isArray(rows) ? rows : []);
        setOrdersTotal(pagination?.total ?? rows?.length ?? 0);
      })
      .catch(() => {
        if (!cancelled) {
          setOrders(null);
          setOrdersTotal(null);
        }
      });
    fetchReviewsAdmin({ page: 1, limit: 5, userId: detail.id })
      .then(({ reviews: rows, pagination }) => {
        if (cancelled) return;
        setReviews(Array.isArray(rows) ? rows : []);
        setReviewsTotal(pagination?.total ?? rows?.length ?? 0);
      })
      .catch(() => {
        if (!cancelled) {
          setReviews(null);
          setReviewsTotal(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.id, detail?.email]);

  const handleActivate = async () => {
    if (!detail?.id || mutating) return;
    setMutating(true);
    try {
      const record = await setActive(detail.id, true);
      toast.success(`“${customerDisplayName(record ?? detail)}” reactivated.`);
    } catch (error) {
      toast.error(error?.message ?? 'Reactivation failed. Please try again.');
    } finally {
      setMutating(false);
    }
  };

  const handleDeactivate = async () => {
    if (!detail?.id || mutating) return;
    setMutating(true);
    try {
      const record = await setActive(detail.id, false);
      toast.success(`“${customerDisplayName(record ?? detail)}” deactivated. They cannot log in until reactivated.`);
      setDeactivating(false);
    } catch (error) {
      if (error?.status === 404 || error?.code === 'USER_NOT_FOUND') {
        toast.success('Account already gone.');
        setDeactivating(false);
        fetchCustomerDetail(detail.id);
      } else {
        toast.error(error?.message ?? 'Deactivation failed. Please try again.');
      }
    } finally {
      setMutating(false);
    }
  };

  const isSelf = Boolean(currentUserId && detail?.id && currentUserId === detail.id);
  const isInactive = detail?.isActive === false;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
        <Link to="/customers" className="text-muted-foreground transition-colors hover:text-foreground hover:no-underline">
          Customers
        </Link>
        <ChevronRight size={14} aria-hidden="true" className="text-muted-foreground" />
        <span aria-current="page" className="font-medium text-foreground">
          {detail ? customerDisplayName(detail) : 'Customer'}
        </span>
      </nav>

      {detailStatus === 'loading' || detailStatus === 'idle' ? (
        <div role="status" aria-label="Loading customer" className="flex flex-col gap-3">
          {[0, 1, 2].map((index) => (
            <div key={index} aria-hidden="true" className="h-28 animate-pulse rounded-xl bg-surface-muted" />
          ))}
        </div>
      ) : detailStatus === 'error' || !detail ? (
        detailError?.code === 'USER_NOT_FOUND' || detailError?.status === 404 ? (
          <EmptyState
            icon={UserRound}
            title="Customer not found"
            message="This account doesn’t exist or is no longer available."
            actionTo="/customers"
            actionLabel="Back to customers"
          />
        ) : (
          <ErrorState
            title="Couldn’t load this customer"
            message={detailError?.message}
            onRetry={() => fetchCustomerDetail(id)}
          />
        )
      ) : (
        <>
          <section aria-label="Customer profile" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold tracking-tight text-foreground">
                  {customerDisplayName(detail)}
                </h2>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{detail.email}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={isInactive ? 'neutral' : 'success'}>
                    {isInactive ? 'Inactive' : 'Active'}
                  </Badge>
                  <Badge tone="neutral">{customerRoleLabel(detail)}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isInactive ? (
                  <Button variant="secondary" size="sm" loading={mutating} onClick={handleActivate}>
                    Reactivate
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={mutating || isSelf}
                    title={isSelf ? 'You cannot deactivate your own admin account.' : undefined}
                    onClick={() => setDeactivating(true)}
                  >
                    Deactivate
                  </Button>
                )}
              </div>
            </div>
            {isSelf ? (
              <p className="rounded-lg bg-surface-muted px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
                This is your own admin account — deactivation is disabled so you cannot lock yourself out.
              </p>
            ) : null}

            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-surface-muted/50 px-3.5 py-2.5">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phone</dt>
                <dd className="mt-0.5 text-sm font-medium text-foreground">{detail.phone ?? '—'}</dd>
              </div>
              <div className="rounded-lg bg-surface-muted/50 px-3.5 py-2.5">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Joined</dt>
                <dd className="mt-0.5 text-sm font-medium text-foreground">{formatDateTime(detail.createdAt)}</dd>
              </div>
            </dl>
            <p className="text-xs leading-5 text-muted-foreground">
              Deactivation blocks the account&apos;s next login and token refresh
              (`403 AUTH_ACCOUNT_INACTIVE`); existing sessions keep working
              until their short-lived token expires. No other profile field is
              admin-writable, and there is no account deletion.
            </p>
          </section>

          <section aria-label="Recent orders" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">
                Recent orders{ordersTotal !== null ? ` · ${ordersTotal}` : ''}
              </h3>
              <Link to="/orders" className="text-sm font-semibold text-accent-link hover:no-underline">
                All orders
              </Link>
            </div>
            {orders === null ? (
              <p className="text-sm text-muted-foreground">Order summary unavailable right now.</p>
            ) : orders.length === 0 ? (
              <EmptyState
                icon={PackageSearch}
                title="No orders yet"
                message="This customer hasn’t placed an order."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {orders.map((order) => (
                  <li key={order.id}>
                    <Link
                      to={`/orders/${order.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3.5 py-2.5 transition-colors hover:bg-surface-muted hover:no-underline"
                    >
                      <span className="text-sm font-semibold text-foreground">{order.orderNumber}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatDate(order.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Customer reviews" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">
                Reviews{reviewsTotal !== null ? ` · ${reviewsTotal}` : ''}
              </h3>
              <Link to="/reviews" className="text-sm font-semibold text-accent-link hover:no-underline">
                All reviews
              </Link>
            </div>
            {reviews === null ? (
              <p className="text-sm text-muted-foreground">Review summary unavailable right now.</p>
            ) : reviews.length === 0 ? (
              <EmptyState
                icon={Star}
                title="No reviews yet"
                message="This customer hasn’t submitted a review."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {reviews.map((review) => (
                  <li
                    key={review.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3.5 py-2.5"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold tabular-nums text-foreground">{review.rating}/5</span>
                      <span className="ml-2 truncate text-muted-foreground">
                        {review.product?.name ?? 'Product'} {review.title ? `— “${review.title}”` : ''}
                      </span>
                    </span>
                    <Badge tone={review.isApproved ? 'success' : 'warning'}>
                      {review.isApproved ? 'Approved' : 'Pending'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {deactivating && detail ? (
        <Modal title="Deactivate this account?" onClose={() => !mutating && setDeactivating(false)} persistent={mutating}>
          <p className="text-sm leading-6 text-muted-foreground">
            <span className="font-semibold text-foreground">{detail.email}</span> will
            no longer be able to log in until reactivated. Their orders,
            reviews, and history stay intact — only access is suspended.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeactivating(false)} disabled={mutating}>
              Keep active
            </Button>
            <Button variant="destructive" loading={mutating} onClick={handleDeactivate}>
              Yes, deactivate
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

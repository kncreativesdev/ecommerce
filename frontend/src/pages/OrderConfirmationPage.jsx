import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, PackageSearch } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { AddressSnapshot, OrderTotals, PaymentSnapshot } from '../components/orders/OrderBits.jsx';
import { fetchOrderById } from '../services/orders.service.js';
import { useSession } from '../hooks/useSession.js';
import { formatINR } from '../lib/format.js';

/**
 * Order confirmation (`/order-confirmation/:id`): success hero, prominent
 * order number, snapshot summary, shipping snapshot, COD note, CTAs. Only
 * a `201` from `POST /orders` creates an order — direct visits refetch
 * `GET /orders/:id` (unauthenticated direct access is gated by the login
 * redirect via the session check + API 401). `404` → not-found.
 */
export function OrderConfirmationPage() {
  const { id } = useParams();
  const { isAuthenticated, status: sessionStatus } = useSession();
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const sessionSettled = sessionStatus !== 'idle' && sessionStatus !== 'loading';
  const loginRequired = sessionSettled && !isAuthenticated;

  useEffect(() => {
    document.title = order?.orderNumber
      ? `Order ${order.orderNumber} confirmed — Tech Pulse`
      : 'Order confirmation — Tech Pulse';
  }, [order]);

  // Fetch only for authenticated sessions (state updates in continuations).
  useEffect(() => {
    if (!sessionSettled || !isAuthenticated) return;
    const controller = new AbortController();
    const signal = controller.signal;
    fetchOrderById(id)
      .then((record) => {
        if (signal.aborted) return;
        if (!record) {
          setStatus('not-found');
          return;
        }
        setOrder(record);
        setStatus('success');
      })
      .catch((error) => {
        if (signal.aborted) return;
        if (error?.status === 404 || error?.code === 'ORDER_NOT_FOUND') {
          setStatus('not-found');
        } else {
          setLoadError(error);
          setStatus('error');
        }
      });
    return () => controller.abort();
  }, [id, isAuthenticated, sessionSettled, reloadToken]);

  const retry = () => {
    setStatus('loading');
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  const shipping = order?.addresses?.find((address) => address.type === 'SHIPPING') ?? order?.addresses?.[0] ?? null;
  const payment = order?.payments?.[0] ?? null;

  return (
    <Container className="flex max-w-2xl flex-col gap-6 py-10 sm:py-14">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Order confirmed' }]} />

      {status === 'loading' ? (
        <div role="status" aria-label="Loading confirmation" className="flex flex-col gap-3">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : loginRequired ? (
        <EmptyState
          icon={PackageSearch}
          title="Sign in to view this order"
          message="Order confirmations live behind your account for privacy."
          actionTo={`/login?redirect=${encodeURIComponent(`/order-confirmation/${id}`)}`}
          actionLabel="Sign in"
        />
      ) : status === 'error' ? (
        <ErrorState
          title="Couldn’t load this confirmation"
          message={loadError?.message ?? 'Please try again.'}
          onRetry={retry}
        />
      ) : status === 'not-found' || !order ? (
        <EmptyState
          icon={PackageSearch}
          title="Order not found"
          message="This confirmation doesn’t exist or belongs to another account."
          actionTo="/shop"
          actionLabel="Continue shopping"
        />
      ) : (
        <>
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-sm">
            <span aria-hidden="true" className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 size={34} />
            </span>
            <h1 className="text-2xl font-bold tracking-tight">Order placed — thank you!</h1>
            <p className="text-sm text-muted-foreground">
              Pay{' '}
              <span className="font-bold tabular-nums text-foreground">{formatINR(order.grandTotal)}</span>{' '}
              in cash when your order arrives.
            </p>
            <p className="rounded-xl bg-surface-muted px-5 py-3 text-lg font-extrabold tabular-nums tracking-wide text-foreground">
              {order.orderNumber}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                to={`/account/orders/${order.id}`}
                className="inline-flex min-h-[44px] items-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 hover:no-underline"
              >
                View order
              </Link>
              <Link
                to="/shop"
                className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-surface px-6 text-sm font-semibold text-secondary-foreground transition-colors duration-200 hover:bg-surface-muted hover:no-underline"
              >
                Continue shopping
              </Link>
            </div>
          </div>

          <section aria-label="Delivery snapshot" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-bold text-foreground">Delivering to</h2>
            <AddressSnapshot address={shipping} />
          </section>

          <section aria-label="Payment snapshot" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
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

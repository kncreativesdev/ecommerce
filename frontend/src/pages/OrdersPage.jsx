import { useEffect, useState } from 'react';
import { PackageSearch } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { OrderLink, OrderStatusBadge } from '../components/orders/OrderBits.jsx';
import { fetchOrders } from '../services/orders.service.js';
import { formatDate, formatINR } from '../lib/format.js';

/**
 * Order history (`/account/orders`, protected): own orders newest-first,
 * rendered from immutable snapshots only. No cancel/reorder actions exist.
 */
export function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    document.title = 'Orders — Tech Pulse';
  }, []);

  // Mount + retry fetching (state updates only in async continuations).
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    fetchOrders()
      .then((data) => {
        if (signal.aborted) return;
        setOrders(data);
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

  return (
    <Container className="flex max-w-3xl flex-col gap-6 py-10 sm:py-14">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'My Account', to: '/account' }, { label: 'Orders' }]} />
      <h1 className="text-2xl font-bold tracking-tight">Orders</h1>

      {status === 'loading' ? (
        <div role="status" aria-label="Loading orders" className="flex flex-col gap-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : status === 'error' ? (
        <ErrorState
          title="Couldn’t load your orders"
          message={loadError?.message ?? 'Please try again.'}
          onRetry={retry}
        />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No orders yet"
          message="Your placed orders will appear here with live status."
          actionTo="/shop"
          actionLabel="Start shopping"
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold tabular-nums text-foreground">{order.orderNumber}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDate(order.createdAt)} · {order.items?.length ?? 0} {(order.items?.length ?? 0) === 1 ? 'item' : 'items'}
                </p>
                <div className="mt-2">
                  <OrderStatusBadge status={order.status} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                <p className="text-base font-extrabold tabular-nums text-foreground">
                  {formatINR(order.grandTotal)}
                </p>
                <OrderLink orderId={order.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}

import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ReceiptText } from 'lucide-react';
import { useReturnStore } from '../stores/useReturnStore.js';
import { customerDisplayName } from '../utils/orderLifecycle.js';
import { returnReasonLabel, returnStatusLabel } from '../utils/returns.js';
import { ReturnStatusBadge } from '../components/returns/ReturnBadges.jsx';
import { OrderStatusBadge } from '../components/orders/OrderBadges.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { formatDateTime, formatINR } from '../lib/format.js';
import { cn } from '../lib/cn.js';

function Section({ title, children, className }) {
  return (
    <section aria-label={title} className={cn('rounded-xl border border-border bg-card p-5 shadow-sm', className)}>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Return Detail (`/returns/:id`): the authoritative server return request,
 * via ADMIN-only `GET /returns/:id`. Read-only — the backend workflow
 * defines creation + history only, so no status actions exist here.
 * The original order is summarized with a link to its full Order Detail
 * page rather than duplicated; the order lifecycle timeline is never
 * touched by return state.
 */
export function ReturnDetailPage() {
  const { id } = useParams();
  const detail = useReturnStore((state) => state.detail);
  const detailStatus = useReturnStore((state) => state.detailStatus);
  const detailError = useReturnStore((state) => state.detailError);
  const fetchReturnDetail = useReturnStore((state) => state.fetchReturnDetail);
  const clearDetail = useReturnStore((state) => state.clearDetail);

  useEffect(() => {
    document.title = 'Return Request — Tech Pulse Admin';
    fetchReturnDetail(id);
    return () => clearDetail();
  }, [id, fetchReturnDetail, clearDetail]);

  const isLoading = detailStatus === 'idle' || detailStatus === 'loading';
  const customer = detail?.customer ?? null;
  const order = detail?.order ?? null;
  const history = Array.isArray(detail?.history) ? detail.history : [];

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/returns"
        className="inline-flex min-h-[44px] w-fit items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground hover:no-underline"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Back to return orders
      </Link>

      {isLoading ? (
        <div role="status" aria-label="Loading return request" className="flex flex-col gap-3">
          <div aria-hidden="true" className="h-10 w-2/3 animate-pulse rounded-lg bg-surface-muted" />
          {[0, 1].map((index) => (
            <div key={index} aria-hidden="true" className="h-32 animate-pulse rounded-xl bg-surface-muted" />
          ))}
        </div>
      ) : detailError || !detail ? (
        detailError?.status === 404 || detailError?.code === 'RETURN_NOT_FOUND' ? (
          <EmptyState
            icon={ReceiptText}
            title="Return request not found"
            message="This return request does not exist or is no longer accessible. Return to the list."
          />
        ) : (
          <ErrorState
            title="Couldn’t load the return request"
            message={detailError?.message}
            onRetry={() => fetchReturnDetail(id)}
          />
        )
      ) : (
        <>
          <PageHeader
            title={`Return — ${order?.orderNumber ?? detail.orderId}`}
            description={`Requested ${formatDateTime(detail.createdAt)} · ${returnReasonLabel(detail.reason)}`}
            meta={
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <ReturnStatusBadge status={detail.status} />
                {order ? <OrderStatusBadge status={order.status} /> : null}
              </span>
            }
          />

          <Section title="Return request">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd><ReturnStatusBadge status={detail.status} /></dd>
              <dt className="text-muted-foreground">Reason</dt>
              <dd className="font-medium text-foreground">{returnReasonLabel(detail.reason)}</dd>
              <dt className="text-muted-foreground">Customer</dt>
              <dd className="font-medium text-foreground">{customer ? customerDisplayName(customer) : '—'}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="break-all text-foreground">{customer?.email ?? '—'}</dd>
              <dt className="text-muted-foreground">Phone</dt>
              <dd className="tabular-nums text-foreground">{customer?.phone ?? '—'}</dd>
              <dt className="text-muted-foreground">Requested</dt>
              <dd className="tabular-nums text-foreground">{formatDateTime(detail.createdAt)}</dd>
            </dl>
            {detail.details ? (
              <div className="mt-3 rounded-lg bg-surface-muted/50 p-4 text-sm leading-6">
                <p className="font-semibold text-foreground">Customer explanation</p>
                <p className="mt-1 break-words text-muted-foreground">{detail.details}</p>
              </div>
            ) : null}
          </Section>

          <Section title="Return history">
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No history entries for this request yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3.5 py-2.5"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-semibold text-foreground">{returnStatusLabel(entry.status)}</span>
                      <span
                        className="truncate text-xs tabular-nums text-muted-foreground"
                        title={entry.actorId ?? undefined}
                      >
                        {entry.actorId
                          ? entry.actorId === customer?.id
                            ? `Submitted by ${customerDisplayName(customer)}`
                            : `Actor ${entry.actorId.slice(0, 8)}`
                          : 'System'}
                      </span>
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Return lifecycle only — the order status timeline is unaffected by return requests.
            </p>
          </Section>

          <Section title="Original order">
            {order ? (
              <div className="flex flex-col gap-3">
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <dt className="text-muted-foreground">Order</dt>
                  <dd className="font-mono font-semibold text-foreground">{order.orderNumber}</dd>
                  <dt className="text-muted-foreground">Order status</dt>
                  <dd><OrderStatusBadge status={order.status} /></dd>
                  <dt className="text-muted-foreground">Total</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{formatINR(order.grandTotal)}</dd>
                  <dt className="text-muted-foreground">Placed</dt>
                  <dd className="tabular-nums text-foreground">{formatDateTime(order.createdAt)}</dd>
                </dl>
                <Link
                  to={`/orders/${order.id}`}
                  className="inline-flex min-h-[44px] items-center self-start rounded-lg px-2 text-sm font-semibold text-accent-link hover:no-underline"
                >
                  View full order
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">The original order is no longer accessible.</p>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

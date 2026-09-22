import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Image as ImageIcon, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import { resolveImageUrl } from '../services/media.service.js';
import { useOrderStore } from '../stores/useOrderStore.js';
import { updateOrderPaymentStatus, updateOrderStatus } from '../services/order.service.js';
import {
  allowedOrderTransitions,
  allowedPaymentTransitions,
  customerDisplayName,
  latestPayment,
  orderItemCount,
} from '../utils/orderLifecycle.js';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { OrderStatusBadge, PaymentMethodBadge, PaymentStatusBadge } from '../components/orders/OrderBadges.jsx';
import { formatDateTime, formatINR } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * Order Detail (`/orders/:id`): the authoritative server order, via
 * ADMIN-only `GET /orders/admin/:id`. Snapshots render as stored —
 * totals come from the server (never recomputed), item rows render the
 * purchase-time snapshots (no live catalog lookups, no thumbnails: the
 * snapshot carries no media metadata and history must render snapshots,
 * not live data).
 *
 * Lifecycle controls present only the backend's allowed next states
 * (mirror in `utils/orderLifecycle.js`); the backend stays authoritative
 * — `409` rejections surface the server message and trigger a refetch.
 * Cancellation is `PATCH …/status { CANCELLED }` (no separate endpoint,
 * no frontend inventory writes: the backend restores stock + ledger
 * atomically). Payment controls mutate status only (no gateway).
 * History beyond `createdAt`/`updatedAt` does not exist server-side and
 * is not invented here.
 */
const ITEM_COLUMNS = [
  { key: 'image', label: 'Image' },
  { key: 'item', label: 'Item' },
  { key: 'sku', label: 'SKU' },
  { key: 'quantity', label: 'Qty' },
  { key: 'unit', label: 'Unit price' },
  { key: 'total', label: 'Line total', numeric: true },
];

/**
 * Historical purchased-variant image from the order snapshot
 * (`imageStoragePath`, immutable). Pre-snapshot orders carry null and
 * render the neutral placeholder — live variant media is never consulted
 * for history.
 */
function OrderItemThumb({ item }) {
  const url = resolveImageUrl(item?.imageStoragePath ? { storagePath: item.imageStoragePath } : null);
  if (!url) {
    return (
      <span
        aria-label="No image snapshot for this item"
        title="No image snapshot for this item"
        className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground"
      >
        <ImageIcon size={20} aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="h-12 w-12 rounded-lg border border-border bg-surface-muted object-cover"
    />
  );
}

function Section({ title, children, className }) {
  return (
    <section aria-label={title} className={cn('rounded-xl border border-border bg-card p-5 shadow-sm', className)}>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function AddressBlock({ address }) {
  return (
    <div className="rounded-lg bg-surface-muted/50 p-4 text-sm leading-6">
      <p className="font-semibold text-foreground">{address.fullName}</p>
      <p className="text-muted-foreground">{address.phone}</p>
      <p className="mt-1 text-muted-foreground">
        {address.addressLine1}
        {address.addressLine2 ? `, ${address.addressLine2}` : ''}
        <br />
        {address.city}, {address.state} {address.postalCode}
        <br />
        {address.country}
      </p>
    </div>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const detail = useOrderStore((state) => state.detail);
  const detailStatus = useOrderStore((state) => state.detailStatus);
  const detailError = useOrderStore((state) => state.detailError);
  const fetchOrderDetail = useOrderStore((state) => state.fetchOrderDetail);
  const syncOrder = useOrderStore((state) => state.syncOrder);
  const clearDetail = useOrderStore((state) => state.clearDetail);

  const [pendingAction, setPendingAction] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: 'status' | 'payment', next }

  useEffect(() => {
    document.title = 'Order — Tech Pulse Admin';
    fetchOrderDetail(id);
    return () => clearDetail();
  }, [id, fetchOrderDetail, clearDetail]);

  const isLoading = detailStatus === 'idle' || detailStatus === 'loading';
  const payment = latestPayment(detail);
  const orderTransitions = detail ? allowedOrderTransitions(detail.status) : [];
  const paymentTransitions = payment ? allowedPaymentTransitions(payment.status) : [];
  const shippingAddress = detail?.addresses?.find((address) => address.type === 'SHIPPING') ?? null;
  const billingAddress = detail?.addresses?.find((address) => address.type === 'BILLING') ?? null;

  const refetchAuthoritative = async () => {
    await fetchOrderDetail(id);
  };

  const runStatusMutation = async (next) => {
    if (!detail?.id || pendingAction) return;
    setPendingAction(`status:${next}`);
    try {
      const record = await updateOrderStatus(detail.id, next);
      syncOrder(record);
      if (next === 'CANCELLED') {
        toast.success(`Order ${detail.orderNumber} cancelled — stock restored.`);
      } else {
        toast.success(`Order ${detail.orderNumber} moved to ${next}.`);
      }
    } catch (mutationError) {
      toast.error(mutationError?.message ?? 'Status update failed. Please try again.');
      await refetchAuthoritative();
    } finally {
      setPendingAction(null);
      setConfirm(null);
    }
  };

  const runPaymentMutation = async (next) => {
    if (!detail?.id || pendingAction) return;
    setPendingAction(`payment:${next}`);
    try {
      const record = await updateOrderPaymentStatus(detail.id, next);
      syncOrder(record);
      toast.success(`Payment for ${detail.orderNumber} marked ${next}.`);
    } catch (mutationError) {
      toast.error(mutationError?.message ?? 'Payment update failed. Please try again.');
      await refetchAuthoritative();
    } finally {
      setPendingAction(null);
      setConfirm(null);
    }
  };

  const requestTransition = (kind, next) => {
    const needsConfirm = (kind === 'status' && next === 'CANCELLED') || (kind === 'payment' && next === 'REFUNDED');
    if (needsConfirm) {
      setConfirm({ kind, next });
      return;
    }
    if (kind === 'status') void runStatusMutation(next);
    else void runPaymentMutation(next);
  };

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/orders"
        className="inline-flex min-h-[44px] w-fit items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground hover:no-underline"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Back to orders
      </Link>

      {isLoading ? (
        <div role="status" aria-label="Loading order" className="flex flex-col gap-3">
          <div aria-hidden="true" className="h-10 w-2/3 animate-pulse rounded-lg bg-surface-muted" />
          {[0, 1, 2].map((index) => (
            <div key={index} aria-hidden="true" className="h-32 animate-pulse rounded-xl bg-surface-muted" />
          ))}
        </div>
      ) : detailError || !detail ? (
        detailError?.status === 404 || detailError?.code === 'ORDER_NOT_FOUND' ? (
          <EmptyState
            icon={ReceiptText}
            title="Order not found"
            message="This order does not exist or is no longer accessible. It may have an incorrect link — return to the orders list."
          />
        ) : (
          <ErrorState
            title="Couldn’t load the order"
            message={detailError?.message}
            onRetry={refetchAuthoritative}
          />
        )
      ) : (
        <>
          <PageHeader
            title={detail.orderNumber}
            description={`Placed ${formatDateTime(detail.createdAt)} · ${orderItemCount(detail)} items`}
            meta={
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <OrderStatusBadge status={detail.status} />
                {payment ? (
                  <>
                    <PaymentStatusBadge status={payment.status} />
                    <PaymentMethodBadge method={payment.method} />
                  </>
                ) : null}
              </span>
            }
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Order status">
              <p className="text-sm text-muted-foreground">
                Current status: <span className="font-semibold text-foreground">{detail.status}</span>
              </p>
              {orderTransitions.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {detail.status} is terminal — this order cannot move to another state.
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Advance order status">
                  {orderTransitions.map((next) => {
                    const actionKey = `status:${next}`;
                    const isDestructive = next === 'CANCELLED';
                    return (
                      <Button
                        key={next}
                        variant={isDestructive ? 'destructive' : 'secondary'}
                        size="sm"
                        loading={pendingAction === actionKey}
                        disabled={pendingAction !== null}
                        onClick={() => requestTransition('status', next)}
                        aria-label={isDestructive ? `Cancel order ${detail.orderNumber}` : `Move order to ${next}`}
                      >
                        {isDestructive ? 'Cancel order' : `Mark ${next.charAt(0) + next.slice(1).toLowerCase()}`}
                      </Button>
                    );
                  })}
                </div>
              )}
              {detail.status !== 'CANCELLED' && detail.status !== 'DELIVERED' ? (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Cancelling restores the ordered quantities to inventory; the payment record is left untouched.
                </p>
              ) : null}
            </Section>

            <Section title="Payment">
              {payment ? (
                <>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Method</dt>
                    <dd className="font-medium text-foreground">{payment.method === 'CASH_ON_DELIVERY' ? 'Cash on delivery' : payment.method}</dd>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd><PaymentStatusBadge status={payment.status} /></dd>
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="font-semibold tabular-nums text-foreground">{formatINR(payment.amount)}</dd>
                  </dl>
                  {paymentTransitions.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {payment.status} is terminal — this payment cannot change state.
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Update payment status">
                      {paymentTransitions.map((next) => {
                        const actionKey = `payment:${next}`;
                        return (
                          <Button
                            key={next}
                            variant={next === 'REFUNDED' ? 'destructive' : 'secondary'}
                            size="sm"
                            loading={pendingAction === actionKey}
                            disabled={pendingAction !== null}
                            onClick={() => requestTransition('payment', next)}
                            aria-label={`Mark payment ${next} for order ${detail.orderNumber}`}
                          >
                            Mark {next.charAt(0) + next.slice(1).toLowerCase()}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Status only — there is no payment gateway. Marking refunded records a manual refund.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">This order has no payment record.</p>
              )}
            </Section>
          </div>

          <Section title="Customer">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium text-foreground">{customerDisplayName(detail.customer)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium text-foreground">{detail.customer?.email ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="font-medium text-foreground">{detail.customer?.phone ?? '—'}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Items">
            <Table caption={`Items of order ${detail.orderNumber}`} columns={ITEM_COLUMNS} minWidth="min-w-[720px]">
              {detail.items.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-surface-muted/50">
                  <td className="px-4 py-3">
                    <OrderItemThumb item={item} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-foreground">{item.productName}</p>
                    {item.variantName ? <p className="text-xs text-muted-foreground">{item.variantName}</p> : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.sku}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{item.quantity}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatINR(item.unitPrice)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{formatINR(item.lineTotal)}</td>
                </tr>
              ))}
            </Table>
            <dl className="ml-auto mt-4 grid max-w-xs grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="text-right tabular-nums text-foreground">{formatINR(detail.subtotal)}</dd>
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="text-right tabular-nums text-foreground">{formatINR(detail.discountTotal)}</dd>
              <dt className="text-muted-foreground">Shipping</dt>
              <dd className="text-right tabular-nums text-foreground">{formatINR(detail.shippingTotal)}</dd>
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="text-right tabular-nums text-foreground">{formatINR(detail.taxTotal)}</dd>
              <dt className="font-semibold text-foreground">Grand total</dt>
              <dd className="text-right font-semibold tabular-nums text-foreground">{formatINR(detail.grandTotal)}</dd>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Totals are server-calculated and shown as stored.</p>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Shipping address">
              {shippingAddress ? <AddressBlock address={shippingAddress} /> : <p className="text-sm text-muted-foreground">No shipping snapshot.</p>}
            </Section>
            <Section title="Billing address">
              {billingAddress ? <AddressBlock address={billingAddress} /> : <p className="text-sm text-muted-foreground">No billing snapshot — single-address checkout.</p>}
            </Section>
          </div>

          <Section title="Record">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Order ID</dt>
                <dd className="font-mono text-xs text-foreground">{detail.id}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Currency</dt>
                <dd className="font-medium text-foreground">{detail.currency}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Created</dt>
                <dd className="font-medium text-foreground">{formatDateTime(detail.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last updated</dt>
                <dd className="font-medium text-foreground">{formatDateTime(detail.updatedAt)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Per-order status history is not stored by the backend — only the current state and timestamps above are authoritative.
            </p>
          </Section>
        </>
      )}

      {confirm ? (
        <Modal
          title={confirm.kind === 'status' ? `Cancel order ${detail?.orderNumber}?` : `Mark payment refunded?`}
          onClose={() => pendingAction === null && setConfirm(null)}
          persistent={pendingAction !== null}
        >
          {confirm.kind === 'status' ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Order <span className="font-semibold text-foreground">{detail?.orderNumber}</span> is currently{' '}
              <span className="font-semibold text-foreground">{detail?.status}</span>. Cancelling restores{' '}
              {orderItemCount(detail)} ordered units to inventory via the backend ledger. The payment record is
              left untouched. This cannot be undone.
            </p>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              This records a manual refund of <span className="font-semibold text-foreground">{formatINR(payment?.amount)}</span>{' '}
              for order <span className="font-semibold text-foreground">{detail?.orderNumber}</span>. No money moves
              automatically — there is no payment gateway. This cannot be undone.
            </p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={pendingAction !== null}>
              Keep as is
            </Button>
            <Button
              variant="destructive"
              loading={pendingAction !== null}
              onClick={() => (confirm.kind === 'status' ? runStatusMutation(confirm.next) : runPaymentMutation(confirm.next))}
            >
              {confirm.kind === 'status' ? 'Yes, cancel order' : 'Yes, mark refunded'}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

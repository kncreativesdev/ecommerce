import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  CircleDashed,
  Cog,
  Image as ImageIcon,
  MapPin,
  Navigation,
  Package,
  Truck,
  XCircle,
} from 'lucide-react';
import { formatINR } from '../../lib/format.js';
import { orderStatusLabel } from '../../lib/orderStatus.js';
import { resolveImageUrl } from '../../services/media.service.js';
import { env } from '../../config/env.js';
import { cn } from '../../lib/cn.js';

/**
 * Status badge meta: icon + tone only. Friendly labels live in the single
 * definition (`lib/orderStatus.js`) shared with the timeline — never
 * duplicated here. `SHIPPED` is the legacy code for the `DISPATCHED` step.
 */
const STATUS_META = {
  PENDING: { icon: CircleDashed, classes: 'bg-warning/15 text-warning' },
  CONFIRMED: { icon: CheckCircle2, classes: 'bg-primary/10 text-primary' },
  PROCESSING: { icon: Cog, classes: 'bg-primary/10 text-primary' },
  SHIPPED: { icon: Truck, classes: 'bg-secondary text-secondary-foreground' },
  DISPATCHED: { icon: Package, classes: 'bg-secondary text-secondary-foreground' },
  IN_TRANSIT: { icon: Truck, classes: 'bg-secondary text-secondary-foreground' },
  ARRIVED_IN_CITY: { icon: MapPin, classes: 'bg-secondary text-secondary-foreground' },
  OUT_FOR_DELIVERY: { icon: Navigation, classes: 'bg-secondary text-secondary-foreground' },
  DELIVERED: { icon: CheckCircle2, classes: 'bg-success/15 text-success' },
  COMPLETED: { icon: CheckCircle2, classes: 'bg-success/15 text-success' },
  CANCELLED: { icon: XCircle, classes: 'bg-destructive/15 text-destructive' },
};

/** Order status badge — always icon + text, never color-only. */
export function OrderStatusBadge({ status, className }) {
  const meta = STATUS_META[status] ?? { icon: Package, classes: 'bg-secondary text-secondary-foreground' };
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        meta.classes,
        className,
      )}
    >
      <Icon size={13} aria-hidden="true" />
      {orderStatusLabel(status)}
    </span>
  );
}

/** One-line address snapshot renderer (immutable server snapshot). */
export function AddressSnapshot({ address }) {
  if (!address) return null;
  return (
    <address className="text-sm not-italic leading-6 text-muted-foreground">
      <span className="font-semibold text-foreground">{address.fullName}</span>
      <br />
      {address.addressLine1}
      {address.addressLine2 ? `, ${address.addressLine2}` : ''}, {address.city}, {address.state}{' '}
      {address.postalCode}, {address.country}
      <br />
      {address.phone}
    </address>
  );
}

/** Right-aligned tabular totals from server values verbatim. */
export function OrderTotals({ order }) {
  if (!order) return null;
  const rows = [
    ['Subtotal', order.subtotal],
    order.discountTotal != null && order.discountTotal !== '0.00' ? ['Discount', `−${formatINR(order.discountTotal)}`] : null,
    order.shippingTotal != null && order.shippingTotal !== '0.00' ? ['Shipping', formatINR(order.shippingTotal)] : null,
    order.taxTotal != null && order.taxTotal !== '0.00' ? ['Tax', formatINR(order.taxTotal)] : null,
  ].filter(Boolean);
  return (
    <dl className="flex flex-col gap-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums text-foreground">{value}</dd>
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-border pt-2">
        <dt className="font-bold text-foreground">Total</dt>
        <dd className="text-lg font-extrabold tabular-nums text-foreground">
          {formatINR(order.grandTotal)} {order.currency === 'INR' || !order.currency ? '' : order.currency}
        </dd>
      </div>
    </dl>
  );
}

/** Payment snapshot line (COD display-only — no payment actions exist). */
export function PaymentSnapshot({ payment }) {
  if (!payment) return null;
  const method = payment.method === 'CASH_ON_DELIVERY' ? 'Cash on Delivery' : (payment.method ?? 'Payment');
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <span className="inline-flex items-center rounded-full bg-foreground px-2.5 py-1 text-[11px] font-bold text-background">
        {method}
      </span>
      <span className="font-semibold tabular-nums text-foreground">{formatINR(payment.amount)}</span>
      <span className="text-muted-foreground">· {payment.status ?? 'PENDING'}</span>
    </p>
  );
}

/** "View order" link cell used by list rows. */
export function OrderLink({ orderId, label = 'View details' }) {
  return (
    <Link
      to={`/account/orders/${orderId}`}
      className="text-sm font-semibold text-accent-link hover:no-underline"
    >
      {label}
    </Link>
  );
}

/**
 * Historical purchased-variant thumbnail from the order snapshot
 * (`imageStoragePath`, immutable). Pre-snapshot orders carry null and
 * render the neutral placeholder — live variant media is never consulted
 * for history, so replaced/deactivated media cannot rewrite old orders.
 */
export function OrderItemThumb({ item }) {
  const url = resolveImageUrl(
    item?.imageStoragePath ? { storagePath: item.imageStoragePath } : null,
    env.mediaBaseUrl,
  );
  if (!url) {
    return (
      <span
        aria-label="No image recorded for this item"
        className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground"
      >
        <ImageIcon size={22} aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="h-14 w-14 shrink-0 rounded-xl border border-border bg-surface-muted object-cover"
    />
  );
}

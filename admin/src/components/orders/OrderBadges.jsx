import { Badge } from '../ui/Badge.jsx';
import { orderStatusLabel } from '../../utils/orderLifecycle.js';

/**
 * Order-domain badges. Tones follow the existing design system (`Badge`
 * tones only); every badge renders a text label, never color alone.
 * Labels match `ORDER_STATUS_LABELS` (friendly lifecycle copy).
 */

const ORDER_STATUS_TONES = {
  PENDING: 'warning',
  CONFIRMED: 'info',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DISPATCHED: 'info',
  IN_TRANSIT: 'info',
  ARRIVED_IN_CITY: 'info',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

const PAYMENT_STATUS_TONES = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'destructive',
  REFUNDED: 'neutral',
};

function humanize(value) {
  if (typeof value !== 'string' || value === '') return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function OrderStatusBadge({ status }) {
  return <Badge tone={ORDER_STATUS_TONES[status] ?? 'neutral'}>{orderStatusLabel(status)}</Badge>;
}

export function PaymentStatusBadge({ status }) {
  return <Badge tone={PAYMENT_STATUS_TONES[status] ?? 'neutral'}>{humanize(status)}</Badge>;
}

export function PaymentMethodBadge({ method }) {
  return <Badge tone="neutral">{humanize(method)}</Badge>;
}

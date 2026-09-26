import {
  ORDER_STATUS_SEQUENCE,
  normalizeLifecycleStatus,
  orderStatusLabel,
} from '../../lib/orderStatus.js';
import { formatDate } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

/**
 * Customer order timeline — history-driven ONLY.
 *
 * Props: `{ order }` with `status`, `createdAt`, and `statusHistory[]`
 * (oldest-first `{ status, note, createdAt }`, per the orders contract).
 * - Done steps = statuses present in `statusHistory` (`SHIPPED` normalized
 *   to the `DISPATCHED` position). Each shows ✓ + friendly label +
 *   timestamp + note (when present).
 * - The current `order.status` step is highlighted (●).
 * - Future steps show ○ + 'Pending' with NO timestamp — never fabricated.
 * - Legacy orders (`statusHistory: []`) render a fallback card with the
 *   current friendly status + placed date and an honest "history isn't
 *   available" note — never invented rows.
 * - Cancelled orders render placed + cancelled steps with a banner.
 */
function formatTimelineTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

const cardClass = 'rounded-2xl border border-border bg-card p-5 shadow-sm';

function StepMarker({ state }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
        state === 'done' && 'bg-success/15 text-success',
        state === 'current' && 'bg-primary/15 text-primary ring-2 ring-primary/40',
        state === 'pending' && 'bg-surface-muted text-muted-foreground',
      )}
    >
      {state === 'done' ? '✓' : state === 'current' ? '●' : '○'}
    </span>
  );
}

function TimelineShell({ children, label = 'Order timeline' }) {
  return (
    <section aria-label={label} className={cardClass}>
      <h2 className="mb-4 text-base font-bold text-foreground">Tracking</h2>
      {children}
    </section>
  );
}

function LegacyFallback({ order }) {
  return (
    <TimelineShell>
      <p className="text-sm font-semibold text-foreground">{orderStatusLabel(order.status)}</p>
      <p className="mt-1 text-xs text-muted-foreground">Placed {formatDate(order.createdAt)}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Detailed tracking history isn&apos;t available for this order.
      </p>
    </TimelineShell>
  );
}

function CancelledTimeline({ order, history }) {
  const cancelledEntry = [...history].reverse().find((entry) => entry?.status === 'CANCELLED') ?? null;

  const steps =
    history.length > 0
      ? history.map((entry, index) => ({
          // History order is authoritative (oldest-first per contract).
          key: entry?.id ?? `${entry?.status}-${index}`,
          label: orderStatusLabel(entry?.status),
          timestamp: entry?.createdAt ?? null,
          note: entry?.note ?? null,
        }))
      : [
          { key: 'placed', label: orderStatusLabel('PENDING'), timestamp: order.createdAt, note: null },
          { key: 'cancelled', label: orderStatusLabel('CANCELLED'), timestamp: null, note: null },
        ];

  return (
    <TimelineShell>
      <p role="status" className="mb-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
        This order was cancelled
        {cancelledEntry?.createdAt ? ` on ${formatDate(cancelledEntry.createdAt)}` : ''}.
      </p>
      <ol className="flex flex-col">
        {steps.map((step, index) => (
          <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className="absolute bottom-0 left-[9px] top-6 w-px bg-border" />
            ) : null}
            <StepMarker state="done" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                <span className="sr-only">Completed: </span>
                {step.label}
              </p>
              {step.timestamp ? (
                <time dateTime={step.timestamp} className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                  {formatTimelineTimestamp(step.timestamp)}
                </time>
              ) : null}
              {step.note ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      {history.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Detailed tracking history isn&apos;t available for this order.
        </p>
      ) : null}
    </TimelineShell>
  );
}

export function OrderTimeline({ order }) {
  if (!order) return null;
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const current = normalizeLifecycleStatus(order?.status);

  if (current === 'CANCELLED') {
    return <CancelledTimeline order={order} history={history} />;
  }

  if (history.length === 0) {
    return <LegacyFallback order={order} />;
  }

  // Done = present in history (normalized; last occurrence wins for timestamp/note).
  const byStatus = new Map();
  for (const entry of history) {
    if (!entry?.status || entry.status === 'CANCELLED') continue;
    byStatus.set(normalizeLifecycleStatus(entry.status), entry);
  }

  return (
    <TimelineShell>
      <ol className="flex flex-col">
        {ORDER_STATUS_SEQUENCE.map((status, index) => {
          const entry = byStatus.get(status) ?? null;
          const isCurrent = status === current;
          const state = entry ? (isCurrent ? 'current' : 'done') : isCurrent ? 'current' : 'pending';
          return (
            <li key={status} className="relative flex gap-3 pb-5 last:pb-0">
              {index < ORDER_STATUS_SEQUENCE.length - 1 ? (
                <span aria-hidden="true" className="absolute bottom-0 left-[9px] top-6 w-px bg-border" />
              ) : null}
              <StepMarker state={state} />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm',
                    state === 'pending' ? 'font-medium text-muted-foreground' : 'font-semibold text-foreground',
                    isCurrent && 'text-primary',
                  )}
                >
                  <span className="sr-only">
                    {state === 'current' ? 'Current: ' : state === 'done' ? 'Completed: ' : 'Upcoming: '}
                  </span>
                  {orderStatusLabel(status)}
                </p>
                {entry?.createdAt ? (
                  <time dateTime={entry.createdAt} className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                    {formatTimelineTimestamp(entry.createdAt)}
                  </time>
                ) : state === 'pending' ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">Pending</p>
                ) : null}
                {entry?.note ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.note}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </TimelineShell>
  );
}

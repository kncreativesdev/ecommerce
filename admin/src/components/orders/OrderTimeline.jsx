import { Check } from 'lucide-react';
import {
  ORDER_STATUS_SEQUENCE,
  normalizeLifecycleStatus,
  orderStatusLabel,
} from '../../utils/orderLifecycle.js';
import { formatDateTime } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

/**
 * Order fulfilment timeline (admin): renders ONLY the authoritative
 * backend `statusHistory[]` (oldest-first `{ id, status, previousStatus,
 * note, createdAt }`). No rows are ever invented client-side.
 *
 * - Canonical SEQUENCE steps render in order; a step is "done" only when
 *   an explicit history record exists for it (SHIPPED normalizes to
 *   DISPATCHED). Steps without a record render as pending WITHOUT
 *   timestamps.
 * - Each done step shows a check icon, the friendly label, the recorded
 *   timestamp (`formatDateTime`), and the note when present.
 * - The current status step is highlighted.
 * - Cancelled orders show their history plus a terminal cancelled banner
 *   instead of the full pending chain.
 * - Legacy orders (`statusHistory` empty) show a graceful fallback box:
 *   current status + placed/updated dates and the text
 *   "Detailed tracking history is not available for this order."
 */
export function OrderTimeline({ order }) {
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  const currentStatus = order?.status ?? null;
  const normalizedCurrent = currentStatus ? normalizeLifecycleStatus(currentStatus) : null;

  if (history.length === 0) {
    return (
      <div className="rounded-lg bg-surface-muted/50 p-4 text-sm leading-6">
        <p className="font-semibold text-foreground">
          Current status: {currentStatus ? orderStatusLabel(currentStatus) : '—'}
        </p>
        <p className="mt-1 text-muted-foreground">
          Placed {formatDateTime(order?.createdAt)} · Updated {formatDateTime(order?.updatedAt)}
        </p>
        <p className="mt-1 text-muted-foreground">Detailed tracking history is not available for this order.</p>
      </div>
    );
  }

  if (currentStatus === 'CANCELLED') {
    const cancelledRecord = [...history].reverse().find((entry) => entry?.status === 'CANCELLED') ?? null;
    return (
      <div className="flex flex-col gap-2">
        <ol aria-label="Order status history" className="flex flex-col gap-2">
          {history.map((entry) => (
            <li
              key={entry?.id ?? `${entry?.status}-${entry?.createdAt}`}
              className="flex items-start gap-3 rounded-lg border border-border px-3.5 py-2.5"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted-foreground"
              >
                <Check size={14} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  {orderStatusLabel(entry?.status)}
                </span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {formatDateTime(entry?.createdAt)}
                </span>
                {entry?.note ? (
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{entry.note}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
        <div
          role="status"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm"
        >
          <p className="font-semibold text-destructive">Order cancelled</p>
          {cancelledRecord ? (
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {formatDateTime(cancelledRecord.createdAt)}
              {cancelledRecord.note ? ` · ${cancelledRecord.note}` : ''}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const recordByStep = new Map();
  for (const entry of history) {
    const normalized = normalizeLifecycleStatus(entry?.status);
    if (!normalized) continue;
    if (!recordByStep.has(normalized)) {
      recordByStep.set(normalized, entry);
    }
  }

  return (
    <ol aria-label="Order fulfilment timeline" className="flex flex-col">
      {ORDER_STATUS_SEQUENCE.map((step, index) => {
        const record = recordByStep.get(step) ?? null;
        const isDone = record !== null;
        const isCurrent = normalizedCurrent === step;
        const isLast = index === ORDER_STATUS_SEQUENCE.length - 1;
        return (
          <li key={step} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast ? (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-[13px] top-7 h-[calc(100%-1.5rem)] w-0.5',
                  isDone ? 'bg-success/40' : 'bg-border',
                )}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                isDone
                  ? 'border-success bg-success/15 text-success'
                  : 'border-border bg-surface-muted text-muted-foreground',
                isCurrent && 'ring-2 ring-primary/40',
              )}
            >
              {isDone ? <Check size={15} /> : <span className="h-2 w-2 rounded-full bg-current" />}
            </span>
            <span className="min-w-0 pb-0.5">
              <span
                className={cn(
                  'block text-sm',
                  isDone || isCurrent ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
                )}
              >
                {orderStatusLabel(step)}
                {isCurrent ? (
                  <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    Current
                  </span>
                ) : null}
              </span>
              {isDone ? (
                <>
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(record.createdAt)}
                  </span>
                  {record.note ? (
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{record.note}</span>
                  ) : null}
                </>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

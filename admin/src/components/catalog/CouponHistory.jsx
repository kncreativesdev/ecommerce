import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { Badge } from '../ui/Badge.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { ErrorState } from '../ui/ErrorState.jsx';
import { Pagination } from '../ui/Pagination.jsx';
import { fetchCouponHistory } from '../../services/coupon.service.js';
import { formatDateTime } from '../../lib/format.js';

const HISTORY_PAGE_SIZE = 10;

const ACTION_TONES = {
  CREATED: 'info',
  UPDATED: 'neutral',
  DEACTIVATED: 'warning',
  REACTIVATED: 'success',
  DELETED: 'destructive',
};

const ACTION_LABELS = {
  CREATED: 'Created',
  UPDATED: 'Updated',
  DEACTIVATED: 'Deactivated',
  REACTIVATED: 'Reactivated',
  DELETED: 'Deleted',
};

const FIELD_LABELS = {
  code: 'Code',
  description: 'Description',
  discountType: 'Discount type',
  discountValue: 'Discount value',
  minimumOrderAmount: 'Minimum order',
  maximumDiscountAmount: 'Maximum discount',
  usageLimit: 'Usage limit',
  startsAt: 'Starts at',
  expiresAt: 'Expires at',
  isActive: 'Active',
  productIds: 'Products',
};

function formatHistoryValue(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'isActive') return value ? 'Active' : 'Inactive';
  if (field === 'startsAt' || field === 'expiresAt') return formatDateTime(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    return `${value.length} ${value.length === 1 ? 'product' : 'products'}`;
  }
  return String(value);
}

function ChangeRow({ field, before, after }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <dt className="font-semibold text-foreground">{FIELD_LABELS[field] ?? field}</dt>
      <dd className="min-w-0 break-words tabular-nums text-muted-foreground">
        {formatHistoryValue(field, before)}
        <span aria-hidden="true" className="mx-1.5 font-bold text-foreground">→</span>
        {formatHistoryValue(field, after)}
      </dd>
    </div>
  );
}

function SnapshotSummary({ snapshot }) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const entries = Object.entries(snapshot).filter(([field]) => FIELD_LABELS[field]);
  if (entries.length === 0) return null;
  return (
    <dl className="flex flex-col gap-1">
      {entries.map(([field, value]) => (
        <div key={field} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <dt className="font-semibold text-foreground">{FIELD_LABELS[field]}</dt>
          <dd className="min-w-0 break-words tabular-nums text-muted-foreground">
            {formatHistoryValue(field, value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function HistoryEntry({ entry }) {
  const changes = entry?.metadata?.changes;
  const snapshot = entry?.metadata?.snapshot;
  const hasChanges = changes && typeof changes === 'object' && Object.keys(changes).length > 0;
  const actorEmail = entry?.actor?.email ?? null;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={ACTION_TONES[entry.action] ?? 'neutral'}>
            {ACTION_LABELS[entry.action] ?? entry.action}
          </Badge>
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDateTime(entry.createdAt)}
          </span>
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={actorEmail ?? undefined}>
          {actorEmail ?? 'Unknown admin'}
        </span>
      </div>
      {hasChanges ? (
        <dl className="flex flex-col gap-1 border-t border-border pt-2">
          {Object.entries(changes).map(([field, { before, after }]) => (
            <ChangeRow key={field} field={field} before={before} after={after} />
          ))}
        </dl>
      ) : null}
      {!hasChanges && snapshot ? <SnapshotSummary snapshot={snapshot} /> : null}
      {snapshot ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold hover:text-foreground">
            Full {entry.action === 'CREATED' ? 'configuration' : 'snapshot'}
          </summary>
          <pre className="mt-1.5 max-h-56 overflow-auto rounded-lg bg-surface-muted/60 p-2.5 font-mono text-[11px] leading-5">
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </details>
      ) : null}
    </li>
  );
}

/**
 * Coupon lifecycle audit trail, rendered as modal content (newest first).
 * Mounted on demand by the coupon edit page's history action — mirroring
 * the Inventory Stock History pattern — so no request fires while closed
 * and every open refetches fresh rows. Server-driven
 * (`GET /coupons/:id/history`); administrative events only — customer
 * coupon usage (`CouponUsage`) never appears here. Stacked cards reflow on
 * narrow viewports with no clipped timestamps or actor info.
 */
export function CouponHistory({ couponId }) {
  const [entries, setEntries] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: HISTORY_PAGE_SIZE, total: 0, totalPages: 1 });
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [prevCouponId, setPrevCouponId] = useState(couponId);

  // Render-time reset when the coupon changes (sanctioned derived-state
  // pattern); the effect below only syncs the async fetch.
  if (prevCouponId !== couponId) {
    setPrevCouponId(couponId);
    setEntries([]);
    setPagination({ page: 1, limit: HISTORY_PAGE_SIZE, total: 0, totalPages: 1 });
    setLoadError(null);
    setStatus('loading');
    setPage(1);
  }

  const goToPage = (next) => {
    setStatus('loading');
    setPage(next);
  };

  const retry = () => {
    setLoadError(null);
    setStatus('loading');
    setReloadToken((token) => token + 1);
  };

  useEffect(() => {
    if (!couponId) return undefined;
    let cancelled = false;
    fetchCouponHistory(couponId, { page, limit: HISTORY_PAGE_SIZE })
      .then(({ history, pagination: meta }) => {
        if (cancelled) return;
        setEntries(Array.isArray(history) ? history : []);
        setPagination(meta ?? { page, limit: HISTORY_PAGE_SIZE, total: 0, totalPages: 1 });
        setStatus('success');
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setLoadError(fetchError);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [couponId, page, reloadToken]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-5 text-muted-foreground">
        Administrative changes to this coupon, newest first. Customer usage is tracked separately.
      </p>

      {status === 'loading' ? (
        <div role="status" aria-label="Loading coupon history" className="flex flex-col gap-2">
          {[0, 1].map((index) => (
            <div key={index} aria-hidden="true" className="h-20 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : status === 'error' ? (
        <ErrorState
          title="Couldn’t load coupon history"
          message={loadError?.message ?? 'Please try again.'}
          onRetry={retry}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={History}
          title="No history yet"
          message="Changes made to this coupon will appear here."
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <HistoryEntry key={entry.id} entry={entry} />
            ))}
          </ul>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            itemLabel="events"
            onPageChange={goToPage}
          />
        </>
      )}
    </div>
  );
}

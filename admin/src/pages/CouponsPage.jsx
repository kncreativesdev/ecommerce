import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Power, RotateCcw, Search, TicketPercent, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCouponStore } from '../stores/useCouponStore.js';
import {
  COUPON_SCOPES,
  COUPON_STATUS_TONES,
  couponDerivedStatus,
  couponDiscountSummary,
  couponProductIds,
  couponStatusLabel,
  couponUsageSummary,
} from '../utils/coupons.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { formatDate, formatINR } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * Coupon Management (`/catalog/coupons`): real backend data only, via
 * ADMIN-only `GET /coupons`. Scope (All/Active/Inactive), search
 * (code/description), and pagination are SERVER-driven — every control
 * maps to a documented query param; the store refetches on change.
 *
 * Availability badges (Active/Inactive/Scheduled/Expired) derive from the
 * actual `isActive`/`startsAt`/`expiresAt` fields — no persisted lifecycle
 * enum exists. Lifecycle is `PATCH { isActive }` (deactivate confirm-gated,
 * reactivate direct); delete is a server-confirmed hard delete refused
 * with `409` once the coupon has been used.
 */
const COUPON_COLUMNS = [
  { key: 'code', label: 'Code' },
  { key: 'discount', label: 'Discount' },
  { key: 'validity', label: 'Validity' },
  { key: 'usage', label: 'Usage' },
  { key: 'eligibility', label: 'Eligibility' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions', numeric: true },
];

function validitySummary(coupon) {
  const from = coupon?.startsAt ? formatDate(coupon.startsAt) : null;
  const to = coupon?.expiresAt ? formatDate(coupon.expiresAt) : null;
  if (from && to) return `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return 'Anytime';
}

export function CouponsPage() {
  const coupons = useCouponStore((state) => state.coupons);
  const pagination = useCouponStore((state) => state.pagination);
  const scope = useCouponStore((state) => state.scope);
  const search = useCouponStore((state) => state.search);
  const status = useCouponStore((state) => state.status);
  const refreshing = useCouponStore((state) => state.refreshing);
  const error = useCouponStore((state) => state.error);
  const ensureCoupons = useCouponStore((state) => state.ensureCoupons);
  const refreshCoupons = useCouponStore((state) => state.refreshCoupons);
  const setScope = useCouponStore((state) => state.setScope);
  const setSearch = useCouponStore((state) => state.setSearch);
  const clearSearch = useCouponStore((state) => state.clearSearch);
  const setPage = useCouponStore((state) => state.setPage);
  const activateCoupon = useCouponStore((state) => state.activateCoupon);
  const deactivateCoupon = useCouponStore((state) => state.deactivateCoupon);
  const deleteCoupon = useCouponStore((state) => state.deleteCoupon);

  // Search input stays local until submitted (avoids a request per
  // keystroke); scope/page apply immediately (server fetch each time).
  const [searchDraft, setSearchDraft] = useState(search);
  const [deactivating, setDeactivating] = useState(null); // coupon | null
  const [deleting, setDeleting] = useState(null); // coupon | null
  const [mutating, setMutating] = useState(false);
  const [activatingId, setActivatingId] = useState(null);

  useEffect(() => {
    document.title = 'Coupons — Tech Pulse Admin';
    ensureCoupons();
  }, [ensureCoupons]);

  // `status: loading` is the INITIAL fetch only (the store keeps it off
  // for background refetches). Filter/search/page changes set
  // `refreshing` while the current rows stay on screen — no full skeleton.
  const isInitialLoading = status === 'idle' || status === 'loading';
  const hasRows = coupons.length > 0;
  const controlsDisabled = isInitialLoading || refreshing;

  const applySearch = () => {
    setSearch(searchDraft.trim());
  };

  const handleClearSearch = () => {
    setSearchDraft('');
    clearSearch();
  };

  const handleActivate = async (coupon) => {
    if (!coupon?.id || activatingId) return;
    setActivatingId(coupon.id);
    try {
      await activateCoupon(coupon.id);
      toast.success(`“${coupon.code}” reactivated — available for validation.`);
    } catch (activateError) {
      toast.error(activateError?.message ?? 'Reactivation failed. Please try again.');
    } finally {
      setActivatingId(null);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivating?.id) return;
    setMutating(true);
    try {
      await deactivateCoupon(deactivating.id);
      toast.success(`“${deactivating.code}” deactivated — rejected by validation.`);
      setDeactivating(null);
    } catch (deactivateError) {
      toast.error(deactivateError?.message ?? 'Deactivation failed. Please try again.');
    } finally {
      setMutating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting?.id) return;
    setMutating(true);
    try {
      await deleteCoupon(deleting.id);
      toast.success(`“${deleting.code}” deleted.`);
    } catch (deleteError) {
      // 409 COUPON_IN_USE (already used → deactivate instead) and 404
      // surface the real backend message; the row stays untouched except
      // a 404 (already gone server-side) which triggers a refresh.
      toast.error(deleteError?.message ?? 'Delete failed. Please try again.');
      if (deleteError?.status === 404 || deleteError?.code === 'COUPON_NOT_FOUND') {
        refreshCoupons();
      }
    } finally {
      setDeleting(null);
      setMutating(false);
    }
  };

  const meta = isInitialLoading
    ? 'Loading coupons…'
    : refreshing
      ? `Refreshing… · ${pagination.total} ${pagination.total === 1 ? 'coupon' : 'coupons'}`
      : `${pagination.total} ${pagination.total === 1 ? 'coupon' : 'coupons'}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Coupons"
        meta={meta}
        actions={
          <Link
            to="/catalog/coupons/new"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 hover:no-underline"
          >
            <Plus size={17} aria-hidden="true" />
            Add Coupon
          </Link>
        }
      />

      {/* Filter/search controls stay mounted (and usable, unless a
          refresh is in flight) once the initial load resolves — they are
          hidden only for the initial skeleton / initial failure. */}
      {!isInitialLoading && !(error && !hasRows) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div role="group" aria-label="Coupon status filter" className="inline-flex self-start rounded-lg border border-border bg-surface p-1">
            {COUPON_SCOPES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setScope(option.value)}
                aria-pressed={scope === option.value}
                disabled={controlsDisabled}
                className={cn(
                  'inline-flex min-h-[36px] cursor-pointer items-center rounded-md px-3.5 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60',
                  scope === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div role="search" className="relative w-full sm:max-w-md">
            <label htmlFor="coupon-search" className="sr-only">
              Search coupons by code or description
            </label>
            <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="coupon-search"
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applySearch();
              }}
              placeholder="Search code or description… (Enter to apply)"
              autoComplete="off"
              className="min-h-[44px] w-full rounded-lg border border-input bg-surface pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 hover:border-border-strong"
            />
            {searchDraft ? (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Clear search input"
                className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {search ? (
            <button
              type="button"
              onClick={handleClearSearch}
              className="inline-flex min-h-[44px] cursor-pointer items-center self-start rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              Clear search
            </button>
          ) : null}
        </div>
      )}

      {isInitialLoading ? (
        <div role="status" aria-label="Loading coupons" className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : hasRows ? (
        <>
          {error ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-foreground">
                {error.message} Showing previous results.
              </p>
              <Button variant="secondary" size="sm" onClick={() => refreshCoupons()}>
                Retry
              </Button>
            </div>
          ) : null}
          <div aria-busy={refreshing || undefined}>
          <Table caption="Coupons" columns={COUPON_COLUMNS} minWidth="min-w-[960px]">
            {coupons.map((coupon) => {
              const derived = couponDerivedStatus(coupon);
              const productIds = couponProductIds(coupon);
              return (
                <tr key={coupon.id} className="transition-colors hover:bg-surface-muted/50">
                  <td className="px-4 py-3">
                    <p className="font-mono font-semibold text-foreground">{coupon.code}</p>
                    {coupon.description ? (
                      <p className="truncate text-xs text-muted-foreground">{coupon.description}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-foreground">{couponDiscountSummary(coupon)}</p>
                    {coupon.minimumOrderAmount ? (
                      <p className="text-xs tabular-nums text-muted-foreground">Min. {formatINR(coupon.minimumOrderAmount)}</p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{validitySummary(coupon)}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">{couponUsageSummary(coupon)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {productIds.length === 0 ? 'All products' : `${productIds.length} ${productIds.length === 1 ? 'product' : 'products'}`}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={COUPON_STATUS_TONES[derived]}>{couponStatusLabel(derived)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center justify-end gap-1">
                      <Link
                        to={`/catalog/coupons/${coupon.id}/edit`}
                        aria-label={`Edit coupon ${coupon.code}`}
                        title={`Edit coupon ${coupon.code}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground hover:no-underline"
                      >
                        <Pencil size={17} aria-hidden="true" />
                      </Link>
                      {coupon.isActive ? (
                        <button
                          type="button"
                          onClick={() => setDeactivating(coupon)}
                          aria-label={`Deactivate coupon ${coupon.code}`}
                          title={`Deactivate coupon ${coupon.code}`}
                          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Power size={17} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleActivate(coupon)}
                          disabled={activatingId === coupon.id}
                          aria-label={`Reactivate coupon ${coupon.code}`}
                          title={`Reactivate coupon ${coupon.code}`}
                          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-success/10 hover:text-success disabled:cursor-wait disabled:opacity-60"
                        >
                          <RotateCcw size={17} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleting(coupon)}
                        aria-label={`Delete coupon ${coupon.code}`}
                        title={`Delete coupon ${coupon.code}`}
                        className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </Table>
          </div>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            itemLabel={pagination.total === 1 ? 'coupon' : 'coupons'}
            onPageChange={setPage}
            disabled={refreshing}
          />
        </>
      ) : error ? (
        <ErrorState title="Couldn’t load coupons" message={error.message} onRetry={() => refreshCoupons()} />
      ) : !search ? (
        <EmptyState
          icon={TicketPercent}
          title={scope === 'inactive' ? 'No inactive coupons' : 'No coupons yet'}
          message={
            scope === 'inactive'
              ? 'Every coupon is currently active. Deactivated coupons will appear here for review and reactivation.'
              : 'Create the first coupon. It becomes valid according to its active flag and validity window.'
          }
        />
      ) : (
        <EmptyState
          icon={TicketPercent}
          title="No coupons match"
          message={`Nothing matches “${search}” under the current filters. Try a different keyword or clear the search.`}
        />
      )}

      <div className="flex justify-start">
        <Button variant="secondary" onClick={() => refreshCoupons()} disabled={controlsDisabled}>
          Refresh list
        </Button>
      </div>

      {deactivating ? (
        <Modal title={`Deactivate “${deactivating.code}”?`} onClose={() => !mutating && setDeactivating(null)} persistent={mutating}>
          <p className="text-sm leading-6 text-muted-foreground">
            Deactivated coupons are rejected by validation (<span className="font-mono">COUPON_INACTIVE</span>) and
            stay visible under All/Inactive for review and reactivation. Usage history is kept.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeactivating(null)} disabled={mutating}>
              Keep coupon
            </Button>
            <Button variant="destructive" loading={mutating} onClick={handleDeactivate}>
              Yes, deactivate
            </Button>
          </div>
        </Modal>
      ) : null}

      {deleting ? (
        <Modal title={`Delete “${deleting.code}”?`} onClose={() => !mutating && setDeleting(null)} persistent={mutating}>
          <p className="text-sm leading-6 text-muted-foreground">
            This permanently removes the coupon{deleting.usedCount > 0 ? ` (used ${deleting.usedCount} time(s))` : ''}.
            The backend refuses deletion once a coupon has been used — deactivate it instead. Existing orders are
            never affected (they store no coupon reference).
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={mutating}>
              Keep coupon
            </Button>
            <Button variant="destructive" loading={mutating} onClick={handleDelete}>
              Yes, delete
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

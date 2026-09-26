import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Search, ShoppingCart, X } from 'lucide-react';
import { toast } from 'sonner';
import { useOrderStore } from '../stores/useOrderStore.js';
import { bulkUpdateOrderStatus } from '../services/order.service.js';
import { ORDER_STATUSES, PAYMENT_STATUSES, allowedOrderTransitions, customerDisplayName, latestPayment, orderItemCount, orderStatusLabel } from '../utils/orderLifecycle.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { OrderStatusBadge, PaymentMethodBadge, PaymentStatusBadge } from '../components/orders/OrderBadges.jsx';
import { formatDate, formatINR } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * Orders List (`/orders`): real backend data only, via ADMIN-only
 * `GET /orders/admin`. Filtering/sorting/pagination are SERVER-driven —
 * every control maps to a documented query param
 * (`status/paymentStatus/search/from/to/sortOrder`); the store refetches
 * on each change. No invented params, no client-side slicing.
 *
 * Columns show server-returned fields only: order number, customer
 * (brief), item count, server grand total, order/payment status, payment
 * method, placement date. Row action is a View link to `/orders/:id`
 * (rows are never pseudo-buttons).
 */
const ORDER_COLUMNS = [
  { key: 'select', label: 'Select' },
  { key: 'order', label: 'Order' },
  { key: 'customer', label: 'Customer' },
  { key: 'items', label: 'Items' },
  { key: 'total', label: 'Total' },
  { key: 'orderStatus', label: 'Order status' },
  { key: 'payment', label: 'Payment' },
  { key: 'placed', label: 'Placed' },
  { key: 'actions', label: 'Actions', numeric: true },
];

const selectClass =
  'min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30';
const dateInputClass =
  'min-h-[44px] rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30';

export function OrdersPage() {
  const orders = useOrderStore((state) => state.orders);
  const pagination = useOrderStore((state) => state.pagination);
  const filters = useOrderStore((state) => state.filters);
  const status = useOrderStore((state) => state.status);
  const error = useOrderStore((state) => state.error);
  const refreshOrders = useOrderStore((state) => state.refreshOrders);
  const setPage = useOrderStore((state) => state.setPage);
  const clearFilters = useOrderStore((state) => state.clearFilters);
  const ensureOrders = useOrderStore((state) => state.ensureOrders);

  // Search/geo drafts mirror URL-backed store filters so external clears
  // stay coherent. Render-time derived-state (sanctioned pattern, same as
  // catalog search) — never setState-in-effect.
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');
  const [cityDraft, setCityDraft] = useState(filters.city ?? '');
  const [stateDraft, setStateDraft] = useState(filters.state ?? '');
  const [prevFilterSignature, setPrevFilterSignature] = useState(
    `${filters.search ?? ''}|${filters.city ?? ''}|${filters.state ?? ''}`,
  );
  const filterSignature = `${filters.search ?? ''}|${filters.city ?? ''}|${filters.state ?? ''}`;
  if (prevFilterSignature !== filterSignature) {
    setPrevFilterSignature(filterSignature);
    setSearchDraft(filters.search ?? '');
    setCityDraft(filters.city ?? '');
    setStateDraft(filters.state ?? '');
  }
  const [searchHelpOpen, setSearchHelpOpen] = useState(false);
  // Bulk selection: id → status snapshot at selection time (supports
  // multi-page filtered results; statuses drive valid-transition options).
  const [selected, setSelected] = useState({});
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState(null);

  useEffect(() => {
    document.title = 'Orders — Tech Pulse Admin';
    ensureOrders();
  }, [ensureOrders]);

  const isLoading = status === 'idle' || status === 'loading';
  const hasActiveFilters = Boolean(filters.status || filters.paymentStatus || filters.search || filters.city || filters.state || filters.from || filters.to);

  const applySearch = () => {
    refreshOrders({ filters: { ...filters, search: searchDraft.trim() } });
  };

  const applyGeo = () => {
    refreshOrders({ filters: { ...filters, city: cityDraft.trim(), state: stateDraft.trim() } });
  };

  const handleClearAll = () => {
    setSearchDraft('');
    setCityDraft('');
    setStateDraft('');
    setSelected({});
    setBulkStatus('');
    setBulkError(null);
    clearFilters();
  };

  const handleFilterChange = (patch) => {
    refreshOrders({ filters: { ...filters, ...patch } });
  };

  const selectedIds = useMemo(() => Object.keys(selected), [selected]);
  const selectedOrders = useMemo(
    () => selectedIds.map((id) => ({ id, status: selected[id] })),
    [selectedIds, selected],
  );
  // Only valid transitions, common to EVERY selected order (intersection),
  // so the bulk target can never offer an illegal move for the set.
  const commonTransitions = useMemo(() => {
    if (selectedOrders.length === 0) return [];
    const sets = selectedOrders.map(({ status: current }) => allowedOrderTransitions(current));
    return sets[0].filter((candidate) => sets.every((list) => list.includes(candidate)));
  }, [selectedOrders]);

  const toggleSelect = (order) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[order.id]) delete next[order.id];
      else next[order.id] = order.status;
      return next;
    });
    setBulkError(null);
  };

  const toggleSelectAll = () => {
    const pageIds = orders.map((order) => order.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected[id]);
    setSelected((prev) => {
      const next = { ...prev };
      if (allSelected) {
        for (const id of pageIds) delete next[id];
      } else {
        for (const order of orders) next[order.id] = order.status;
      }
      return next;
    });
    setBulkError(null);
  };

  const runBulkUpdate = async () => {
    if (selectedIds.length === 0 || !bulkStatus || bulkPending) return;
    setBulkPending(true);
    setBulkError(null);
    try {
      // Single combined backend operation (atomic all-or-nothing) — never
      // a client-side loop of independent status requests.
      await bulkUpdateOrderStatus(selectedIds, bulkStatus);
      toast.success(`${selectedIds.length} order${selectedIds.length === 1 ? '' : 's'} moved to ${orderStatusLabel(bulkStatus)}.`);
      setSelected({});
      setBulkStatus('');
      await refreshOrders();
    } catch (error) {
      const details = Array.isArray(error?.details) ? error.details : [];
      const message = details.length > 0
        ? `${error?.message ?? 'Bulk update failed.'} ${details.map((d) => d.message ?? d.code).join(' ')}`
        : (error?.message ?? 'Bulk update failed.');
      setBulkError(message);
      toast.error(message);
      // Reconcile with server truth even on failure (atomic → no partial
      // writes, but refetch guarantees the list mirrors the backend).
      await refreshOrders();
    } finally {
      setBulkPending(false);
    }
  };

  const meta = isLoading
    ? 'Loading orders…'
    : `${pagination.total} ${pagination.total === 1 ? 'order' : 'orders'}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Orders" meta={meta} />

      {!isLoading && !error && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div role="search" className="relative w-full lg:max-w-md">
              <label htmlFor="order-search" className="sr-only">
                Search orders by order number, customer, or SKU
              </label>
              <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="order-search"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applySearch();
                }}
                placeholder="Search order no., customer, SKU…"
                autoComplete="off"
                className="min-h-[44px] w-full rounded-lg border border-input bg-surface pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 hover:border-border-strong"
              />
              {searchDraft ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchDraft('');
                    refreshOrders({ filters: { ...filters, search: '' } });
                  }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={applySearch}>
                Search
              </Button>
              <button
                type="button"
                onClick={() => setSearchHelpOpen(true)}
                aria-label="What can order search find?"
                className="inline-flex min-h-[36px] cursor-pointer items-center rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                What&apos;s searchable?
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Completed is a UI shortcut for the backend COMPLETED terminal
                state (lifecycle closure after DELIVERED) — one click away
                for the fulfilment workflow; the select below stays
                authoritative. Delivered orders remain discoverable via the
                select; no active-only query is ever applied. */}
            <button
              type="button"
              onClick={() => handleFilterChange({ status: filters.status === 'COMPLETED' ? '' : 'COMPLETED' })}
              aria-pressed={filters.status === 'COMPLETED'}
              title="Show completed orders"
              className={cn(
                'inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border px-3.5 text-sm font-semibold transition-colors',
                filters.status === 'COMPLETED'
                  ? 'border-success bg-success/15 text-success'
                  : 'border-border bg-surface text-muted-foreground hover:text-foreground',
              )}
            >
              Completed
            </button>
            <label htmlFor="order-status-filter" className="sr-only">
              Filter by order status
            </label>
            <select
              id="order-status-filter"
              value={filters.status}
              onChange={(event) => handleFilterChange({ status: event.target.value })}
              className={selectClass}
            >
              <option value="">All order statuses</option>
              {ORDER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {orderStatusLabel(value)}
                </option>
              ))}
            </select>

            <label htmlFor="order-payment-filter" className="sr-only">
              Filter by payment status
            </label>
            <select
              id="order-payment-filter"
              value={filters.paymentStatus}
              onChange={(event) => handleFilterChange({ paymentStatus: event.target.value })}
              className={selectClass}
            >
              <option value="">All payment states</option>
              {PAYMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0) + value.slice(1).toLowerCase()}
                </option>
              ))}
            </select>

            <label htmlFor="order-from-filter" className="sr-only">
              Placed on or after
            </label>
            <input
              id="order-from-filter"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => handleFilterChange({ from: event.target.value })}
              aria-label="Placed on or after"
              className={dateInputClass}
            />
            <span aria-hidden="true" className="text-sm text-muted-foreground">–</span>
            <label htmlFor="order-to-filter" className="sr-only">
              Placed on or before
            </label>
            <input
              id="order-to-filter"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => handleFilterChange({ to: event.target.value })}
              aria-label="Placed on or before"
              className={dateInputClass}
            />

            <label htmlFor="order-sort" className="sr-only">
              Sort orders
            </label>
            <select
              id="order-sort"
              value={filters.sortOrder}
              onChange={(event) => handleFilterChange({ sortOrder: event.target.value })}
              className={selectClass}
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>

            <label htmlFor="order-city-filter" className="sr-only">
              Filter by city
            </label>
            <input
              id="order-city-filter"
              type="text"
              value={cityDraft}
              onChange={(event) => setCityDraft(event.target.value)}
              onBlur={applyGeo}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyGeo();
              }}
              placeholder="City…"
              autoComplete="off"
              aria-label="Filter by city"
              className={selectClass}
            />
            <label htmlFor="order-state-filter" className="sr-only">
              Filter by state
            </label>
            <input
              id="order-state-filter"
              type="text"
              value={stateDraft}
              onChange={(event) => setStateDraft(event.target.value)}
              onBlur={applyGeo}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyGeo();
              }}
              placeholder="State…"
              autoComplete="off"
              aria-label="Filter by state"
              className={selectClass}
            />

            {hasActiveFilters ? (
              <button
                type="button"
                onClick={handleClearAll}
                className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                Clear filters
              </button>
            ) : null}
          </div>
          {selectedIds.length > 0 ? (
            <div
              aria-live="polite"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-muted px-4 py-3"
            >
              <span className="text-sm font-semibold text-foreground">
                {selectedIds.length} order{selectedIds.length === 1 ? '' : 's'} selected
              </span>
              {commonTransitions.length > 0 ? (
                <>
                  <label htmlFor="bulk-status-select" className="sr-only">
                    Bulk status target
                  </label>
                  <select
                    id="bulk-status-select"
                    value={bulkStatus}
                    onChange={(event) => setBulkStatus(event.target.value)}
                    className={selectClass}
                    disabled={bulkPending}
                  >
                    <option value="">Choose new status…</option>
                    {commonTransitions.map((value) => (
                      <option key={value} value={value}>
                        {orderStatusLabel(value)}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={runBulkUpdate}
                    disabled={!bulkStatus || bulkPending}
                  >
                    {bulkPending ? 'Updating…' : 'Apply to selected'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected({});
                      setBulkStatus('');
                      setBulkError(null);
                    }}
                    className="inline-flex min-h-[36px] cursor-pointer items-center rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    Clear selection
                  </button>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">
                  No common valid transition for this selection — pick orders sharing a next state.
                </span>
              )}
              {bulkError ? (
                <span role="alert" className="w-full text-sm text-destructive">
                  {bulkError}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label="Loading orders" className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load orders" message={error.message} onRetry={() => refreshOrders()} />
      ) : orders.length === 0 && !hasActiveFilters ? (
        <EmptyState
          icon={ShoppingCart}
          title="No orders yet"
          message="Placed customer orders will appear here for inspection and fulfilment."
        />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="No orders match"
          message="Nothing matches the current filters. Adjust or clear them to see more orders."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={orders.length > 0 && orders.every((order) => selected[order.id])}
                onChange={toggleSelectAll}
                aria-label="Select all orders on this page"
                className="h-4 w-4 accent-current"
              />
              Select page
            </label>
            {selectedIds.length > 0 ? (
              <span aria-live="polite" className="text-sm text-muted-foreground">
                {selectedIds.length} selected
              </span>
            ) : null}
          </div>
          <Table caption="Customer orders" columns={ORDER_COLUMNS} minWidth="min-w-[960px]">
            {orders.map((order) => {
              const payment = latestPayment(order);
              return (
                <tr key={order.id} className="transition-colors hover:bg-surface-muted/50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[order.id])}
                      onChange={() => toggleSelect(order)}
                      aria-label={`Select order ${order.orderNumber}`}
                      className="h-4 w-4 cursor-pointer accent-current"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-foreground">{order.orderNumber}</p>
                    <p className="truncate text-xs text-muted-foreground">{orderItemCount(order)} items</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{customerDisplayName(order.customer)}</p>
                    <p className="truncate text-xs text-muted-foreground">{order.customer?.email ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{orderItemCount(order)}</td>
                  <td className="px-4 py-3 font-semibold tabular-nums text-foreground">{formatINR(order.grandTotal)}</td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {payment ? <PaymentStatusBadge status={payment.status} /> : <Badge tone="neutral">No payment</Badge>}
                      {payment ? <PaymentMethodBadge method={payment.method} /> : null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(order.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/orders/${order.id}`}
                      aria-label={`View order ${order.orderNumber}`}
                      title={`View order ${order.orderNumber}`}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground hover:no-underline"
                    >
                      <Eye size={17} aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </Table>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            itemLabel={pagination.total === 1 ? 'order' : 'orders'}
            onPageChange={setPage}
            disabled={isLoading}
          />
        </>
      )}

      <div className="flex justify-start">
        <Button variant="secondary" onClick={() => refreshOrders()} disabled={isLoading}>
          Refresh list
        </Button>
      </div>

      {searchHelpOpen ? (
        <Modal title="What can order search find?" onClose={() => setSearchHelpOpen(false)}>
          <p className="text-sm leading-6 text-muted-foreground">
            One search box covers the server-supported fields: the human-readable order
            number (e.g. <span className="font-mono">ORD-2026-000001</span>), the
            customer&apos;s email or name, and item SKUs. Partial matches work —
            typing a few characters of any of these narrows the list.
          </p>
          <div className="mt-5 flex justify-end">
            <Button variant="secondary" onClick={() => setSearchHelpOpen(false)}>
              Got it
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

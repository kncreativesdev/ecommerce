import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Search, TicketPercent, X } from 'lucide-react';
import { useReturnStore } from '../stores/useReturnStore.js';
import { RETURN_STATUSES, returnReasonLabel } from '../utils/returns.js';
import { customerDisplayName } from '../utils/orderLifecycle.js';
import { ReturnStatusBadge } from '../components/returns/ReturnBadges.jsx';
import { OrderStatusBadge } from '../components/orders/OrderBadges.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { formatDate } from '../lib/format.js';
import { cn } from '../lib/cn.js';

const RETURN_COLUMNS = [
  { key: 'order', label: 'Order' },
  { key: 'customer', label: 'Customer' },
  { key: 'reason', label: 'Reason' },
  { key: 'returnStatus', label: 'Return status' },
  { key: 'orderStatus', label: 'Order status' },
  { key: 'requested', label: 'Requested' },
  { key: 'actions', label: 'Actions', numeric: true },
];

const selectClass =
  'inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-border bg-surface px-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Return Orders (`/returns`): read-only admin view over customer return
 * requests — the sibling of Orders/Inventory under Operations. Server
 * driven (`GET /returns?page&limit&status&search`): status filter +
 * order-number/customer search, pagination from server meta. No mutations
 * exist in the backend workflow, so there are no bulk or status actions
 * here — only inspection via the detail view.
 */
export function ReturnsPage() {
  const returns = useReturnStore((state) => state.returns);
  const pagination = useReturnStore((state) => state.pagination);
  const filters = useReturnStore((state) => state.filters);
  const status = useReturnStore((state) => state.status);
  const error = useReturnStore((state) => state.error);
  const ensureReturns = useReturnStore((state) => state.ensureReturns);
  const refreshReturns = useReturnStore((state) => state.refreshReturns);
  const setPage = useReturnStore((state) => state.setPage);
  const clearFilters = useReturnStore((state) => state.clearFilters);

  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');

  useEffect(() => {
    document.title = 'Return Orders — Tech Pulse Admin';
    ensureReturns();
  }, [ensureReturns]);

  const isInitialLoading = status === 'idle' || status === 'loading';
  const hasRows = returns.length > 0;
  const controlsDisabled = isInitialLoading;
  const hasActiveFilters = Boolean(filters.status || filters.search);

  const applySearch = () => {
    refreshReturns({ filters: { ...filters, search: searchDraft.trim() } });
  };

  const handleClearAll = () => {
    setSearchDraft('');
    clearFilters();
  };

  const meta = isInitialLoading
    ? 'Loading return requests…'
    : `${pagination.total} ${pagination.total === 1 ? 'request' : 'requests'}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Return Orders"
        meta={meta}
        actions={
          <Button variant="secondary" size="sm" onClick={() => refreshReturns()} disabled={controlsDisabled}>
            Refresh
          </Button>
        }
      />

      {!isInitialLoading && !(error && !hasRows) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label htmlFor="return-status-filter" className="sr-only">
            Filter by return status
          </label>
          <select
            id="return-status-filter"
            value={filters.status}
            onChange={(event) => refreshReturns({ filters: { ...filters, status: event.target.value } })}
            disabled={controlsDisabled}
            className={cn(selectClass, 'w-full sm:w-auto')}
          >
            <option value="">All statuses</option>
            {RETURN_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0) + value.slice(1).toLowerCase().replace('_', ' ')}
              </option>
            ))}
          </select>
          <div role="search" className="relative w-full sm:max-w-md">
            <label htmlFor="return-search" className="sr-only">
              Search returns by order number or customer
            </label>
            <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="return-search"
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applySearch();
              }}
              placeholder="Search order number or customer… (Enter to apply)"
              autoComplete="off"
              className="min-h-[44px] w-full rounded-lg border border-input bg-surface pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 hover:border-border-strong"
            />
            {searchDraft ? (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft('');
                  refreshReturns({ filters: { ...filters, search: '' } });
                }}
                aria-label="Clear search input"
                className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={handleClearAll}
              className="inline-flex min-h-[44px] cursor-pointer items-center self-start rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      )}

      {isInitialLoading ? (
        <div role="status" aria-label="Loading return requests" className="flex flex-col gap-2">
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
              <Button variant="secondary" size="sm" onClick={() => refreshReturns()}>
                Retry
              </Button>
            </div>
          ) : null}
          <Table caption="Customer return requests" columns={RETURN_COLUMNS} minWidth="min-w-[960px]">
              {returns.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-surface-muted/50">
                  <td className="px-4 py-3">
                    <p className="font-mono font-semibold text-foreground">{item.order?.orderNumber ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="max-w-56 truncate font-medium text-foreground" title={item.customer?.email ?? ''}>
                      {item.customer ? customerDisplayName(item.customer) : '—'}
                    </p>
                    <p className="max-w-56 truncate text-xs text-muted-foreground">{item.customer?.email ?? ''}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{returnReasonLabel(item.reason)}</td>
                  <td className="px-4 py-3">
                    <ReturnStatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3">
                    {item.order ? (
                      <OrderStatusBadge status={item.order.status} />
                    ) : (
                      <Badge tone="neutral">—</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                    {formatDate(item.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center justify-end gap-1">
                      <Link
                        to={`/returns/${item.id}`}
                        aria-label={`View return request for order ${item.order?.orderNumber ?? item.orderId}`}
                        title={`View return request for order ${item.order?.orderNumber ?? item.orderId}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground hover:no-underline"
                      >
                        <Eye size={17} aria-hidden="true" />
                      </Link>
                    </span>
                  </td>
                </tr>
              ))}
            </Table>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            itemLabel={pagination.total === 1 ? 'request' : 'requests'}
            onPageChange={setPage}
          />
        </>
      ) : error ? (
        <ErrorState title="Couldn’t load return requests" message={error.message} onRetry={() => refreshReturns()} />
      ) : (
        <EmptyState
          icon={TicketPercent}
          title="No return requests"
          message={
            hasActiveFilters
              ? 'Nothing matches the current filters. Clear them to see every request.'
              : 'Customer return requests will appear here once submitted from an order.'
          }
        />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Search, Users, X } from 'lucide-react';
import { useCustomerStore } from '../stores/useCustomerStore.js';
import { customerDisplayName, customerRoleLabel } from '../utils/customerDisplay.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { formatDate } from '../lib/format.js';

/**
 * Customers List (`/customers`): real backend data only, via ADMIN-only
 * `GET /users`. Filtering/sorting/pagination are SERVER-driven — every
 * control maps to a documented query param
 * (`search/isActive/sortOrder`); the store refetches on each change. No
 * invented params, no client-side slicing.
 *
 * Columns show server-returned safe fields only: name, email, phone,
 * roles, account status, signup date. No password hashes, tokens, or
 * auth metadata are ever rendered (the API never returns them). Row
 * action is a View link to `/customers/:id` (rows are never
 * pseudo-buttons). Lifecycle mutations live on the detail page.
 */
const CUSTOMER_COLUMNS = [
  { key: 'customer', label: 'Customer' },
  { key: 'contact', label: 'Contact' },
  { key: 'roles', label: 'Roles' },
  { key: 'status', label: 'Status' },
  { key: 'joined', label: 'Joined' },
  { key: 'actions', label: 'Actions', numeric: true },
];

const selectClass =
  'min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30';

export function CustomersPage() {
  const customers = useCustomerStore((state) => state.customers);
  const pagination = useCustomerStore((state) => state.pagination);
  const filters = useCustomerStore((state) => state.filters);
  const status = useCustomerStore((state) => state.status);
  const error = useCustomerStore((state) => state.error);
  const refreshCustomers = useCustomerStore((state) => state.refreshCustomers);
  const setPage = useCustomerStore((state) => state.setPage);
  const clearFilters = useCustomerStore((state) => state.clearFilters);
  const ensureCustomers = useCustomerStore((state) => state.ensureCustomers);

  // Search input is local until submitted (avoids a request per keystroke);
  // every other control applies immediately via the store (server fetch).
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');
  const [searchHelpOpen, setSearchHelpOpen] = useState(false);

  useEffect(() => {
    document.title = 'Customers — Tech Pulse Admin';
    ensureCustomers();
  }, [ensureCustomers]);

  const isLoading = status === 'idle' || status === 'loading';
  const hasActiveFilters = Boolean(filters.search || filters.isActive);

  const applySearch = () => {
    refreshCustomers({ filters: { ...filters, search: searchDraft.trim() } });
  };

  const handleClearAll = () => {
    setSearchDraft('');
    clearFilters();
  };

  const handleFilterChange = (patch) => {
    refreshCustomers({ filters: { ...filters, ...patch } });
  };

  const meta = isLoading
    ? 'Loading customers…'
    : `${pagination.total} ${pagination.total === 1 ? 'customer' : 'customers'}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Customers" meta={meta} />

      {!isLoading && !error && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div role="search" className="relative w-full lg:max-w-md">
              <label htmlFor="customer-search" className="sr-only">
                Search customers by email or name
              </label>
              <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="customer-search"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applySearch();
                }}
                placeholder="Search email, first or last name…"
                autoComplete="off"
                className="min-h-[44px] w-full rounded-lg border border-input bg-surface pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 hover:border-border-strong"
              />
              {searchDraft ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchDraft('');
                    refreshCustomers({ filters: { ...filters, search: '' } });
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
                aria-label="What can customer search find?"
                className="inline-flex min-h-[36px] cursor-pointer items-center rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                What&apos;s searchable?
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="customer-status-filter" className="sr-only">
              Filter by account status
            </label>
            <select
              id="customer-status-filter"
              value={filters.isActive}
              onChange={(event) => handleFilterChange({ isActive: event.target.value })}
              className={selectClass}
            >
              <option value="">All account statuses</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>

            <label htmlFor="customer-sort" className="sr-only">
              Sort customers
            </label>
            <select
              id="customer-sort"
              value={filters.sortOrder}
              onChange={(event) => handleFilterChange({ sortOrder: event.target.value })}
              className={selectClass}
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>

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
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label="Loading customers" className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load customers" message={error.message} onRetry={() => refreshCustomers()} />
      ) : customers.length === 0 && !hasActiveFilters ? (
        <EmptyState
          icon={Users}
          title="No customers yet"
          message="Registered customer accounts will appear here for inspection and lifecycle management."
        />
      ) : customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No customers match"
          message="Nothing matches the current filters. Adjust or clear them to see more customers."
        />
      ) : (
        <>
          <Table caption="Customers" columns={CUSTOMER_COLUMNS} minWidth="min-w-[860px]">
            {customers.map((customer) => (
              <tr key={customer.id} className="transition-colors hover:bg-surface-muted/50">
                <td className="px-4 py-3">
                  <p className="font-semibold text-foreground">{customerDisplayName(customer)}</p>
                  <p className="truncate text-xs text-muted-foreground">{customer.email}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{customer.phone ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">{customerRoleLabel(customer)}</td>
                <td className="px-4 py-3">
                  <Badge tone={customer.isActive === false ? 'neutral' : 'success'}>
                    {customer.isActive === false ? 'Inactive' : 'Active'}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(customer.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/customers/${customer.id}`}
                    aria-label={`View customer ${customer.email}`}
                    title={`View customer ${customer.email}`}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground hover:no-underline"
                  >
                    <Eye size={17} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            itemLabel={pagination.total === 1 ? 'customer' : 'customers'}
            onPageChange={setPage}
            disabled={isLoading}
          />
        </>
      )}

      <div className="flex justify-start">
        <Button variant="secondary" onClick={() => refreshCustomers()} disabled={isLoading}>
          Refresh list
        </Button>
      </div>

      {searchHelpOpen ? (
        <Modal title="What can customer search find?" onClose={() => setSearchHelpOpen(false)}>
          <p className="text-sm leading-6 text-muted-foreground">
            One search box covers the server-supported fields: the customer&apos;s
            email address, first name, or last name. Partial matches work —
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

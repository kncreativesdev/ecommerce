import { useCallback, useEffect, useRef, useState } from 'react';
import { History, PackageSearch, Pencil, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useInventoryStore } from '../stores/useInventoryStore.js';
import {
  fetchInventoryTransactions,
} from '../services/inventory.service.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { Field, Input, Textarea } from '../components/ui/Field.jsx';
import { formatDateTime } from '../lib/format.js';

/**
 * Inventory (`/inventory`): real backend data only, via ADMIN-only
 * `GET /inventory`. Filtering/sorting/pagination are SERVER-driven —
 * every control maps to a documented query param
 * (`search/stock/active/sortBy/sortOrder`); the store refetches on each
 * change. No invented params, no client-side slicing.
 *
 * Stock truth: OUT OF STOCK = available (quantity − reserved) ≤ 0, or no
 * stock record at all (a variant without a record cannot be purchased —
 * shown as "Not initialized", never as zero). There is no low-stock
 * threshold in the backend, so none is invented.
 *
 * Mutations reuse the real per-variant contract: initialize-once takes an
 * ABSOLUTE quantity (`POST`), adjust takes a SIGNED DELTA (`PATCH`,
 * positive adds / negative removes) with an optional ledger note. Every
 * mutation reconciles from the authoritative server response with
 * pending states and toasts; the browser never reloads. History reads
 * the real ledger (`.../inventory/transactions`, newest first) — manual
 * adjustments never create orders, touch totals, or alter snapshots.
 */
const INVENTORY_COLUMNS = [
  { key: 'variant', label: 'Variant' },
  { key: 'product', label: 'Product' },
  { key: 'stock', label: 'Stock' },
  { key: 'status', label: 'Status' },
  { key: 'updated', label: 'Updated' },
  { key: 'actions', label: 'Actions', numeric: true },
];

const MAX_INT32 = 2147483647;

const selectClass =
  'min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30';

function stockBadge(item) {
  if (!item.inventory) {
    return <Badge tone="warning">Not initialized</Badge>;
  }
  const available = item.inventory.quantity - (item.inventory.reservedQuantity ?? 0);
  return (
    <Badge tone={available > 0 ? 'success' : 'destructive'}>
      {available > 0 ? 'In stock' : 'Out of stock'}
    </Badge>
  );
}

export function InventoryPage() {
  const items = useInventoryStore((state) => state.items);
  const pagination = useInventoryStore((state) => state.pagination);
  const filters = useInventoryStore((state) => state.filters);
  const status = useInventoryStore((state) => state.status);
  const error = useInventoryStore((state) => state.error);
  const refreshInventory = useInventoryStore((state) => state.refreshInventory);
  const setPage = useInventoryStore((state) => state.setPage);
  const clearFilters = useInventoryStore((state) => state.clearFilters);
  const ensureInventory = useInventoryStore((state) => state.ensureInventory);
  const initializeStock = useInventoryStore((state) => state.initializeStock);
  const adjustStock = useInventoryStore((state) => state.adjustStock);

  // Search input is local until submitted (avoids a request per keystroke);
  // every other control applies immediately via the store (server fetch).
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');
  const [adjusting, setAdjusting] = useState(null);
  const [adjustQuantity, setAdjustQuantity] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustError, setAdjustError] = useState(null);
  const [mutating, setMutating] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyStatus, setHistoryStatus] = useState('idle');

  // Stable modal close handlers: Modal focuses itself whenever its
  // onClose identity changes, so an inline arrow would yank focus out of
  // the modal's own inputs on every parent keystroke-render.
  const mutatingRef = useRef(false);
  useEffect(() => {
    mutatingRef.current = mutating;
  }, [mutating]);
  const closeAdjust = useCallback(() => {
    if (!mutatingRef.current) setAdjusting(null);
  }, []);
  const closeHistory = useCallback(() => {
    setHistory(null);
  }, []);

  useEffect(() => {
    document.title = 'Inventory — Tech Pulse Admin';
    ensureInventory();
  }, [ensureInventory]);

  const isLoading = status === 'idle' || status === 'loading';
  const hasActiveFilters = Boolean(filters.search || filters.stock || filters.active);

  const applySearch = () => {
    refreshInventory({ filters: { ...filters, search: searchDraft.trim() } });
  };

  const handleClearAll = () => {
    setSearchDraft('');
    clearFilters();
  };

  const handleFilterChange = (patch) => {
    refreshInventory({ filters: { ...filters, ...patch } });
  };

  const handleSortChange = (value) => {
    if (value === 'sku-asc') handleFilterChange({ sortBy: 'sku', sortOrder: 'asc' });
    else if (value === 'sku-desc') handleFilterChange({ sortBy: 'sku', sortOrder: 'desc' });
    else if (value === 'oldest') handleFilterChange({ sortBy: 'createdAt', sortOrder: 'asc' });
    else handleFilterChange({ sortBy: 'createdAt', sortOrder: 'desc' });
  };

  const sortValue =
    filters.sortBy === 'sku'
      ? `sku-${filters.sortOrder}`
      : filters.sortOrder === 'asc'
        ? 'oldest'
        : 'newest';

  const openAdjust = (item) => {
    setAdjusting(item);
    setAdjustQuantity('');
    setAdjustNote('');
    setAdjustError(null);
  };

  const openHistory = (item) => {
    setHistory(item);
    setHistoryRows([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setHistoryStatus('loading');
    fetchInventoryTransactions(item.variant.productId, item.variant.id, { page: 1, limit: 20 })
      .then(({ transactions, pagination: meta }) => {
        setHistoryRows(Array.isArray(transactions) ? transactions : []);
        setHistoryTotal(meta?.total ?? 0);
        setHistoryStatus('success');
      })
      .catch((fetchError) => {
        setHistoryStatus('error');
        toast.error(fetchError?.message ?? 'Couldn’t load stock history.');
      });
  };

  const loadHistoryPage = (page) => {
    if (!history || historyStatus === 'loading') return;
    setHistoryStatus('loading');
    fetchInventoryTransactions(history.variant.productId, history.variant.id, { page, limit: 20 })
      .then(({ transactions, pagination: meta }) => {
        setHistoryRows(Array.isArray(transactions) ? transactions : []);
        setHistoryTotal(meta?.total ?? 0);
        setHistoryPage(page);
        setHistoryStatus('success');
      })
      .catch((fetchError) => {
        setHistoryStatus('error');
        toast.error(fetchError?.message ?? 'Couldn’t load stock history.');
      });
  };

  const validateAdjust = (isInitialize) => {
    const trimmed = adjustQuantity.trim();
    if (trimmed === '') return 'Enter a quantity.';
    if (!/^-?\d+$/.test(trimmed)) return 'Quantity must be a whole number.';
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value)) return 'Quantity is out of range.';
    if (isInitialize && (value < 0 || value > MAX_INT32)) {
      return `Initial stock must be between 0 and ${MAX_INT32}.`;
    }
    if (!isInitialize && (value === 0 || Math.abs(value) > MAX_INT32)) {
      return 'Adjustment must be a non-zero whole number.';
    }
    if (adjustNote.trim().length > 1000) return 'Note must be ≤ 1000 characters.';
    return null;
  };

  const handleAdjustSubmit = async () => {
    if (!adjusting || mutating) return;
    const isInitialize = !adjusting.inventory;
    const validationError = validateAdjust(isInitialize);
    if (validationError) {
      setAdjustError(validationError);
      return;
    }
    setMutating(true);
    setAdjustError(null);
    try {
      const quantity = Number(adjustQuantity.trim());
      const note = adjustNote.trim() === '' ? undefined : adjustNote.trim();
      if (isInitialize) {
        await initializeStock(adjusting.variant.productId, adjusting.variant.id, { quantity, note });
        toast.success(`Stock initialized at ${quantity} for “${adjusting.variant.sku}”.`);
      } else {
        await adjustStock(adjusting.variant.productId, adjusting.variant.id, { quantity, note });
        toast.success(
          quantity > 0
            ? `Added ${quantity} to “${adjusting.variant.sku}”.`
            : `Removed ${Math.abs(quantity)} from “${adjusting.variant.sku}”.`,
        );
      }
      setAdjusting(null);
    } catch (submitError) {
      const code = submitError?.code;
      if (code === 'INVENTORY_ALREADY_EXISTS') {
        setAdjustError('Stock already exists for this variant — adjust it instead.');
      } else if (code === 'INSUFFICIENT_STOCK') {
        setAdjustError('Not enough stock for that removal.');
      } else if (code === 'INVENTORY_NOT_FOUND' || submitError?.status === 404) {
        setAdjustError('Stock record not found — it may have been removed. Refresh the list.');
      } else {
        setAdjustError(submitError?.message ?? 'Save failed. Please try again.');
      }
    } finally {
      setMutating(false);
    }
  };

  const meta = isLoading
    ? 'Loading inventory…'
    : `${pagination.total} ${pagination.total === 1 ? 'variant' : 'variants'}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Inventory"
        meta={meta}
        description="Variant-level stock across the catalogue. Adjustments write signed ledger rows — never orders, totals, or snapshots."
      />

      {!isLoading && !error && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div role="search" className="relative w-full lg:max-w-md">
              <label htmlFor="inventory-search" className="sr-only">
                Search inventory by SKU, variant, or product
              </label>
              <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="inventory-search"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applySearch();
                }}
                placeholder="Search SKU, variant, product…"
                autoComplete="off"
                className="min-h-[44px] w-full rounded-lg border border-input bg-surface pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 hover:border-border-strong"
              />
              {searchDraft ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchDraft('');
                    refreshInventory({ filters: { ...filters, search: '' } });
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
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="inventory-stock-filter" className="sr-only">
              Filter by stock status
            </label>
            <select
              id="inventory-stock-filter"
              value={filters.stock}
              onChange={(event) => handleFilterChange({ stock: event.target.value })}
              className={selectClass}
            >
              <option value="">All stock levels</option>
              <option value="in">In stock</option>
              <option value="out">Out of stock</option>
            </select>

            <label htmlFor="inventory-active-filter" className="sr-only">
              Filter by variant status
            </label>
            <select
              id="inventory-active-filter"
              value={filters.active}
              onChange={(event) => handleFilterChange({ active: event.target.value })}
              className={selectClass}
            >
              <option value="">All variants</option>
              <option value="true">Active variants</option>
              <option value="false">Inactive variants</option>
            </select>

            <label htmlFor="inventory-sort" className="sr-only">
              Sort inventory
            </label>
            <select
              id="inventory-sort"
              value={sortValue}
              onChange={(event) => handleSortChange(event.target.value)}
              className={selectClass}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="sku-asc">SKU A–Z</option>
              <option value="sku-desc">SKU Z–A</option>
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
        <div role="status" aria-label="Loading inventory" className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load inventory" message={error.message} onRetry={() => refreshInventory()} />
      ) : items.length === 0 && !hasActiveFilters ? (
        <EmptyState
          icon={PackageSearch}
          title="No variants yet"
          message="Variants appear here with their stock levels once products have variants."
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No variants match"
          message="Nothing matches the current filters. Adjust or clear them to see more stock."
        />
      ) : (
        <>
          <Table caption="Variant stock levels" columns={INVENTORY_COLUMNS} minWidth="min-w-[980px]">
            {items.map((item) => (
              <tr key={item.variant.id} className="transition-colors hover:bg-surface-muted/50">
                <td className="px-4 py-3">
                  <p className="font-mono font-semibold text-foreground">{item.variant.sku}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.variant.name}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{item.product.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.product.isActive ? 'Product active' : 'Product inactive'}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-base font-bold tabular-nums text-foreground">
                    {item.inventory ? item.inventory.quantity : '—'}
                  </p>
                  <span className="mt-1 inline-block">{stockBadge(item)}</span>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={item.variant.isActive === false ? 'neutral' : 'success'}>
                    {item.variant.isActive === false ? 'Inactive' : 'Active'}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {item.inventory ? formatDateTime(item.inventory.updatedAt) : '—'}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => openAdjust(item)}
                      aria-label={`${item.inventory ? 'Adjust stock for' : 'Initialize stock for'} ${item.variant.sku}`}
                      title={item.inventory ? 'Adjust stock' : 'Initialize stock'}
                      className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                    >
                      <Pencil size={17} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openHistory(item)}
                      aria-label={`View stock history for ${item.variant.sku}`}
                      title="Stock history"
                      className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                    >
                      <History size={17} aria-hidden="true" />
                    </button>
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
            itemLabel={pagination.total === 1 ? 'variant' : 'variants'}
            onPageChange={setPage}
            disabled={isLoading}
          />
        </>
      )}

      <div className="flex justify-start">
        <Button variant="secondary" onClick={() => refreshInventory()} disabled={isLoading}>
          Refresh list
        </Button>
      </div>

      {adjusting ? (
        <Modal
          title={adjusting.inventory ? `Adjust stock — ${adjusting.variant.sku}` : `Initialize stock — ${adjusting.variant.sku}`}
          onClose={closeAdjust}
          persistent={mutating}
        >
          <div className="flex flex-col gap-4">
            <p className="rounded-lg bg-surface-muted px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
              {adjusting.inventory ? (
                <>
                  Current stock:{' '}
                  <span className="font-bold tabular-nums text-foreground">{adjusting.inventory.quantity}</span>.
                  Enter a signed delta — positive adds, negative removes. The backend applies it
                  atomically and writes a ledger row.
                </>
              ) : (
                <>
                  This variant has no stock record yet (it cannot be purchased). Enter the
                  starting quantity — this can only be done once per variant.
                </>
              )}
            </p>
            <Field
              label={adjusting.inventory ? 'Adjustment (signed delta)' : 'Initial quantity'}
              required
              error={adjustError}
            >
              <Input
                inputMode="numeric"
                autoComplete="off"
                placeholder={adjusting.inventory ? 'e.g. 10 or -3' : 'e.g. 25'}
                value={adjustQuantity}
                onChange={(event) => setAdjustQuantity(event.target.value)}
                disabled={mutating}
                aria-invalid={Boolean(adjustError)}
              />
            </Field>
            <Field label="Ledger note" hint="Optional — up to 1000 characters, stored with the ledger row.">
              <Textarea
                rows={2}
                placeholder="e.g. Cycle count correction"
                value={adjustNote}
                onChange={(event) => setAdjustNote(event.target.value)}
                disabled={mutating}
              />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setAdjusting(null)} disabled={mutating}>
                Cancel
              </Button>
              <Button loading={mutating} onClick={handleAdjustSubmit}>
                {adjusting.inventory ? 'Apply adjustment' : 'Initialize stock'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {history ? (
        <Modal title={`Stock history — ${history.variant.sku}`} onClose={closeHistory}>
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-5 text-muted-foreground">
              Newest first. Signed quantities: positive adds stock, negative removes it.
            </p>
            {historyStatus === 'loading' && historyRows.length === 0 ? (
              <div role="status" aria-label="Loading stock history" className="flex flex-col gap-2">
                {[0, 1, 2].map((index) => (
                  <div key={index} aria-hidden="true" className="h-14 animate-pulse rounded-lg bg-surface-muted" />
                ))}
              </div>
            ) : historyStatus === 'error' && historyRows.length === 0 ? (
              <ErrorState title="Couldn’t load history" message="Please try again." onRetry={() => loadHistoryPage(historyPage)} />
            ) : historyRows.length === 0 ? (
              <p className="rounded-lg bg-surface-muted px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
                No ledger rows for this variant yet.
              </p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {historyRows.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3.5 py-2.5">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {entry.quantity > 0 ? `+${entry.quantity}` : entry.quantity}
                          <span className="ml-2 font-mono text-xs font-medium text-muted-foreground">{entry.type}</span>
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {[entry.referenceType, entry.note].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
                {historyTotal > 20 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      Page {historyPage} of {Math.max(1, Math.ceil(historyTotal / 20))} · {historyTotal} rows
                    </span>
                    <span className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={historyPage <= 1 || historyStatus === 'loading'}
                        onClick={() => loadHistoryPage(historyPage - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={historyPage >= Math.ceil(historyTotal / 20) || historyStatus === 'loading'}
                        onClick={() => loadHistoryPage(historyPage + 1)}
                      >
                        Next
                      </Button>
                    </span>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

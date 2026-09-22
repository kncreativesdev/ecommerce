import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Boxes,
  FolderTree,
  Package,
  ShoppingCart,
  Star,
  Users,
} from 'lucide-react';
import { fetchDashboardSummary } from '../services/dashboard.service.js';
import { fetchCategories } from '../services/category.service.js';
import { fetchProducts } from '../services/product.service.js';
import { fetchCustomers } from '../services/customer.service.js';
import { fetchReviewsAdmin } from '../services/review.service.js';
import { fetchOrdersAdmin } from '../services/order.service.js';
import { buildCategoryTree } from '../utils/taxonomy.js';
import { TrendChart } from '../components/dashboard/TrendChart.jsx';
import { Button } from '../components/ui/Button.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { formatDate, formatINR } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * Dashboard: honest operational overview. Two INDEPENDENT sections, each
 * with its own loading/error state — a failure in one never zeroes the
 * other (a failed metric shows an error + retry, never a false zero).
 *
 * ANALYTICS (range-aware): one ADMIN-only `GET /dashboard/summary?range=`
 * per range/mount/refresh. Every number is database-computed; the admin
 * never sums order rows. Recognized revenue = SUM(grandTotal) over
 * DELIVERED orders whose latest payment is PAID (cancelled, in-flight,
 * unpaid, failed, and refunded orders excluded — see the revenue note
 * below and `dashboard.service.js`). Ranges are UTC day boundaries
 * computed server-side (week starts Monday); the admin sends only the
 * range enum, so boundaries can never drift. Buckets are zero-filled by
 * the backend across the full frame — zeros are measured absence, and
 * charts render exactly those buckets with no interpolation.
 *
 * OPERATIONS (catalog snapshot): categories/products/customers/pending
 * reviews/recent orders from their real list endpoints (meta totals
 * where paginated — never page-length arithmetic). Local state only, no
 * Zustand mirrors (same stale-mirror reasoning as before: refetch on
 * every mount + manual refresh).
 *
 * Refresh semantics: initial load shows skeletons; range changes and
 * manual refresh keep old values mounted with a subtle "Updating…"
 * indicator (no full-page flash). No reloads, no timeouts, no polling —
 * "Refresh" is one fresh API request ("Last updated" stamps it).
 */

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const RANGE_CAPTIONS = {
  today: 'Hourly · UTC day',
  week: 'Daily · Monday–Sunday (UTC)',
  month: 'Daily · calendar month (UTC)',
  year: 'Monthly · calendar year (UTC)',
};

function formatCount(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-IN').format(value);
}

function formatBucketLabel(bucketStart, granularity) {
  const date = new Date(bucketStart);
  if (Number.isNaN(date.getTime())) return bucketStart;
  if (granularity === 'hour') {
    return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(date);
  }
  if (granularity === 'month') {
    return new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(date);
  }
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

function formatLastUpdated(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function DashboardPage() {
  const [range, setRange] = useState('today');
  const [summary, setSummary] = useState(null);
  const [summaryStatus, setSummaryStatus] = useState('loading');
  const [summaryError, setSummaryError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [categories, setCategories] = useState([]);
  const [activeProducts, setActiveProducts] = useState(null);
  const [customersTotal, setCustomersTotal] = useState(null);
  const [pendingReviews, setPendingReviews] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [opsStatus, setOpsStatus] = useState('loading');
  const [opsError, setOpsError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const loadSummary = useCallback(
    async (nextRange) => {
      // First load shows skeletons; every later load (range switch,
      // manual refresh) keeps old values mounted with a subtle indicator.
      setSummaryStatus((current) =>
        current === 'success' || current === 'refreshing' ? 'refreshing' : 'loading',
      );
      setSummaryError(null);
      try {
        const fresh = await fetchDashboardSummary(nextRange);
        setSummary(fresh);
        setLastUpdated(new Date().toISOString());
        setSummaryStatus('success');
      } catch (fetchError) {
        // Never wipe good values into zeros on a background failure.
        setSummaryError(fetchError?.message ?? 'Failed to load dashboard analytics.');
        setSummaryStatus((current) => (current === 'refreshing' ? 'success' : 'error'));
      }
    },
    [],
  );

  // Manual refresh + range switch: fresh requests, shell stays mounted.
  const refresh = useCallback(() => {
    setOpsStatus((current) => (current === 'success' ? 'refreshing' : current));
    setOpsError(null);
    setReloadToken((token) => token + 1);
    loadSummary(range);
  }, [loadSummary, range]);

  const changeRange = useCallback(
    (nextRange) => {
      if (nextRange === range) return;
      setRange(nextRange);
      loadSummary(nextRange);
    },
    [loadSummary, range],
  );

  useEffect(() => {
    document.title = 'Dashboard — Tech Pulse Admin';
    // Intentional mount fetch: initial status is already 'loading', so the
    // synchronous setStatus('loading') inside loadSummary bails out with no
    // cascading render; the resolving setSummary runs async after the fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSummary('today');
  }, [loadSummary]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchCategories('all'),
      fetchProducts('active'),
      fetchCustomers({ page: 1, limit: 1 }),
      fetchReviewsAdmin({ page: 1, limit: 1, isApproved: false }),
      fetchOrdersAdmin({ page: 1, limit: 5, sortBy: 'createdAt', sortOrder: 'desc' }),
    ])
      .then(([categoryRows, productRows, customers, reviews, orders]) => {
        if (cancelled) return;
        setCategories(Array.isArray(categoryRows) ? categoryRows : []);
        setActiveProducts(Array.isArray(productRows) ? productRows : []);
        setCustomersTotal(customers?.pagination?.total ?? 0);
        setPendingReviews(reviews?.pagination?.total ?? 0);
        setRecentOrders(Array.isArray(orders?.orders) ? orders.orders : []);
        setOpsStatus('success');
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setOpsError(fetchError?.message ?? 'Failed to load operational data.');
        setOpsStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const analyticsLoading = summaryStatus === 'idle' || summaryStatus === 'loading';
  const analyticsRefreshing = summaryStatus === 'refreshing';
  const opsLoading = opsStatus === 'idle' || opsStatus === 'loading';
  const opsRefreshing = opsStatus === 'refreshing';

  const tree = buildCategoryTree(categories);
  const subcategoryCount = categories.filter((category) => category.parentId).length;
  const granularity = summary?.granularity ?? 'hour';

  const heroCards = summary
    ? [
        {
          title: 'Revenue',
          stat: formatINR(summary.period?.revenue),
          description: `Recognized in this ${range} · ${formatINR(summary.revenue?.total)} all-time recognized`,
        },
        {
          title: 'Orders',
          stat: formatCount(summary.period?.orders),
          description: `Received in this ${range} · ${formatCount(summary.orders?.total)} total received`,
        },
        {
          title: 'Pending',
          stat: formatCount(summary.orders?.pending),
          description: 'Awaiting fulfilment right now',
          to: '/orders',
          linkLabel: 'Open orders',
        },
        {
          title: 'Delivered',
          stat: formatCount(summary.orders?.delivered),
          description: 'Completed fulfilment (all-time)',
          to: '/orders',
          linkLabel: 'Open orders',
        },
      ]
    : [];

  const opsCards = [
    {
      to: '/inventory',
      icon: Boxes,
      title: 'Out of stock',
      stat: opsLoading ? '…' : formatCount(summary?.inventory?.outOfStock),
      description:
        summary?.inventory?.uninitialized > 0
          ? `Includes ${formatCount(summary.inventory.uninitialized)} variant${summary.inventory.uninitialized === 1 ? '' : 's'} with no stock record`
          : 'Variants at zero available stock',
    },
    {
      to: '/reviews',
      icon: Star,
      title: 'Pending reviews',
      stat: opsLoading ? '…' : formatCount(pendingReviews),
      description: 'Awaiting moderation',
    },
    {
      to: '/catalog/products',
      icon: Package,
      title: 'Active products',
      stat: opsLoading ? '…' : `${formatCount(activeProducts?.length ?? 0)} active`,
      description: 'Sellable catalogue right now',
    },
    {
      to: '/customers',
      icon: Users,
      title: 'Customers',
      stat: opsLoading ? '…' : formatCount(customersTotal),
      description: 'Registered accounts',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Dashboard</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Recognized revenue and order volume, computed by the backend. Every number comes from the live API.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
            {analyticsRefreshing || opsRefreshing ? 'Updating…' : `Last updated ${formatLastUpdated(lastUpdated)}`}
          </span>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={analyticsLoading || opsLoading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Range selector: Today / Week / Month / Year. Switching refetches
          one summary; cards and charts stay mounted throughout. */}
      <div
        role="group"
        aria-label="Dashboard date range"
        className="inline-flex w-fit items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-sm"
      >
        {RANGES.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => changeRange(option.value)}
            aria-pressed={range === option.value}
            disabled={analyticsLoading}
            className={cn(
              'inline-flex min-h-[40px] cursor-pointer items-center rounded-lg px-4 text-sm font-semibold transition-colors duration-200 disabled:cursor-wait disabled:opacity-60',
              range === option.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Analytics section: atomic summary or a real error — never zeros. */}
      {analyticsLoading ? (
        <div role="status" aria-label="Loading dashboard analytics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} aria-hidden="true" className="h-32 animate-pulse rounded-xl bg-surface-muted" />
          ))}
        </div>
      ) : summaryStatus === 'error' && !summary ? (
        <ErrorState
          title="Couldn’t load dashboard analytics"
          message={summaryError}
          onRetry={() => loadSummary(range)}
        />
      ) : summary ? (
        <>
          {summaryError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
              <p className="text-sm font-medium text-destructive">
                Refresh failed ({summaryError}) — showing the last good values.
              </p>
              <Button variant="secondary" size="sm" onClick={() => loadSummary(range)}>
                Try again
              </Button>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={analyticsRefreshing || undefined}>
            {heroCards.map((card) => (
              <div
                key={card.title}
                className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-5 shadow-sm"
              >
                <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {card.title} · {range}
                </span>
                <span aria-live="polite" className="text-2xl font-extrabold tabular-nums text-foreground">
                  {card.stat}
                </span>
                <span className="text-[13px] leading-5 text-muted-foreground">{card.description}</span>
                {card.to ? (
                  <Link
                    to={card.to}
                    className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-semibold text-primary hover:no-underline"
                  >
                    {card.linkLabel}
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section
              aria-label={`Revenue trend, ${RANGE_CAPTIONS[range]}`}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold text-foreground">Revenue trend</h3>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {formatINR(summary.period?.revenue)} in this {range} · {RANGE_CAPTIONS[range]}
                </p>
              </div>
              <TrendChart
                title={`Revenue in this ${range}`}
                buckets={summary.buckets ?? []}
                valueKey="revenue"
                formatValue={(value) => formatINR(value)}
                formatBucket={(bucketStart) => formatBucketLabel(bucketStart, granularity)}
                emptyMessage="No recognized revenue in this period yet."
                tone="revenue"
              />
            </section>
            <section
              aria-label={`Order trend, ${RANGE_CAPTIONS[range]}`}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold text-foreground">Order trend</h3>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {formatCount(summary.period?.orders)} received in this {range} · {RANGE_CAPTIONS[range]}
                </p>
              </div>
              <TrendChart
                title={`Orders received in this ${range}`}
                buckets={summary.buckets ?? []}
                valueKey="orders"
                formatValue={(value) => formatCount(value)}
                formatBucket={(bucketStart) => formatBucketLabel(bucketStart, granularity)}
                emptyMessage="No orders received in this period yet."
                tone="primary"
              />
            </section>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-bold text-foreground">What “recognized revenue” means</h3>
            <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
              SUM of order grand totals over DELIVERED orders whose latest payment is PAID
              (cash collected on Cash on Delivery). Cancelled orders, in-flight orders
              (pending → shipped), and unpaid, failed, or refunded payments are excluded.
              Attributed to order creation time (UTC). Refunds are recorded states, not
              payouts — a refunded order simply stops counting.
            </p>
          </div>
        </>
      ) : null}

      {/* Operations section: independent loading/error from analytics. */}
      <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Operations</h3>
      {opsLoading ? (
        <div role="status" aria-label="Loading operational data" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} aria-hidden="true" className="h-28 animate-pulse rounded-xl bg-surface-muted" />
          ))}
        </div>
      ) : opsStatus === 'error' ? (
        <ErrorState title="Couldn’t load operational data" message={opsError} onRetry={refresh} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {opsCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.to}
                  to={card.to}
                  className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:no-underline"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-surface-muted text-primary">
                    <Icon size={22} aria-hidden="true" />
                  </span>
                  <span className="text-base font-bold text-foreground">{card.title}</span>
                  <span aria-live="polite" className="text-2xl font-extrabold tabular-nums text-foreground">
                    {card.stat}
                  </span>
                  <span className="text-[13px] leading-5 text-muted-foreground">{card.description}</span>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-semibold text-primary">
                    Open {card.title.toLowerCase()}
                    <ArrowRight size={15} aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-0.5" />
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section aria-label="Recent orders" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-foreground">Recent orders</h3>
                <Link to="/orders" className="text-sm font-semibold text-primary hover:no-underline">
                  All orders
                </Link>
              </div>
              {recentOrders.length === 0 ? (
                <p className="rounded-lg bg-surface-muted px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
                  No orders placed yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {recentOrders.map((order) => (
                    <li key={order.id}>
                      <Link
                        to={`/orders/${order.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3.5 py-2.5 transition-colors hover:bg-surface-muted hover:no-underline"
                      >
                        <span className="text-sm font-semibold text-foreground">{order.orderNumber}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatINR(order.grandTotal)} · {formatDate(order.createdAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Catalog" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-sm font-bold text-foreground">Catalog</h3>
              <Link
                to="/catalog/categories"
                className="group flex items-center justify-between gap-2 rounded-lg border border-border px-3.5 py-2.5 transition-colors hover:bg-surface-muted hover:no-underline"
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FolderTree size={16} aria-hidden="true" className="text-muted-foreground" />
                  Categories
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {tree.length} parent · {subcategoryCount} sub
                </span>
              </Link>
              <Link
                to="/catalog/products"
                className="group flex items-center justify-between gap-2 rounded-lg border border-border px-3.5 py-2.5 transition-colors hover:bg-surface-muted hover:no-underline"
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Package size={16} aria-hidden="true" className="text-muted-foreground" />
                  Products
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  <ShoppingCart size={16} aria-hidden="true" className="mr-1 inline" />
                  {formatCount(activeProducts?.length ?? 0)} active
                </span>
              </Link>
              <p className="text-[13px] leading-6 text-muted-foreground">
                Categories and products are read from and written to the Tech Pulse API
                (`/api/v1`). Order, customer, and review totals above come from
                authoritative server pagination metadata — never page-length arithmetic.
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

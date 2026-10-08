import { useEffect, useState } from 'react';
import { ChartColumn } from 'lucide-react';
import { useAuditDashboardStore } from '../stores/useAuditDashboardStore.js';
import { useAuthStore } from '../stores/useAuthStore.js';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { TrendChart } from '../components/dashboard/TrendChart.jsx';
import { formatDate, formatDateTime } from '../lib/format.js';

/**
 * Audit Dashboard (`/audit-dashboard`): read-only analytics over the
 * role-scoped audit trail, via `GET /audit-logs/summary`. Every
 * number on this page aggregates EXACTLY the rows the viewer could
 * list (MEMBER self-only, HEAD self+members, ADMIN company,
 * SUPER_ADMIN selected scope) — the backend enforces it; the UI
 * only forwards filters and renders the returned summary.
 *
 * Filters map 1:1 to backend params (`from/to/action/resource/
 * outcome`, plus `companyId` for SUPER_ADMIN only — company users
 * never see a company selector). No invented params, no
 * client-side slicing, no mutation controls of any kind.
 */
const ACTION_OPTIONS = ['CREATED', 'UPDATED', 'DEACTIVATED', 'REACTIVATED', 'DELETED', 'SUSPENDED', 'RESTORED'];
const RESOURCE_OPTIONS = [
  'USER',
  'COMPANY',
  'COMPANY_DOMAIN',
  'PRODUCT',
  'PRODUCT_VARIANT',
  'CATEGORY',
  'INVENTORY',
  'ORDER',
  'COUPON',
  'REVIEW',
  'NOTIFICATION',
  'ANNOUNCEMENT',
  'MARKETING',
  'AUTH',
  'RETURN',
  'AUDIT_RETENTION',
];
const OUTCOME_OPTIONS = ['SUCCESS', 'FAILURE'];

const selectClass =
  'min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30';

const inputClass =
  'min-h-[44px] w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 hover:border-border-strong';

function shortId(value) {
  if (typeof value !== 'string' || value === '') return '—';
  return value.length > 13 ? `${value.slice(0, 8)}…` : value;
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function countFor(entries, key) {
  const found = (entries ?? []).find((entry) => entry.key === key);
  return found ? found.count : 0;
}

export function AuditDashboardPage() {
  const summary = useAuditDashboardStore((state) => state.summary);
  const filters = useAuditDashboardStore((state) => state.filters);
  const status = useAuditDashboardStore((state) => state.status);
  const error = useAuditDashboardStore((state) => state.error);
  const refreshSummary = useAuditDashboardStore((state) => state.refreshSummary);
  const clearFilters = useAuditDashboardStore((state) => state.clearFilters);
  const ensureSummary = useAuditDashboardStore((state) => state.ensureSummary);
  const user = useAuthStore((state) => state.user);

  // Company scope is SUPER_ADMIN-only: the backend ignores it for
  // every other role, so it is not rendered for company users at
  // all (same pattern as the audit-log list page).
  const [companyDraft, setCompanyDraft] = useState(filters.companyId ?? '');

  const isSuperAdmin = Array.isArray(user?.roles) && user.roles.includes('SUPER_ADMIN');

  useEffect(() => {
    document.title = 'Audit Dashboard — Tech Pulse Admin';
    ensureSummary();
  }, [ensureSummary]);

  const isLoading = status === 'idle' || status === 'loading';
  const hasActiveFilters = Object.values(filters).some((value) => value !== '');

  const applyCompanyFilter = () => {
    refreshSummary({ filters: { ...filters, companyId: companyDraft.trim() } });
  };

  const handleFilterChange = (patch) => {
    refreshSummary({ filters: { ...filters, ...patch } });
  };

  const handleClearAll = () => {
    setCompanyDraft('');
    clearFilters();
  };

  const meta = isLoading
    ? 'Loading audit analytics…'
    : summary
      ? `${summary.total} ${summary.total === 1 ? 'event' : 'events'}`
      : '';

  // The hand-rolled TrendChart renders `{ bucketStart, orders }`
  // buckets verbatim (no interpolation); daily audit counts map
  // onto that shape directly.
  const buckets = (summary?.byDay ?? []).map((bucket) => ({ bucketStart: bucket.date, orders: bucket.count }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Audit Dashboard"
        description="Aggregate activity across the audit events you are allowed to see."
        meta={meta}
        actions={
          <Button variant="secondary" size="sm" onClick={() => refreshSummary()} disabled={isLoading}>
            Refresh
          </Button>
        }
      />

      {!isLoading && !error && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="audit-summary-action" className="sr-only">
              Filter by action
            </label>
            <select
              id="audit-summary-action"
              value={filters.action}
              onChange={(event) => handleFilterChange({ action: event.target.value })}
              className={selectClass}
            >
              <option value="">All actions</option>
              {ACTION_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <label htmlFor="audit-summary-resource" className="sr-only">
              Filter by resource
            </label>
            <select
              id="audit-summary-resource"
              value={filters.resource}
              onChange={(event) => handleFilterChange({ resource: event.target.value })}
              className={selectClass}
            >
              <option value="">All resources</option>
              {RESOURCE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <label htmlFor="audit-summary-outcome" className="sr-only">
              Filter by outcome
            </label>
            <select
              id="audit-summary-outcome"
              value={filters.outcome}
              onChange={(event) => handleFilterChange({ outcome: event.target.value })}
              className={selectClass}
            >
              <option value="">All outcomes</option>
              {OUTCOME_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <label htmlFor="audit-summary-from" className="sr-only">
              Filter from date
            </label>
            <input
              id="audit-summary-from"
              type="date"
              value={filters.from}
              onChange={(event) => handleFilterChange({ from: event.target.value })}
              aria-label="Filter from date"
              className="min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />

            <label htmlFor="audit-summary-to" className="sr-only">
              Filter to date
            </label>
            <input
              id="audit-summary-to"
              type="date"
              value={filters.to}
              onChange={(event) => handleFilterChange({ to: event.target.value })}
              aria-label="Filter to date"
              className="min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
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

          {isSuperAdmin ? (
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="w-full lg:max-w-xs">
                <label htmlFor="audit-summary-company" className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Company ID
                </label>
                <input
                  id="audit-summary-company"
                  type="text"
                  value={companyDraft}
                  onChange={(event) => setCompanyDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyCompanyFilter();
                  }}
                  placeholder="Company UUID"
                  autoComplete="off"
                  spellCheck={false}
                  className={inputClass}
                />
              </div>
              <div>
                <Button variant="secondary" size="sm" onClick={applyCompanyFilter}>
                  Apply
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label="Loading audit analytics" className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load audit analytics" message={error.message} onRetry={() => refreshSummary()} />
      ) : !summary || summary.total === 0 ? (
        <EmptyState
          icon={ChartColumn}
          title="No audit activity"
          message={
            hasActiveFilters
              ? 'Nothing matches the current filters. Adjust or clear them to see activity.'
              : 'Audit events will appear here as they happen.'
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Total events" value={summary.total} />
            <StatCard label="Successful" value={countFor(summary.byOutcome, 'SUCCESS')} />
            <StatCard label="Failed" value={countFor(summary.byOutcome, 'FAILURE')} />
          </div>

          <section aria-label="Activity over time" className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-base font-bold text-foreground">Activity over time</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Daily event counts, {formatDate(summary.period.from)} – {formatDate(summary.period.to)} (UTC).
            </p>
            <div className="mt-4">
              <TrendChart
                title="Audit events per day"
                buckets={buckets}
                valueKey="orders"
                formatValue={(value) => `${value} ${value === 1 ? 'event' : 'events'}`}
                formatBucket={(bucketStart) => formatDate(bucketStart)}
              />
            </div>
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <section aria-label="Events by action" className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-base font-bold text-foreground">By action</h3>
              <div className="mt-3">
                <Table caption="Audit events by action" columns={[{ key: 'action', label: 'Action' }, { key: 'count', label: 'Events', numeric: true }]}>
                  {summary.byAction.map((entry) => (
                    <tr key={entry.action} className="transition-colors hover:bg-surface-muted/50">
                      <td className="px-4 py-3 font-medium text-foreground">{entry.action}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{entry.count}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            </section>

            <section aria-label="Events by resource" className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-base font-bold text-foreground">By resource</h3>
              <div className="mt-3">
                <Table caption="Audit events by resource" columns={[{ key: 'resource', label: 'Resource' }, { key: 'count', label: 'Events', numeric: true }]}>
                  {summary.byResource.map((entry) => (
                    <tr key={entry.resource} className="transition-colors hover:bg-surface-muted/50">
                      <td className="px-4 py-3 font-medium text-foreground">{entry.resource}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{entry.count}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            </section>
          </div>

          <section aria-label="Most active actors" className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-base font-bold text-foreground">Most active actors</h3>
            <p className="mt-1 text-sm text-muted-foreground">Top actors inside your visible scope only.</p>
            <div className="mt-3">
              <Table caption="Most active actors" columns={[{ key: 'actor', label: 'Actor' }, { key: 'role', label: 'Role' }, { key: 'count', label: 'Events', numeric: true }]}>
                {summary.topActors.map((actor) => (
                  <tr key={`${actor.actorId ?? 'system'}-${actor.actorRole}`} className="transition-colors hover:bg-surface-muted/50">
                    <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-foreground" title={actor.actorId ?? 'System'}>
                      {actor.actorId ? shortId(actor.actorId) : 'System'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge tone="neutral">{actor.actorRole}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{actor.count}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </section>

          {summary.recent ? (
            <section aria-label="Most recent activity" className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-base font-bold text-foreground">Most recent activity</h3>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">When</dt>
                  <dd className="mt-0.5 text-sm text-foreground" title={summary.recent.createdAt}>
                    {formatDateTime(summary.recent.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actor</dt>
                  <dd className="mt-0.5 truncate text-sm text-foreground" title={summary.recent.actorEmail ?? summary.recent.actorId ?? 'System'}>
                    {summary.recent.actorEmail && summary.recent.actorEmail.trim() !== ''
                      ? summary.recent.actorEmail
                      : (summary.recent.actorId ?? 'System')}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Event</dt>
                  <dd className="mt-0.5 text-sm text-foreground">
                    {summary.recent.action} · {summary.recent.resource}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outcome</dt>
                  <dd className="mt-0.5">
                    <Badge tone={summary.recent.outcome === 'SUCCESS' ? 'success' : 'destructive'}>
                      {summary.recent.outcome}
                    </Badge>
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

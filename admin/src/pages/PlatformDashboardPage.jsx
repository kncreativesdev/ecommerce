import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { fetchPlatformSummary } from '../services/company.service.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { Table } from '../components/ui/Table.jsx';

const COMPANY_COLUMNS = [
  { key: 'company', label: 'Company' },
  { key: 'status', label: 'Status' },
  { key: 'domain', label: 'Primary domain' },
  { key: 'users', label: 'Users', numeric: true },
  { key: 'products', label: 'Products', numeric: true },
  { key: 'orders', label: 'Orders', numeric: true },
  { key: 'actions', label: 'Actions', numeric: true },
];

function formatCount(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-IN').format(value);
}

function statusTone(status) {
  if (status === 'ACTIVE') return 'success';
  if (status === 'SUSPENDED') return 'warning';
  return 'neutral';
}

// Client-side page size for the per-company table. The summary API
// intentionally returns every company in one bounded aggregate payload
// (counts only); pagination here bounds the rendered DOM (one page of
// rows) so load cost stays flat as company count grows.
const COMPANIES_PAGE_SIZE = 20;

/**
 * Platform Dashboard (`/platform`, SUPER_ADMIN only). The dedicated
 * SUPER_ADMIN landing: platform-level aggregate information from
 * `GET /companies/summary` — company counts, status aggregates, summed
 * platform totals, and per-company aggregate counts. Aggregate-only by
 * contract: individual products, orders, customers, and inventory rows
 * are never fetched or rendered here (this page is visually distinct
 * from the company operational `DashboardPage`).
 */
export function PlatformDashboardPage() {
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setStatus('loading');
    setError(null);
    try {
      const record = await fetchPlatformSummary();
      if (!record) {
        setStatus('error');
        setError({ message: 'Platform summary is unavailable.' });
        return;
      }
      setSummary(record);
      // New data resets to the first page: a previously selected page
      // may not exist in the refreshed company set.
      setPage(1);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError({ message: err?.message ?? 'Couldn’t load platform summary.', code: err?.code });
    }
  };

  useEffect(() => {
    document.title = 'Platform Dashboard — Tech Pulse Admin';
    // Intentional mount fetch: initial status is already 'loading', so the
    // synchronous setStatus('loading') inside load bails out with no
    // cascading render; the resolving setSummary runs async after the fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const companies = Array.isArray(summary?.companies) ? summary.companies : [];
  const totals = summary?.totals ?? {};
  const totalPages = Math.max(1, Math.ceil(companies.length / COMPANIES_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visibleCompanies = companies.slice(
    (safePage - 1) * COMPANIES_PAGE_SIZE,
    safePage * COMPANIES_PAGE_SIZE,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Platform Dashboard"
        description="Aggregate-only platform overview — counts, never company operational rows."
        meta={status === 'success' ? `${summary.totalCompanies} ${summary.totalCompanies === 1 ? 'company' : 'companies'}` : undefined}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={status === 'loading'}>
            Refresh
          </Button>
        }
      />

      {status === 'loading' ? (
        <div role="status" aria-label="Loading platform summary" className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : status === 'error' ? (
        <ErrorState title="Couldn’t load platform summary" message={error?.message} onRetry={load} />
      ) : companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No companies yet"
          message="Create the first platform company to get started."
        />
      ) : (
        <>
          <section aria-label="Platform totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Companies', summary.totalCompanies],
              ['Active', summary.activeCompanies],
              ['Suspended', summary.suspendedCompanies],
              ['Users', totals.totalUsers],
              ['Products', totals.totalProducts],
              ['Orders', totals.totalOrders],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-extrabold tabular-nums text-foreground">{formatCount(value)}</p>
              </div>
            ))}
          </section>

          <section aria-label="Per-company aggregates" className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-bold tracking-tight text-foreground">Companies</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Aggregate counts per company — open Details for metadata, lifecycle, and domain management.
              </p>
            </div>
            <Table caption="Per-company aggregate statistics" columns={COMPANY_COLUMNS} minWidth="min-w-[860px]">
              {visibleCompanies.map((company) => (
                <tr key={company.id} className="transition-colors hover:bg-surface-muted/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{company.name}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={statusTone(company.status)}>{company.status}</Badge>
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 font-mono text-sm text-muted-foreground" title={company.primaryDomain ?? '—'}>
                    {company.primaryDomain ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-foreground">
                    {formatCount(company.aggregates?.totalUsers)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-foreground">
                    {formatCount(company.aggregates?.totalProducts)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-foreground">
                    {formatCount(company.aggregates?.totalOrders)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        to={`/companies/${company.id}`}
                        className="inline-flex min-h-[36px] items-center rounded-lg border border-input bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted hover:no-underline"
                      >
                        Details
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination
              page={safePage}
              totalPages={totalPages}
              totalItems={companies.length}
              pageSize={COMPANIES_PAGE_SIZE}
              itemLabel={companies.length === 1 ? 'company' : 'companies'}
              onPageChange={setPage}
            />
          </section>
        </>
      )}
    </div>
  );
}

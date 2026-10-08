import { useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { useAuditStore } from '../stores/useAuditStore.js';
import { useAuthStore } from '../stores/useAuthStore.js';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { formatDateTime } from '../lib/format.js';

/**
 * Audit Logs (`/audit-logs`): real backend data only, via the
 * role-scoped `GET /audit-logs` (ADMIN sees the own company; the
 * backend stays authoritative for HEAD/MEMBER/SUPER_ADMIN scopes).
 * Filtering/pagination are SERVER-driven — every control maps to a
 * documented query param
 * (`action/resource/outcome/role/actorId/resourceId/companyId/from/to`);
 * the store refetches on each change. No invented params, no
 * client-side slicing, no text search (the backend offers none).
 *
 * Strictly VIEW-ONLY plus CSV export: the page renders audit rows
 * and a read-only detail view, and downloads the backend CSV
 * verbatim for the current filters. It never offers edit, delete,
 * bulk, or retention controls — the backend exposes no audit
 * mutation endpoints.
 */
const AUDIT_COLUMNS = [
  { key: 'time', label: 'Date/Time' },
  { key: 'actor', label: 'Actor' },
  { key: 'role', label: 'Role' },
  { key: 'action', label: 'Action' },
  { key: 'resource', label: 'Resource' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'company', label: 'Company' },
  { key: 'detail', label: 'Detail' },
];

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
const ROLE_OPTIONS = ['SUPER_ADMIN', 'ADMIN', 'HEAD', 'MEMBER', 'CUSTOMER'];

const selectClass =
  'min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30';

const inputClass =
  'min-h-[44px] w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 hover:border-border-strong';

function shortId(value) {
  if (typeof value !== 'string' || value === '') return '—';
  return value.length > 13 ? `${value.slice(0, 8)}…` : value;
}

function actorLabel(log) {
  if (typeof log?.actorEmail === 'string' && log.actorEmail.trim() !== '') return log.actorEmail;
  if (typeof log?.actorId === 'string' && log.actorId !== '') return shortId(log.actorId);
  return 'System';
}

function outcomeTone(outcome) {
  if (outcome === 'SUCCESS') return 'success';
  if (outcome === 'FAILURE') return 'destructive';
  return 'neutral';
}

function DetailRow({ label, children, mono = false }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/60 py-2.5 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-[13px] text-foreground' : 'break-words text-sm text-foreground'}>
        {children}
      </dd>
    </div>
  );
}

function AuditDetail({ log, onClose }) {
  return (
    <Modal title="Audit log details" onClose={onClose}>
      <dl>
        <DetailRow label="ID" mono>{log.id}</DetailRow>
        <DetailRow label="Created at" title={log.createdAt}>
          {formatDateTime(log.createdAt)}
        </DetailRow>
        <DetailRow label="Actor">{actorLabel(log)}</DetailRow>
        <DetailRow label="Actor ID" mono>{log.actorId ?? '—'}</DetailRow>
        <DetailRow label="Actor role">
          <Badge tone="neutral">{log.actorRole}</Badge>
        </DetailRow>
        <DetailRow label="Company" mono>{log.companyId ?? 'Platform (no company scope)'}</DetailRow>
        <DetailRow label="Action">{log.action}</DetailRow>
        <DetailRow label="Resource">{log.resource}</DetailRow>
        <DetailRow label="Resource ID" mono>{log.resourceId ?? '—'}</DetailRow>
        <DetailRow label="Outcome">
          <Badge tone={outcomeTone(log.outcome)}>{log.outcome}</Badge>
        </DetailRow>
        <DetailRow label="Details">
          {log.details === null || log.details === undefined ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <pre className="max-h-64 overflow-auto rounded-lg bg-surface-muted p-3 font-mono text-xs leading-5 text-foreground">
              {JSON.stringify(log.details, null, 2)}
            </pre>
          )}
        </DetailRow>
      </dl>
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

export function AuditLogsPage() {
  const logs = useAuditStore((state) => state.logs);
  const pagination = useAuditStore((state) => state.pagination);
  const filters = useAuditStore((state) => state.filters);
  const status = useAuditStore((state) => state.status);
  const error = useAuditStore((state) => state.error);
  const exporting = useAuditStore((state) => state.exporting);
  const refreshLogs = useAuditStore((state) => state.refreshLogs);
  const setPage = useAuditStore((state) => state.setPage);
  const clearFilters = useAuditStore((state) => state.clearFilters);
  const ensureLogs = useAuditStore((state) => state.ensureLogs);
  const exportLogs = useAuditStore((state) => state.exportLogs);
  const user = useAuthStore((state) => state.user);

  // Text inputs stay local until applied (avoids a request per
  // keystroke); selects and date pickers apply immediately via the
  // store (server fetch). Company scope is SUPER_ADMIN-only: the
  // backend ignores it for every other role, so it is not rendered
  // for company users at all.
  const [actorDraft, setActorDraft] = useState(filters.actorId ?? '');
  const [resourceDraft, setResourceDraft] = useState(filters.resourceId ?? '');
  const [companyDraft, setCompanyDraft] = useState(filters.companyId ?? '');
  const [selected, setSelected] = useState(null);

  const isSuperAdmin = Array.isArray(user?.roles) && user.roles.includes('SUPER_ADMIN');

  useEffect(() => {
    document.title = 'Audit Logs — Tech Pulse Admin';
    ensureLogs();
  }, [ensureLogs]);

  const isLoading = status === 'idle' || status === 'loading';
  const hasActiveFilters = Object.values(filters).some((value) => value !== '');

  const applyTextFilters = () => {
    refreshLogs({
      filters: {
        ...filters,
        actorId: actorDraft.trim(),
        resourceId: resourceDraft.trim(),
        companyId: companyDraft.trim(),
      },
    });
  };

  const handleFilterChange = (patch) => {
    refreshLogs({ filters: { ...filters, ...patch } });
  };

  const handleClearAll = () => {
    setActorDraft('');
    setResourceDraft('');
    setCompanyDraft('');
    clearFilters();
  };

  const meta = isLoading ? 'Loading audit logs…' : `${pagination.total} ${pagination.total === 1 ? 'entry' : 'entries'}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Audit Logs"
        description="Immutable security and administrative trail — who changed what, and when."
        meta={meta}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => refreshLogs()} disabled={isLoading}>
              Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={() => exportLogs()} loading={exporting} disabled={isLoading}>
              <Download size={15} aria-hidden="true" />
              Export CSV
            </Button>
          </>
        }
      />

      {!isLoading && !error && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="audit-action-filter" className="sr-only">
              Filter by action
            </label>
            <select
              id="audit-action-filter"
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

            <label htmlFor="audit-resource-filter" className="sr-only">
              Filter by resource
            </label>
            <select
              id="audit-resource-filter"
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

            <label htmlFor="audit-outcome-filter" className="sr-only">
              Filter by outcome
            </label>
            <select
              id="audit-outcome-filter"
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

            <label htmlFor="audit-role-filter" className="sr-only">
              Filter by actor role
            </label>
            <select
              id="audit-role-filter"
              value={filters.role}
              onChange={(event) => handleFilterChange({ role: event.target.value })}
              className={selectClass}
            >
              <option value="">All roles</option>
              {ROLE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <label htmlFor="audit-from-filter" className="sr-only">
              Filter from date
            </label>
            <input
              id="audit-from-filter"
              type="date"
              value={filters.from}
              onChange={(event) => handleFilterChange({ from: event.target.value })}
              aria-label="Filter from date"
              className="min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />

            <label htmlFor="audit-to-filter" className="sr-only">
              Filter to date
            </label>
            <input
              id="audit-to-filter"
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

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="w-full lg:max-w-xs">
              <label htmlFor="audit-actor-filter" className="mb-1 block text-xs font-semibold text-muted-foreground">
                Actor ID
              </label>
              <input
                id="audit-actor-filter"
                type="text"
                value={actorDraft}
                onChange={(event) => setActorDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyTextFilters();
                }}
                placeholder="User UUID"
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
              />
            </div>
            <div className="w-full lg:max-w-xs">
              <label htmlFor="audit-resource-id-filter" className="mb-1 block text-xs font-semibold text-muted-foreground">
                Resource ID
              </label>
              <input
                id="audit-resource-id-filter"
                type="text"
                value={resourceDraft}
                onChange={(event) => setResourceDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyTextFilters();
                }}
                placeholder="Target UUID"
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
              />
            </div>
            {isSuperAdmin ? (
              <div className="w-full lg:max-w-xs">
                <label htmlFor="audit-company-filter" className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Company ID
                </label>
                <input
                  id="audit-company-filter"
                  type="text"
                  value={companyDraft}
                  onChange={(event) => setCompanyDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyTextFilters();
                  }}
                  placeholder="Company UUID"
                  autoComplete="off"
                  spellCheck={false}
                  className={inputClass}
                />
              </div>
            ) : null}
            <div>
              <Button variant="secondary" size="sm" onClick={applyTextFilters}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label="Loading audit logs" className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load audit logs" message={error.message} onRetry={() => refreshLogs()} />
      ) : logs.length === 0 && !hasActiveFilters ? (
        <EmptyState
          icon={FileText}
          title="No audit logs yet"
          message="Security and administrative events will appear here as they happen."
        />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No audit logs match"
          message="Nothing matches the current filters. Adjust or clear them to see more entries."
        />
      ) : (
        <>
          <Table caption="Audit logs" columns={AUDIT_COLUMNS} minWidth="min-w-[1020px]">
            {logs.map((log) => (
              <tr key={log.id} className="transition-colors hover:bg-surface-muted/50">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground" title={log.createdAt}>
                  {formatDateTime(log.createdAt)}
                </td>
                <td className="max-w-[220px] truncate px-4 py-3 font-medium text-foreground" title={log.actorEmail ?? log.actorId ?? 'System'}>
                  {actorLabel(log)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Badge tone="neutral">{log.actorRole}</Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">{log.action}</td>
                <td className="whitespace-nowrap px-4 py-3 text-foreground">{log.resource}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Badge tone={outcomeTone(log.outcome)}>{log.outcome}</Badge>
                </td>
                <td className="max-w-[180px] truncate px-4 py-3 font-mono text-xs text-muted-foreground" title={log.companyId ?? 'Platform'}>
                  {log.companyId ? shortId(log.companyId) : 'Platform'}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setSelected(log)}
                    aria-label={`View audit log details from ${formatDateTime(log.createdAt)}`}
                    className="inline-flex min-h-[36px] cursor-pointer items-center rounded-lg px-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            itemLabel={pagination.total === 1 ? 'entry' : 'entries'}
            onPageChange={setPage}
            disabled={isLoading}
          />
        </>
      )}

      {selected ? <AuditDetail log={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

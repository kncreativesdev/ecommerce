import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Globe, Plus, Search, Trash2, X } from 'lucide-react';
import { useCompanyStore } from '../stores/useCompanyStore.js';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { Field, Input } from '../components/ui/Field.jsx';
import { formatDate } from '../lib/format.js';

/**
 * Companies (`/companies`): SUPER_ADMIN-only platform management.
 * Read-only-first list over `GET /companies` — rows carry platform
 * metadata only (name, status, domains, timestamps);
 * operational rows (products, orders, customers, inventory) are
 * never fetched or rendered. The redundant Admin Status column was
 * removed (exactly one ADMIN per company by invariant — presence is
 * shown on the detail page instead); each row carries a Details
 * action to `/companies/:id` (metadata + aggregates + rename).
 * Lifecycle and credential mutations
 * (`POST` suspend/restore/admin, `POST` admin password) refetch the
 * list instead of assuming rows are still current. Backend
 * authorization stays authoritative. Permanent deletion lives on the
 * company detail page (`/companies/:id` danger zone) with the same
 * safeguards (SUSPENDED state plus exact name entry; protected
 * Company #1 is never deletable). The per-row Domains control opens
 * the registry modal (Phase 2C-27): domain list with primary/active
 * badges, add-domain form, primary promotion, active toggles, and
 * guarded removal — all server-driven with refetch after every
 * mutation.
 */
const COMPANY_COLUMNS = [
  { key: 'company', label: 'Company' },
  { key: 'status', label: 'Status' },
  { key: 'domains', label: 'Domains' },
  { key: 'created', label: 'Created' },
  { key: 'actions', label: 'Actions', numeric: true },
];

const DOMAIN_COLUMNS = [
  { key: 'domain', label: 'Domain' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions', numeric: true },
];

const selectClass =
  'min-h-[44px] cursor-pointer rounded-lg border border-input bg-surface px-3 text-sm text-foreground transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30';

function shortId(value) {
  if (typeof value !== 'string' || value === '') return '—';
  return value.length > 13 ? `${value.slice(0, 8)}…` : value;
}

function primaryDomain(company) {
  const domains = Array.isArray(company?.domains) ? company.domains : [];
  const primary = domains.find((entry) => entry.isPrimary) ?? domains[0];
  return primary?.domain ?? (domains.length > 0 ? `${domains.length} domain(s)` : '—');
}

function statusTone(status) {
  if (status === 'ACTIVE') return 'success';
  if (status === 'SUSPENDED') return 'warning';
  return 'neutral';
}

const initialCreate = { name: '' };
const initialProvision = { email: '', password: '', firstName: '', lastName: '', phone: '' };

export function CompaniesPage() {
  const navigate = useNavigate();
  const companies = useCompanyStore((state) => state.companies);
  const pagination = useCompanyStore((state) => state.pagination);
  const filters = useCompanyStore((state) => state.filters);
  const status = useCompanyStore((state) => state.status);
  const error = useCompanyStore((state) => state.error);
  const mutating = useCompanyStore((state) => state.mutating);
  const refreshCompanies = useCompanyStore((state) => state.refreshCompanies);
  const setPage = useCompanyStore((state) => state.setPage);
  const clearFilters = useCompanyStore((state) => state.clearFilters);
  const ensureCompanies = useCompanyStore((state) => state.ensureCompanies);
  const createNewCompany = useCompanyStore((state) => state.createNewCompany);
  const suspendOneCompany = useCompanyStore((state) => state.suspendOneCompany);
  const restoreOneCompany = useCompanyStore((state) => state.restoreOneCompany);
  const provisionAdmin = useCompanyStore((state) => state.provisionAdmin);
  const resetAdminPassword = useCompanyStore((state) => state.resetAdminPassword);
  const domainsCompany = useCompanyStore((state) => state.domainsCompany);
  const companyDomains = useCompanyStore((state) => state.companyDomains);
  const domainsStatus = useCompanyStore((state) => state.domainsStatus);
  const domainsError = useCompanyStore((state) => state.domainsError);
  const openCompanyDomains = useCompanyStore((state) => state.openCompanyDomains);
  const closeCompanyDomains = useCompanyStore((state) => state.closeCompanyDomains);
  const refreshCompanyDomains = useCompanyStore((state) => state.refreshCompanyDomains);
  const createNewDomain = useCompanyStore((state) => state.createNewDomain);
  const updateDomainState = useCompanyStore((state) => state.updateDomainState);
  const deleteDomain = useCompanyStore((state) => state.deleteDomain);

  // Search input is local until submitted (avoids a request per keystroke);
  // every other control applies immediately via the store (server fetch).
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(initialCreate);
  const [createError, setCreateError] = useState(null);
  const [suspendTarget, setSuspendTarget] = useState(null);
  const [provisionTarget, setProvisionTarget] = useState(null);
  const [provisionForm, setProvisionForm] = useState(initialProvision);
  const [provisionError, setProvisionError] = useState(null);
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ password: '', confirm: '' });
  const [passwordError, setPasswordError] = useState(null);
  const [domainDraft, setDomainDraft] = useState('');
  const [domainError, setDomainError] = useState(null);
  const [domainDeleteId, setDomainDeleteId] = useState(null);

  useEffect(() => {
    document.title = 'Companies — Tech Pulse Admin';
    ensureCompanies();
  }, [ensureCompanies]);

  const isLoading = status === 'idle' || status === 'loading';
  const busy = mutating !== null;
  const hasActiveFilters = Boolean(filters.search || filters.status);

  const applySearch = () => {
    refreshCompanies({ filters: { ...filters, search: searchDraft.trim() } });
  };

  const handleClearAll = () => {
    setSearchDraft('');
    clearFilters();
  };

  const closeCreate = () => {
    if (mutating === 'create') return;
    setCreateOpen(false);
    setCreateForm(initialCreate);
    setCreateError(null);
  };

  const submitCreate = async () => {
    const name = createForm.name.trim();
    if (name === '') {
      setCreateError('Company name is required.');
      return;
    }
    setCreateError(null);
    // The store sends exactly `{ name }` — UUID and ACTIVE status are
    // assigned server-side and can never be chosen client-side.
    const { ok } = await createNewCompany(name);
    if (ok) closeCreate();
  };

  const closeProvision = () => {
    if (mutating === 'provision') return;
    setProvisionTarget(null);
    setProvisionForm(initialProvision);
    setProvisionError(null);
  };

  const submitProvision = async () => {
    const email = provisionForm.email.trim();
    const firstName = provisionForm.firstName.trim();
    if (email === '' || firstName === '') {
      setProvisionError('Email and first name are required.');
      return;
    }
    if (provisionForm.password.length < 8) {
      setProvisionError('Password must be at least 8 characters.');
      return;
    }
    setProvisionError(null);
    // The backend returns the safe admin user only — the password is
    // request-only here: never displayed, copied, logged, or stored.
    const { ok } = await provisionAdmin(provisionTarget, {
      email,
      password: provisionForm.password,
      firstName,
      lastName: provisionForm.lastName.trim(),
      phone: provisionForm.phone.trim(),
    });
    if (ok) closeProvision();
  };

  const closePasswordReset = () => {
    if (mutating === 'reset-password') return;
    setPasswordTarget(null);
    setPasswordForm({ password: '', confirm: '' });
    setPasswordError(null);
  };

  const submitPasswordReset = async () => {
    if (passwordForm.password.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    if (passwordForm.password !== passwordForm.confirm) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setPasswordError(null);
    const { ok } = await resetAdminPassword(passwordTarget, { password: passwordForm.password });
    if (ok) closePasswordReset();
  };

  const openDomains = (company) => {
    setDomainDraft('');
    setDomainError(null);
    setDomainDeleteId(null);
    openCompanyDomains(company);
  };

  const closeDomains = () => {
    if (busy) return;
    setDomainDraft('');
    setDomainError(null);
    setDomainDeleteId(null);
    closeCompanyDomains();
  };

  const submitDomain = async () => {
    const value = domainDraft.trim();
    if (value === '') {
      setDomainError('Domain is required.');
      return;
    }
    setDomainError(null);
    // The service sends exactly `{ domain }` for the route company —
    // canonicalization and validity are enforced server-side.
    const { ok } = await createNewDomain(domainsCompany, value);
    if (ok) setDomainDraft('');
  };

  const meta = isLoading
    ? 'Loading companies…'
    : `${pagination.total} ${pagination.total === 1 ? 'company' : 'companies'}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Companies"
        description="Platform company lifecycle — suspension pauses a store without deleting anything."
        meta={meta}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => refreshCompanies()} disabled={isLoading}>
              Refresh
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)} disabled={isLoading}>
              <Plus size={15} aria-hidden="true" />
              New company
            </Button>
          </>
        }
      />

      {!isLoading && !error && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div role="search" className="relative w-full lg:max-w-md">
              <label htmlFor="company-search" className="sr-only">
                Search companies by name
              </label>
              <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="company-search"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applySearch();
                }}
                placeholder="Search company name…"
                autoComplete="off"
                className="min-h-[44px] w-full rounded-lg border border-input bg-surface pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-200 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 hover:border-border-strong"
              />
              {searchDraft ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchDraft('');
                    refreshCompanies({ filters: { ...filters, search: '' } });
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
            <label htmlFor="company-status-filter" className="sr-only">
              Filter by status
            </label>
            <select
              id="company-status-filter"
              value={filters.status}
              onChange={(event) => refreshCompanies({ filters: { ...filters, status: event.target.value } })}
              className={selectClass}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
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
        <div role="status" aria-label="Loading companies" className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Couldn’t load companies" message={error.message} onRetry={() => refreshCompanies()} />
      ) : companies.length === 0 && !hasActiveFilters ? (
        <EmptyState
          icon={Building2}
          title="No companies yet"
          message="Create the first platform company to get started."
        />
      ) : companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No companies match"
          message="Nothing matches the current filters. Adjust or clear them to see more companies."
        />
      ) : (
        <>
          <Table caption="Platform companies" columns={COMPANY_COLUMNS} minWidth="min-w-[980px]">
            {companies.map((company) => (
              <tr key={company.id} className="transition-colors hover:bg-surface-muted/50">
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{company.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground" title={company.id}>
                    {shortId(company.id)}
                  </p>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Badge tone={statusTone(company.status)}>{company.status}</Badge>
                </td>
                <td className="max-w-[220px] truncate px-4 py-3 text-sm text-muted-foreground" title={primaryDomain(company)}>
                  {primaryDomain(company)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(company.createdAt)}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/companies/${company.id}`)}
                      disabled={busy}
                    >
                      Details
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openDomains(company)}
                      disabled={busy}
                    >
                      Domains
                    </Button>
                    {company.status === 'ACTIVE' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setSuspendTarget(company)}
                        disabled={busy}
                      >
                        Suspend
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => restoreOneCompany(company)}
                        loading={mutating === 'restore'}
                        disabled={busy}
                      >
                        Restore
                      </Button>
                    )}
                    {company.adminProvisioned ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPasswordTarget(company)}
                        disabled={busy}
                      >
                        Admin
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setProvisionTarget(company)}
                        disabled={busy}
                      >
                        Set up admin
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            itemLabel={pagination.total === 1 ? 'company' : 'companies'}
            onPageChange={setPage}
            disabled={isLoading}
          />
        </>
      )}

      {createOpen ? (
        <Modal title="New company" onClose={closeCreate} persistent={mutating === 'create'}>
          <div className="flex flex-col gap-4">
            <Field label="Company name" required error={createError}>
              {({ errorId }) => (
                <Input
                  type="text"
                  value={createForm.name}
                  onChange={(event) => setCreateForm({ name: event.target.value })}
                  placeholder="Acme Store"
                  autoComplete="off"
                  maxLength={255}
                  aria-describedby={errorId}
                  aria-invalid={Boolean(createError)}
                />
              )}
            </Field>
            <p className="text-sm leading-6 text-muted-foreground">
              The company ID is generated server-side and it starts ACTIVE. An admin can be provisioned afterwards.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={closeCreate} disabled={mutating === 'create'}>
                Cancel
              </Button>
              <Button variant="primary" loading={mutating === 'create'} onClick={submitCreate}>
                Create company
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {suspendTarget ? (
        <Modal title={`Suspend “${suspendTarget.name}”?`} onClose={() => !mutating && setSuspendTarget(null)} persistent={mutating === 'suspend'}>
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Suspension pauses the whole store immediately, but deletes nothing and is reversible at any time.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setSuspendTarget(null)} disabled={mutating === 'suspend'}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                loading={mutating === 'suspend'}
                onClick={async () => {
                  const { ok } = await suspendOneCompany(suspendTarget);
                  if (ok) setSuspendTarget(null);
                }}
              >
                Suspend company
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {provisionTarget ? (
        <Modal title={`Set up admin for “${provisionTarget.name}”`} onClose={closeProvision} persistent={mutating === 'provision'}>
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Exactly one admin exists per company. The password you choose is sent once and never shown again.
            </p>
            <Field label="Email" required error={provisionError}>
              {({ errorId }) => (
                <Input
                  type="email"
                  value={provisionForm.email}
                  onChange={(event) => setProvisionForm({ ...provisionForm, email: event.target.value })}
                  placeholder="admin@example.com"
                  autoComplete="off"
                  aria-describedby={errorId}
                  aria-invalid={Boolean(provisionError)}
                />
              )}
            </Field>
            <Field label="Password" required>
              {() => (
                <Input
                  type="password"
                  value={provisionForm.password}
                  onChange={(event) => setProvisionForm({ ...provisionForm, password: event.target.value })}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              )}
            </Field>
            <Field label="First name" required>
              {() => (
                <Input
                  type="text"
                  value={provisionForm.firstName}
                  onChange={(event) => setProvisionForm({ ...provisionForm, firstName: event.target.value })}
                  placeholder="Ada"
                  autoComplete="off"
                  maxLength={100}
                />
              )}
            </Field>
            <Field label="Last name">
              {() => (
                <Input
                  type="text"
                  value={provisionForm.lastName}
                  onChange={(event) => setProvisionForm({ ...provisionForm, lastName: event.target.value })}
                  autoComplete="off"
                  maxLength={100}
                />
              )}
            </Field>
            <Field label="Phone">
              {() => (
                <Input
                  type="tel"
                  value={provisionForm.phone}
                  onChange={(event) => setProvisionForm({ ...provisionForm, phone: event.target.value })}
                  autoComplete="off"
                  maxLength={30}
                />
              )}
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={closeProvision} disabled={mutating === 'provision'}>
                Cancel
              </Button>
              <Button variant="primary" loading={mutating === 'provision'} onClick={submitProvision}>
                Provision admin
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {passwordTarget ? (
        <Modal title={`Reset admin password for “${passwordTarget.name}”`} onClose={closePasswordReset} persistent={mutating === 'reset-password'}>
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Sets a new password for the company&apos;s designated admin. The password is sent once and never
              displayed, logged, or stored.
            </p>
            <Field label="New password" required error={passwordError}>
              {({ errorId }) => (
                <Input
                  type="password"
                  value={passwordForm.password}
                  onChange={(event) => setPasswordForm({ ...passwordForm, password: event.target.value })}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  aria-describedby={errorId}
                  aria-invalid={Boolean(passwordError)}
                />
              )}
            </Field>
            <Field label="Confirm new password" required>
              {() => (
                <Input
                  type="password"
                  value={passwordForm.confirm}
                  onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              )}
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={closePasswordReset} disabled={mutating === 'reset-password'}>
                Cancel
              </Button>
              <Button variant="primary" loading={mutating === 'reset-password'} onClick={submitPasswordReset}>
                Reset password
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {domainsCompany ? (
        <Modal title={`Domains for “${domainsCompany.name}”`} onClose={closeDomains} persistent={busy}>
          <div className="flex flex-col gap-4">
            {domainsCompany.status === 'SUSPENDED' ? (
              <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm leading-6 text-muted-foreground">
                This company is suspended: domains can be managed, but the storefront stays blocked
                until the company is restored.
              </p>
            ) : null}
            <Field label="New domain" error={domainError}>
              {({ errorId }) => (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="text"
                    value={domainDraft}
                    onChange={(event) => setDomainDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitDomain();
                    }}
                    placeholder="shop.example.com"
                    autoComplete="off"
                    maxLength={255}
                    aria-describedby={errorId}
                    aria-invalid={Boolean(domainError)}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={submitDomain}
                    loading={mutating === 'domain-create'}
                    disabled={busy}
                    className="shrink-0"
                  >
                    Add domain
                  </Button>
                </div>
              )}
            </Field>
            <p className="-mt-2 text-sm leading-6 text-muted-foreground">
              Hostnames only — no protocol, port, or path. The server canonicalizes the value.
            </p>
            {domainsStatus === 'loading' || domainsStatus === 'idle' ? (
              <div role="status" aria-label="Loading domains" className="flex flex-col gap-2">
                {[0, 1, 2].map((index) => (
                  <div key={index} aria-hidden="true" className="h-12 animate-pulse rounded-lg bg-surface-muted" />
                ))}
              </div>
            ) : domainsStatus === 'error' ? (
              <ErrorState
                title="Couldn’t load domains"
                message={domainsError?.message}
                onRetry={() => refreshCompanyDomains(domainsCompany)}
              />
            ) : companyDomains.length === 0 ? (
              <EmptyState
                icon={Globe}
                title="No domains registered"
                message="Register the first hostname so the storefront can resolve this company."
              />
            ) : (
              <Table caption={`Registered domains for ${domainsCompany.name}`} columns={DOMAIN_COLUMNS} minWidth="min-w-[560px]">
                {companyDomains.map((entry) => (
                  <tr key={entry.id} className="transition-colors hover:bg-surface-muted/50">
                    <td className="max-w-[220px] truncate px-4 py-3 font-mono text-sm text-foreground" title={entry.domain}>
                      {entry.domain}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge tone={entry.isPrimary ? 'info' : 'neutral'}>{entry.isPrimary ? 'Primary' : 'Secondary'}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge tone={entry.isActive ? 'success' : 'neutral'}>{entry.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {domainDeleteId === entry.id ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-sm text-muted-foreground">Remove this domain?</span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setDomainDeleteId(null)}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            loading={mutating === 'domain-delete'}
                            disabled={busy}
                            onClick={async () => {
                              const { ok } = await deleteDomain(domainsCompany, entry);
                              if (ok) setDomainDeleteId(null);
                            }}
                          >
                            Remove domain
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          {entry.isPrimary ? null : (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => updateDomainState(domainsCompany, entry.id, { isPrimary: true })}
                              loading={mutating === 'domain-update'}
                              disabled={busy}
                            >
                              Make primary
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => updateDomainState(domainsCompany, entry.id, { isActive: !entry.isActive })}
                            loading={mutating === 'domain-update'}
                            disabled={busy}
                          >
                            {entry.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDomainDeleteId(entry.id)}
                            disabled={busy || (entry.isPrimary && companyDomains.length > 1)}
                            title={
                              entry.isPrimary && companyDomains.length > 1
                                ? 'Promote another domain before removing the primary'
                                : 'Remove domain'
                            }
                            aria-label={`Remove ${entry.domain}`}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                            <span className="sr-only">Remove</span>
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={closeDomains} disabled={busy}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

    </div>
  );
}

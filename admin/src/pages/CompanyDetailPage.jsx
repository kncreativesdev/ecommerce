import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, ChevronRight, Pencil, Trash2, Upload } from 'lucide-react';
import {
  deleteCompanyLogo,
  fetchCompanyById,
  isProtectedCompany,
  resolveCompanyLogoUrl,
  updateCompany,
  uploadCompanyLogo,
} from '../services/company.service.js';
import { MEDIA_ALLOWED_EXTENSIONS, MEDIA_MAX_FILE_SIZE } from '../services/media.service.js';
import { useCompanyStore } from '../stores/useCompanyStore.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { Field, Input } from '../components/ui/Field.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { Table } from '../components/ui/Table.jsx';
import { formatDate, formatDateTime } from '../lib/format.js';

const DOMAIN_COLUMNS = [
  { key: 'domain', label: 'Domain' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
];

const PROFILE_FIELDS = [
  { key: 'contactEmail', label: 'Contact email', maxLength: 255, placeholder: 'support@acme.test' },
  { key: 'contactPhone', label: 'Contact phone', maxLength: 30, placeholder: '+1-555-0100' },
  { key: 'addressLine1', label: 'Address line 1', maxLength: 255, placeholder: '1 Market Street' },
  { key: 'addressLine2', label: 'Address line 2', maxLength: 255, placeholder: 'Suite 400' },
  { key: 'city', label: 'City', maxLength: 100, placeholder: 'Springfield' },
  { key: 'state', label: 'State / Province', maxLength: 100, placeholder: 'IL' },
  { key: 'postalCode', label: 'Postal code', maxLength: 20, placeholder: '62701' },
  { key: 'country', label: 'Country', maxLength: 100, placeholder: 'USA' },
  { key: 'website', label: 'Website', maxLength: 500, placeholder: 'https://acme.test' },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function statusTone(status) {
  if (status === 'ACTIVE') return 'success';
  if (status === 'SUSPENDED') return 'warning';
  return 'neutral';
}

function formatCount(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-IN').format(value);
}

function displayValue(value) {
  return typeof value === 'string' && value !== '' ? value : 'Not provided';
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function validateProfileForm(form) {
  const errors = {};
  if (form.name.trim() === '') {
    errors.name = 'Company name is required.';
  } else if (form.name.trim().length > 255) {
    errors.name = 'Company name must be 255 characters or fewer.';
  }
  if (form.contactEmail.trim() !== '') {
    if (form.contactEmail.trim().length > 255 || !EMAIL_PATTERN.test(form.contactEmail.trim())) {
      errors.contactEmail = 'Enter a valid email address.';
    }
  }
  if (form.contactPhone.trim().length > 30) {
    errors.contactPhone = 'Phone must be 30 characters or fewer.';
  }
  for (const field of ['addressLine1', 'addressLine2']) {
    if (form[field].trim().length > 255) {
      errors[field] = 'Must be 255 characters or fewer.';
    }
  }
  for (const field of ['city', 'state', 'country']) {
    if (form[field].trim().length > 100) {
      errors[field] = 'Must be 100 characters or fewer.';
    }
  }
  if (form.postalCode.trim().length > 20) {
    errors.postalCode = 'Must be 20 characters or fewer.';
  }
  if (form.website.trim() !== '') {
    if (form.website.trim().length > 500 || !isHttpsUrl(form.website.trim())) {
      errors.website = 'Enter a valid HTTPS URL (https://…).';
    }
  }
  return errors;
}

/**
 * Company Detail (`/companies/:id`, SUPER_ADMIN only). Loads the
 * documented `GET /companies/:id` directly (deep-link safe): platform
 * metadata (name, status, admin presence, business profile, logo,
 * domains, timestamps) plus structural aggregate counts — never
 * operational rows (products, orders, customers, inventory, reviews)
 * and never secrets.
 *
 * The generic metadata editor covers name plus the approved
 * contact/address/website profile (`PATCH /companies/:id`); lifecycle
 * state, ADMIN credentials, and domains move through their dedicated
 * surfaces and are never editable here. Permanent deletion lives in
 * the bottom danger zone (SUSPENDED + exact-name confirmation + Company
 * #1 protection, same safeguards as the company-management contract);
 * success navigates back to the Companies list. The logo travels
 * through the dedicated upload/remove endpoints (backend-managed file
 * reference — never a text field, never an external hotlink). Domain
 * management stays on the Companies list modal; this page renders the
 * registry read-only.
 */
export function CompanyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const refreshCompanies = useCompanyStore((state) => state.refreshCompanies);
  const deleteOneCompany = useCompanyStore((state) => state.deleteOneCompany);
  const [company, setCompany] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [confirmRemoveLogo, setConfirmRemoveLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const record = await fetchCompanyById(id);
      if (!record) {
        setStatus('error');
        setError({ message: 'Company not found.', code: 'COMPANY_NOT_FOUND' });
        return;
      }
      setCompany(record);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError({ message: err?.message ?? 'Couldn’t load company.', code: err?.code });
    }
  }, [id]);

  useEffect(() => {
    document.title = company ? `${company.name} — Tech Pulse Admin` : 'Company — Tech Pulse Admin';
  }, [company]);

  useEffect(() => {
    // Intentional mount fetch: initial status is already 'loading', so the
    // synchronous setStatus('loading') inside load bails out with no
    // cascading render; the resolving setCompany runs async after the fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const openEdit = () => {
    setForm({
      name: company?.name ?? '',
      contactEmail: company?.contactEmail ?? '',
      contactPhone: company?.contactPhone ?? '',
      addressLine1: company?.addressLine1 ?? '',
      addressLine2: company?.addressLine2 ?? '',
      city: company?.city ?? '',
      state: company?.state ?? '',
      postalCode: company?.postalCode ?? '',
      country: company?.country ?? '',
      website: company?.website ?? '',
    });
    setFieldErrors({});
    setFormError(null);
    setEditOpen(true);
  };

  const closeEdit = () => {
    if (saving) return;
    setEditOpen(false);
    setForm(null);
    setFieldErrors({});
    setFormError(null);
  };
  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submitEdit = async () => {
    const errors = validateProfileForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setFormError(null);
    setSaving(true);
    try {
      // Empty optionals travel as empty strings: the backend normalizes
      // them to NULL (clear). `logoPath` is never sent — logo upload and
      // removal use their dedicated endpoints below.
      const updated = await updateCompany(id, {
        name: form.name.trim(),
        contactEmail: form.contactEmail.trim(),
        contactPhone: form.contactPhone.trim(),
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        postalCode: form.postalCode.trim(),
        country: form.country.trim(),
        website: form.website.trim(),
      });
      if (updated) setCompany(updated);
      // Keep the list mirror fresh: the row changed server-side.
      refreshCompanies();
      setEditOpen(false);
      setForm(null);
    } catch (err) {
      setFormError(err?.message ?? 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const submitLogo = async (file) => {
    if (!file) return;
    setUploadError(null);
    const ext = `.${(file.name.split('.').pop() ?? '').toLowerCase()}`;
    if (!MEDIA_ALLOWED_EXTENSIONS.includes(ext)) {
      setUploadError('Only JPEG, PNG, and WebP images are allowed.');
      return;
    }
    if (file.size > MEDIA_MAX_FILE_SIZE) {
      setUploadError('Image exceeds the maximum allowed size of 5MB.');
      return;
    }
    setUploading(true);
    try {
      const updated = await uploadCompanyLogo(id, { file });
      if (updated) setCompany(updated);
      refreshCompanies();
    } catch (err) {
      setUploadError(err?.message ?? 'Logo upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const submitRemoveLogo = async () => {
    setUploadError(null);
    setRemovingLogo(true);
    try {
      const updated = await deleteCompanyLogo(id);
      if (updated) setCompany(updated);
      refreshCompanies();
      setConfirmRemoveLogo(false);
    } catch (err) {
      setUploadError(err?.message ?? 'Logo removal failed. Please try again.');
    } finally {
      setRemovingLogo(false);
    }
  };

  const openDelete = () => {
    setDeleteConfirm('');
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteOpen(false);
    setDeleteConfirm('');
    setDeleteError(null);
  };

  const submitDelete = async () => {
    // Client-side exact-match gate: a mismatch never reaches the API
    // (the backend re-checks case-sensitively regardless).
    if (deleteConfirm !== company.name) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      const { ok, error: deleteFailure } = await deleteOneCompany(company, deleteConfirm);
      if (ok) {
        navigate('/companies', { replace: true });
        return;
      }
      setDeleteError(deleteFailure?.message ?? 'Delete failed. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const aggregates = company?.aggregates ?? null;
  const domains = Array.isArray(company?.domains) ? company.domains : [];
  const logoUrl = resolveCompanyLogoUrl(company?.logoPath);
  const addressLines = [company?.addressLine1, company?.addressLine2].filter(
    (line) => typeof line === 'string' && line !== '',
  );
  const locality = [company?.city, company?.state, company?.postalCode]
    .filter((part) => typeof part === 'string' && part !== '')
    .join(', ');

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/companies" className="transition-colors hover:text-foreground hover:no-underline">
          Companies
        </Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span aria-current="page" className="text-foreground">
          {company?.name ?? 'Company'}
        </span>
      </nav>

      {status === 'loading' ? (
        <div role="status" aria-label="Loading company" className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <div key={index} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : status === 'error' ? (
        <ErrorState
          title={error?.code === 'COMPANY_NOT_FOUND' ? 'Company not found' : 'Couldn’t load company'}
          message={error?.message}
          onRetry={load}
        />
      ) : (
        <>
          <PageHeader
            title={company.name}
            description="Platform company metadata and aggregate statistics."
            meta={company.id}
            actions={
              <Button variant="secondary" size="sm" onClick={openEdit}>
                <Pencil size={15} aria-hidden="true" />
                Edit
              </Button>
            }
          />

          <section aria-label="Company metadata" className="rounded-xl border border-border bg-card p-5">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</dt>
                <dd className="mt-1">
                  <Badge tone={statusTone(company.status)}>{company.status}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Admin</dt>
                <dd className="mt-1">
                  <Badge tone={company.adminProvisioned ? 'success' : 'neutral'}>
                    {company.adminProvisioned ? 'Admin set' : 'No admin'}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Created</dt>
                <dd className="mt-1 text-sm text-foreground">{formatDateTime(company.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Updated</dt>
                <dd className="mt-1 text-sm text-foreground">{formatDateTime(company.updatedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Google sign-in</dt>
                <dd className="mt-1 text-sm text-foreground">
                  {company.googleSignInEnabled ? 'Enabled' : 'Disabled'}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-label="Business profile" className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-bold tracking-tight text-foreground">Business profile</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Business contact information maintained by SUPER_ADMIN. Empty fields show as “Not provided”.
            </p>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact email</dt>
                <dd className="mt-1 text-sm text-foreground">{displayValue(company.contactEmail)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact phone</dt>
                <dd className="mt-1 text-sm text-foreground">{displayValue(company.contactPhone)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Address</dt>
                <dd className="mt-1 text-sm text-foreground">
                  {addressLines.length > 0 ? addressLines.join(', ') : 'Not provided'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">City / State / Postal</dt>
                <dd className="mt-1 text-sm text-foreground">{locality !== '' ? locality : 'Not provided'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Country</dt>
                <dd className="mt-1 text-sm text-foreground">{displayValue(company.country)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Website</dt>
                <dd className="mt-1 text-sm text-foreground">
                  {company.website ? (
                    <a href={company.website} target="_blank" rel="noreferrer" className="underline">
                      {company.website}
                    </a>
                  ) : (
                    'Not provided'
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-label="Company logo" className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-bold tracking-tight text-foreground">Logo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Backend-managed brand file (JPEG/PNG/WebP, ≤5MB). Never an external link.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={`${company.name} logo`}
                  className="h-16 w-16 rounded-lg border border-border bg-surface-muted object-contain"
                />
              ) : (
                <div
                  aria-label="No logo"
                  className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-surface-muted text-muted-foreground"
                >
                  <Building2 size={24} aria-hidden="true" />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  className="sr-only"
                  aria-label="Choose logo file"
                  onChange={(event) => submitLogo(event.target.files?.[0] ?? null)}
                  disabled={uploading}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  loading={uploading}
                  disabled={uploading || removingLogo}
                >
                  <Upload size={15} aria-hidden="true" />
                  {company.logoPath ? 'Replace logo' : 'Upload logo'}
                </Button>
                {company.logoPath ? (
                  confirmRemoveLogo ? (
                    <>
                      <span className="text-sm text-muted-foreground">Remove this logo?</span>
                      <Button variant="secondary" size="sm" onClick={() => setConfirmRemoveLogo(false)} disabled={removingLogo}>
                        Cancel
                      </Button>
                      <Button variant="destructive" size="sm" loading={removingLogo} disabled={removingLogo} onClick={submitRemoveLogo}>
                        Remove logo
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmRemoveLogo(true)}
                      disabled={uploading || removingLogo}
                      aria-label="Remove logo"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      <span className="sr-only">Remove</span>
                    </Button>
                  )
                ) : null}
              </div>
            </div>
            {uploadError ? (
              <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
                {uploadError}
              </p>
            ) : null}
          </section>

          <section aria-label="Aggregate statistics" className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-bold tracking-tight text-foreground">Aggregate statistics</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Counts only — individual products, orders, customers, and inventory rows are never shown here.
            </p>
            {aggregates ? (
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {[
                  ['Users', aggregates.totalUsers],
                  ['Customers', aggregates.totalCustomers],
                  ['Heads', aggregates.totalHeads],
                  ['Members', aggregates.totalMembers],
                  ['Products', aggregates.totalProducts],
                  ['Orders', aggregates.totalOrders],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-surface-muted px-4 py-3">
                    <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
                    <dd className="mt-1 text-xl font-extrabold tabular-nums text-foreground">{formatCount(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">Statistics unavailable.</p>
            )}
          </section>

          <section aria-label="Registered domains" className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-bold tracking-tight text-foreground">Registered domains</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Read-only here — domain registration, promotion, and removal live on the Companies list.
              </p>
            </div>
            {domains.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No domains registered"
                message="Register a hostname from the Companies list so the storefront can resolve this company."
              />
            ) : (
              <Table caption={`Registered domains for ${company.name}`} columns={DOMAIN_COLUMNS} minWidth="min-w-[560px]">
                {domains.map((entry) => (
                  <tr key={entry.id} className="transition-colors hover:bg-surface-muted/50">
                    <td className="max-w-[260px] truncate px-4 py-3 font-mono text-sm text-foreground" title={entry.domain}>
                      {entry.domain}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge tone={entry.isPrimary ? 'info' : 'neutral'}>{entry.isPrimary ? 'Primary' : 'Secondary'}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge tone={entry.isActive ? 'success' : 'neutral'}>{entry.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="text-xs text-muted-foreground">Created {formatDate(company.createdAt)}</p>
          </section>

          <section aria-label="Danger zone" className="rounded-xl border border-destructive/40 bg-card p-5">
            <h2 className="text-base font-bold tracking-tight text-destructive">Danger zone</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Permanently delete this company and all of its data. This cannot be undone.
              Suspension deletes nothing — deletion deletes everything.
            </p>
            <div className="mt-4">
              {company.status === 'SUSPENDED' && !isProtectedCompany(company) ? (
                <Button variant="destructive" onClick={openDelete}>
                  Delete Company
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {isProtectedCompany(company)
                    ? 'This company is protected and cannot be deleted.'
                    : 'Only suspended companies can be deleted. Suspend this company from the Companies list first.'}
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {editOpen && form ? (
        <Modal title={`Edit “${company?.name}”`} onClose={closeEdit} persistent={saving}>
          <div className="flex flex-col gap-4">
            <Field label="Company name" required error={fieldErrors.name}>
              {({ errorId }) => (
                <Input
                  type="text"
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  placeholder="Acme Store"
                  autoComplete="off"
                  maxLength={255}
                  aria-describedby={errorId}
                  aria-invalid={Boolean(fieldErrors.name)}
                />
              )}
            </Field>
            {PROFILE_FIELDS.map((field) => (
              <Field key={field.key} label={field.label} error={fieldErrors[field.key]}>
                {({ errorId }) => (
                  <Input
                    type="text"
                    value={form[field.key]}
                    onChange={(event) => setField(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    maxLength={field.maxLength}
                    aria-describedby={errorId}
                    aria-invalid={Boolean(fieldErrors[field.key])}
                  />
                )}
              </Field>
            ))}
            <p className="text-sm leading-6 text-muted-foreground">
              Business contact information only — do not enter personal or non-business details.
              Empty optional fields are cleared. Status, admin credentials, domains, logo, and
              settings move through their dedicated actions.
            </p>
            {formError ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={closeEdit} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" loading={saving} onClick={submitEdit}>
                Save changes
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {deleteOpen ? (
        <Modal title={`Delete “${company?.name}” permanently?`} onClose={closeDelete} persistent={deleting}>
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-6 text-muted-foreground">
              This permanently destroys the company and all of its data. It cannot be undone. Suspension
              deletes nothing — deletion deletes everything.
            </p>
            <Field label="Type the exact company name to confirm" required error={deleteError}>
              {({ errorId }) => (
                <Input
                  type="text"
                  value={deleteConfirm}
                  onChange={(event) => {
                    setDeleteConfirm(event.target.value);
                    setDeleteError(null);
                  }}
                  placeholder={company?.name}
                  autoComplete="off"
                  maxLength={255}
                  aria-describedby={errorId}
                  aria-invalid={Boolean(deleteError)}
                />
              )}
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={closeDelete} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                loading={deleting}
                disabled={deleteConfirm !== company?.name}
                onClick={submitDelete}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

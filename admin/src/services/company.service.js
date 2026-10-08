import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost, apiPostForm } from '../lib/apiClient.js';
import { env } from '../config/env.js';

/**
 * Super Admin company-management API access (verified: backend
 * `companies.routes|controller|service|validation`, Phases
 * 2C-15/16/20/27).
 *
 * - `GET /companies` → `200 { companies[] } + meta { page, limit,
 *   total, totalPages }`. Rows carry platform metadata only
 *   (`id/name/status/adminProvisioned/domains/createdAt/updatedAt`) —
 *   never operational rows. Filters: `search`, `status`
 *   (`ACTIVE`/`SUSPENDED`). No invented params.
 * - `GET /companies/:id` → detail with structural aggregate counts
 *   (`totalUsers/totalCustomers/totalHeads/totalMembers/
 *   totalProducts/totalOrders`) — counts only, no row-level data.
 * - `GET /companies/summary` → platform aggregate summary
 *   (`totalCompanies/activeCompanies/suspendedCompanies`, summed
 *   `totals`, lean per-company rows `id/name/status/primaryDomain`
 *   + `aggregates{totalUsers,totalProducts,totalOrders}`) — the
 *   SUPER_ADMIN dashboard source; aggregate-only, never rows.
 * - `PATCH /companies/:id { name }` → renamed company detail.
 *   Rename-only metadata contract: lifecycle state, ADMIN identity,
 *   domains, and settings move through their dedicated endpoints
 *   and are rejected here by strict backend validation.
 * - `POST /companies { name }` → created company (UUID + ACTIVE
 *   assigned server-side; `id/status/adminUserId/companyId` are
 *   rejected by strict backend validation, so none are sent).
 * - `POST /companies/:id/suspend|restore` (empty body) → company.
 * - `POST /companies/:id/admin { email, password, firstName,
 *   lastName?, phone? }` → the company's one ADMIN as a safe user
 *   (the backend returns no credential — SUPER_ADMIN supplies the
 *   password, so nothing is displayed, copied, or persisted).
 * - `POST /companies/:id/admin/password { password }` → safe user.
 *   Password travels request-only: never rendered, never logged,
 *   never stored.
 * - `DELETE /companies/:id { confirmName }` → `{ deleted:
 *   { id, name } }`. The backend requires SUSPENDED status plus
 *   exact case-sensitive name confirmation and protects Company #1
 *   by UUID. No force flags, no UUID substitutes, no client-side
 *   cascade of any kind.
 *
 * Backend `authorize("SUPER_ADMIN")` stays authoritative on every
 * route; the UI merely stops rendering these controls elsewhere.
 *
 * Company #1 (the original Tech Pulse store) is permanently protected
 * from deletion by stable UUID (backend `COMPANY_PROTECTED`, never by
 * name). The UI never offers it as deletable; the constant below is
 * the single shared guard for the page and its tests.
 */
export const PROTECTED_COMPANY_ID = Object.freeze('35b5a215-0cf3-42db-ba42-6fac6656a708');

export function isProtectedCompany(company) {
  return company?.id === PROTECTED_COMPANY_ID;
}
export function fetchCompanies({ page = 1, limit = 20, search, status } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (search && search.trim() !== '') params.set('search', search.trim());
  if (status) params.set('status', status);
  // `apiGetPage` (not `apiGet`): the list envelope carries pagination
  // in top-level `meta`, which the plain data-only helper drops.
  return apiGetPage(`/companies?${params.toString()}`).then(({ data, meta }) => ({
    companies: Array.isArray(data?.companies) ? data.companies : [],
    pagination: meta ?? { page, limit, total: 0, totalPages: 1 },
  }));
}

export function fetchCompanyById(id) {
  return apiGet(`/companies/${id}`).then((data) => data?.company ?? null);
}

export function fetchPlatformSummary() {
  return apiGet('/companies/summary').then((data) => data?.summary ?? null);
}

export function renameCompany(id, { name }) {
  return updateCompany(id, { name });
}

/**
 * Company profile update — `PATCH /companies/:id` with the approved
 * metadata contract (`name?`, contact/address/website optionals;
 * blank/undefined values are OMITTED here and the backend clears only
 * explicit `null`/empty fields it receives — the page sends exactly
 * what the operator entered). `logoPath` is never sent: the logo
 * travels through the dedicated upload/remove endpoints below.
 */
export function updateCompany(id, payload) {
  const body = {};
  if (payload.name !== undefined && payload.name !== null) body.name = payload.name;
  for (const field of [
    'contactEmail',
    'contactPhone',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'postalCode',
    'country',
    'website',
  ]) {
    if (payload[field] !== undefined) body[field] = payload[field];
  }
  return apiPatch(`/companies/${id}`, body).then((data) => data?.company ?? null);
}

/**
 * Company logo (SUPER_ADMIN-only, backend-managed file reference).
 *
 * - `POST /companies/:id/logo` (multipart `image`: JPEG/PNG/WebP ≤5MB,
 *   raster content-verified server-side, WebP output under the
 *   company-prefixed branding path) → `201 { company }` with the
 *   server-stamped `logoPath`. Never a client-supplied path, never an
 *   external hotlink.
 * - `DELETE /companies/:id/logo` → `200 { company }` with `logoPath`
 *   cleared (idempotent; unknown ids → `404 COMPANY_NOT_FOUND`).
 */
export function uploadCompanyLogo(id, { file }) {
  const formData = new FormData();
  formData.append('image', file);
  return apiPostForm(`/companies/${id}/logo`, formData).then((data) => data?.company ?? null);
}

export function deleteCompanyLogo(id) {
  return apiDelete(`/companies/${id}/logo`).then((data) => data?.company ?? null);
}

/**
 * Browser URL for a company `logoPath` reference (`null` when unusable).
 * Same storage-reference contract as product/category images: join the
 * media base with the backend `storagePath`. Callers render the
 * placeholder fallback when resolution returns `null` — never an
 * external/invented URL.
 */
export function resolveCompanyLogoUrl(logoPath, mediaBaseUrl = env.mediaBaseUrl) {
  if (typeof logoPath !== 'string' || logoPath.trim() === '' || !mediaBaseUrl) return null;
  const base = mediaBaseUrl.endsWith('/') ? mediaBaseUrl.slice(0, -1) : mediaBaseUrl;
  const path = logoPath.startsWith('/') ? logoPath : `/${logoPath}`;
  return `${base}${path}`;
}

export function createCompany({ name }) {
  return apiPost('/companies', { name: name.trim() }).then((data) => data?.company ?? null);
}

export function suspendCompany(id) {
  return apiPost(`/companies/${id}/suspend`).then((data) => data?.company ?? null);
}

export function restoreCompany(id) {
  return apiPost(`/companies/${id}/restore`).then((data) => data?.company ?? null);
}

export function provisionCompanyAdmin(id, { email, password, firstName, lastName, phone }) {
  const body = { email, password, firstName };
  if (lastName !== undefined && lastName !== null && String(lastName).trim() !== '') {
    body.lastName = String(lastName).trim();
  }
  if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
    body.phone = String(phone).trim();
  }
  return apiPost(`/companies/${id}/admin`, body).then((data) => data?.admin ?? null);
}

export function resetCompanyAdminPassword(id, { password }) {
  return apiPost(`/companies/${id}/admin/password`, { password }).then((data) => data?.admin ?? null);
}

export function deleteCompany(id, { confirmName }) {
  return apiDelete(`/companies/${id}`, { body: { confirmName } }).then((data) => data?.deleted ?? null);
}

/**
 * Company domain registry (Phase 2C-27, SUPER_ADMIN-only).
 *
 * - `GET /companies/:id/domains` → `{ domains[] }` (`id/domain/
 *   isPrimary/isActive/createdAt/updatedAt` — management metadata
 *   only). Ownership is the route id; no companyId is ever sent.
 * - `POST /companies/:id/domains { domain }` → the registered
 *   domain. The hostname is trimmed here for UX; canonicalization
 *   (case/trailing-dot/port) and validity are enforced
 *   server-side — the UI never invents its own normalization.
 * - `PATCH /companies/:id/domains/:domainId { isActive?,
 *   isPrimary? }` → the updated domain. Promotion demotes the old
 *   primary atomically server-side.
 * - `DELETE /companies/:id/domains/:domainId` → `{ deleted:
 *   { id, domain } }`. The backend rejects removing a primary
 *   while siblings exist (`COMPANY_DOMAIN_IS_PRIMARY`) and
 *   demoting a primary without a successor
 *   (`COMPANY_DOMAIN_PRIMARY_REQUIRED`).
 */
export function fetchCompanyDomains(id) {
  return apiGet(`/companies/${id}/domains`).then((data) => (Array.isArray(data?.domains) ? data.domains : []));
}

export function createCompanyDomain(id, { domain }) {
  return apiPost(`/companies/${id}/domains`, { domain: domain.trim() }).then((data) => data?.domain ?? null);
}

export function updateCompanyDomain(id, domainId, patch) {
  return apiPatch(`/companies/${id}/domains/${domainId}`, patch).then((data) => data?.domain ?? null);
}

export function deleteCompanyDomain(id, domainId) {
  return apiDelete(`/companies/${id}/domains/${domainId}`).then((data) => data?.deleted ?? null);
}

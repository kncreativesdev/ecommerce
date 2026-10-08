# Tech Pulse Admin — Architecture (ADMIN_ARCHITECTURE)

Separate frontend application (`tech-pulse/admin/`) for catalog management.
The customer storefront (`tech-pulse/frontend/`) is untouched by admin code.

## 1. Separation

| Concern | Storefront (`frontend/`) | Admin (`admin/`) |
|---|---|---|
| Audience | Customers | Managers / staff with `ADMIN` role (`HEAD` shares the operational catalog/orders/inventory/coupons pages per §13) |
| Visual language | Premium black/red commerce | Neutral professional dashboard |
| Category data | Backend taxonomy + static fallback (resilience) | Backend ONLY — no fallback, never edit fabricated data |
| Auth | Customer session (future milestone) | ADMIN-gated session (this app) |
| Theme key | `tp-theme` | `tp-admin-theme` (separate origins, no collision) |

Both apps consume the SAME backend API (`/api/v1`) through their own
`VITE_API_URL`. The backend is the single source of truth.

## 2. Layering

```
Component
  ↓
Hook / Zustand store
  ↓
Service (documented endpoints only)
  ↓
lib/apiClient.js (envelope, bearer, single-flight refresh)
  ↓
Backend API
```

No `fetch()` in components. No Context/Redux. No hardcoded hosts.

## 3. Authentication

Documented contract (`backend/src/modules/auth` + `docs/SECURITY.md`):

- `POST /auth/login { email, password }` (rate-limited) →
  `200 { user, accessToken }` + HttpOnly refresh cookie (JS-invisible).
- `POST /auth/refresh` (cookie, no body) → `200 { accessToken }` + rotation.
- `POST /auth/logout` → cookie cleared.
- `GET /auth/me` (bearer) → `{ user }` with `roles[]`.
- Safe user: `{ id, email, firstName, lastName, phone, roles[], createdAt }`.

Admin app behavior (`stores/useAuthStore.js`, `lib/roles.js`):

- Access token in MEMORY ONLY (Zustand, never persisted).
- Post-login any common admin-panel role is admitted
  (`SUPER_ADMIN`/`ADMIN`/`HEAD`/`MEMBER` — single shared model,
  roles array preserved as the server sent it); CUSTOMER, unknown,
  and roleless identities are signed straight back out with
  `NOT_ADMIN`.
- Boot = one silent refresh → `GET /auth/me` → panel-role check
  (same admission rule as login).
- `apiClient` injects the bearer per request; on `401` it refreshes once
  (single-flight across concurrent calls), retries the original once, then
  clears the session and the route guard redirects to `/login?redirect=`.
- Route guards are per-branch (`ProtectedRoute allowedRoles`):
  operational routes are `ADMIN`-only except the Phase 4-1 HEAD slice
  (Categories, Products incl. variants/media/inventory managers,
  Orders, Inventory, Coupons — `ADMIN` + `HEAD`; see §13) and the
  Phase 4-5 MEMBER slice (same pages except coupon write routes —
  `ADMIN` + `HEAD` + `MEMBER`; see §14);
  `/audit-logs` + `/audit-dashboard` admit the four
  panel roles. Navigation mirrors this per item. Frontend role checks
  are UX layering; `authorize(...)` enforcement on every backend route
  is server-side and authoritative.
- Login landing is loop-free: ADMIN honors the validated `redirect`
  target; other panel roles land on `/audit-logs` (shared safe landing)
  instead of bouncing between `/` and `/login`.

## 4. Taxonomy architecture

Backend representation (verified `categories.*`): a category record carries
`{ id, name, slug, description, image, parentId, sortOrder, isActive }`.
There are NO `/subcategories` endpoints — subcategories ARE categories
whose `parentId` references another category.

```
GET /categories ──→ services/category.service.js
                        ↓
                 utils/taxonomy.js (adapt + buildCategoryTree)
                        ↓
                 stores/useCategoryStore.js (backend data only)
                  ┌──────┴──────────────┐
        CategoriesPage            ProductForm
        (tree: roots +          (Parent selector ← roots,
         children)               Sub selector ← children(parent))
```

- `GET /categories` returns ACTIVE rows by default; `?status=inactive|all`
  exposes deactivated rows to ADMIN callers (enforced by
  `requireAdminForInactiveScope` in `backend/src/modules/categories/categories.routes.js`).
  The admin list can review/restore via those scopes.
- `POST` accepts `name*` (+ optional `slug` auto-derived, `description`,
  `image`, `parentId`, `isActive`, `sortOrder`); strict bodies, `409` on
  slug clash, `404 CATEGORY_PARENT_NOT_FOUND` on unknown parents.
- `PATCH` accepts a partial subset; empty object → `422`; self-parent →
  `422 CATEGORY_SELF_PARENT`; ancestor cycles → `422 CATEGORY_CYCLE`.
  `parentId: null` IS written through on update, so a subcategory can be
  promoted to top-level via PATCH (see `updateCategory` in
  `backend/src/modules/categories/categories.service.js`).
- `DELETE` SOFT-DEACTIVATES (`isActive=false`, record kept). The admin
  labels the action "Deactivate" and removes the row from the active
  mirror. There is no hard delete and no restore endpoint.

## 5. Product category assignment

Backend (`products.validation.js`, `products.service.js`):

- Create REQUIRES `categoryId` (must reference an ACTIVE category, else
  `404 CATEGORY_NOT_FOUND`); optional `variants[]` (`sku*`, `name*`,
  `price*`, `compareAtPrice?`, `barcode?`, `weight?`, `isActive?`).
- Update accepts product fields ONLY (no `variants` key); empty object →
  `422 PRODUCT_UPDATE_INVALID`. Variants use the dedicated
  `/products/:productId/variants[/:variantId]` endpoints (follow-up).
- Reads embed a `category { id, name, slug }` brief.
- There is NO `subcategoryId` field, and strict bodies reject unknown
  fields — sending one yields `422`.

Product Form two-layer design (`utils/productPayload.js`):

```
UI selection: { parentCategoryId, subcategoryId }
        ↓  buildCreateProductPayload / buildUpdateProductPayload
Backend payload TODAY: { categoryId: parentCategoryId, ...fields }
Backend payload FUTURE: { ..., categoryId, subcategoryId }
```

The subcategory selector is fully functional as UI state (dependent
options, relationship re-checked on submit) but is never sent and never
reported as persisted — a visible note in the form states the limitation.
When the backend documents product→subcategory persistence, the single
migration point in `productPayload.js` enables it with no form, selector,
service, or validation-architecture change.

## 6. Intended final model

```
Backend Category { id, name, slug, description, image,
                   parentId, sortOrder, isActive }
        ↓ (parentId hierarchy)
Backend Subcategory (same model, parentId set)
        ↓
Admin Category CRUD → Admin Product Form
  (Parent Category selector → dependent Subcategory selector →
   categoryId [+ subcategoryId once supported])
        ↓
Storefront: taxonomy → mega-menu → shop filtering → listing
```

## 7. Known backend gaps affecting admin

1. No subcategory endpoints (hierarchy via `parentId` only) — worked
   around by client-side tree; no workaround possible for persistence
   beyond `parentId`.
2. No product→subcategory field — subcategory selection is UI-only.
3. `PATCH /categories/:id` writes `parentId: null` through — subcategory→top
   promotion is possible via API (and via the "None" parent option in `CategoryForm.jsx`).
4. `GET /categories` defaults to active-only — the inactive review/restore flow
   uses `?status=inactive|all` (ADMIN callers only).
5. Static media IS served: `express.static` exposes `storage/uploads` in
   `backend/src/app.js`, so `storagePath`/`image` references resolve to files;
   the tenant boundary is database discovery (suspension blocks the API/data
   layer), not file absence.

## 8. Audit Logs page (Phase 2C-22)

Route `/audit-logs` (`pages/AuditLogsPage.jsx`, Operations nav) renders
the backend audit trail read-only for every admitted panel role
(ADMIN sees the own company; HEAD/MEMBER/SUPER_ADMIN scopes stay
backend-enforced — the page forwards filters and renders whatever
the API returns, with no client-side row filtering). Company-scoped
staff roles cannot view audit events whose actor-role snapshot is
SUPER_ADMIN, even for their own company (backend-enforced across
list, export, and summary).

```
AuditLogsPage → stores/useAuditStore.js → services/audit.service.js
                     ↓                              ↓
            PageHeader/Table/Modal/        GET /audit-logs (apiGetPage)
            Pagination/Empty/Error   GET /audit-logs/export (apiDownloadCsv)
```

- Filters map 1:1 to backend params
  (`action/resource/outcome/role/actorId/resourceId/companyId/from/to`);
  no search box (the backend offers none), no invented params.
  `companyId` renders only for `SUPER_ADMIN` sessions; company users
  never see a company selector.
- Table shows Time, Actor (email → short id → `System`), Role, Action,
  Resource, Outcome, Company (short id or `Platform`); row Details
  opens a Modal with the full safe 11-field projection and
  pretty-printed `details` (no HTML rendering, no mutation controls).
- Export downloads the backend CSV verbatim for the current filters
  (never `page`/`limit`, never client-built); over-limit answers
  `422 AUDIT_EXPORT_TOO_LARGE` → actionable toast. Filename comes
  from `Content-Disposition` (`audit-logs.csv` fallback).
- `lib/apiClient.js#apiDownloadCsv` is the single download helper:
  shared 401-refresh semantics, JSON error parsing on failure, no
  token-in-URL.

## 9. Audit Retention page (Phase 2C-23)

Route `/audit-retention` (`pages/AuditRetentionPage.jsx`, System
nav) exposes the global audit retention policy to SUPER_ADMIN
only: route guard `allowedRoles={['SUPER_ADMIN']}`, nav item
likewise, all other roles redirected away by the shared guard
(backend `authorize("SUPER_ADMIN")` stays authoritative).

```
AuditRetentionPage → stores/useRetentionStore.js → services/retention.service.js
                     ↓                                        ↓
              PageHeader/Badge/Modal/           GET /audit-retention (apiGet)
              ErrorState + radio cards     PATCH /audit-retention { policy } (apiPatch)
```

- Current state card (server `policy`/`description`/`updatedAt`/
  `updatedBy`, null-safe) + radio-card selector over exactly
  `NEVER`/`30_DAYS`/`1_YEAR` (local `RETENTION_POLICIES`
  mirroring the backend vocabulary) + Save (loading-guarded).
  Reductions (shorter keeping) confirm through the shared Modal
  pattern; same-value saves and increases apply directly
  (`changed:false` is success, no error).
- PATCH body is always exactly `{ policy }` — no companyId,
  userId, dates, durations, or flags. Timestamps/actor render
  from the server response, never invented. Errors follow the
  `ApiError`/toast conventions (`AUDIT_EXPORT_TOO_LARGE`-style
  codes surface verbatim; 403 shows the backend message).
- Copy rule: eligible-for-cleanup wording only (schedule timing
  is server-side), plus the standing note that retention never
  controls permanent company deletion. No per-company settings,
  no company selector, no deletion/cleanup controls anywhere.

## 10. Audit Dashboard page (Phase 2C-24)

Route `/audit-dashboard` (`pages/AuditDashboardPage.jsx`,
Operations nav next to Audit Logs) renders read-only aggregates
over the role-scoped audit trail for all four panel roles: route
guard and nav entry reuse the `/audit-logs` branch (backend
`GET /audit-logs/summary` stays authoritative — MEMBER sees
self-only numbers, HEAD self+members, ADMIN the company,
SUPER_ADMIN the selected scope).

```
AuditDashboardPage → stores/useAuditDashboardStore.js → services/audit.service.js
                     ↓                                        ↓
              PageHeader/StatCards/             GET /audit-logs/summary (apiGetPage)
              TrendChart/Tables/            (same filters as export, no pagination)
              ErrorState
```

- Stat cards (total/successful/failed) + the hand-rolled
  `TrendChart` reused verbatim for daily buckets (backend
  `{ date, count }` mapped to its `{ bucketStart, orders }`
  shape — no chart dependency) + `Table`s for by-action,
  by-resource, and top-10 actors + a most-recent-activity card.
- Filters map 1:1 to backend params (`from/to/action/resource/
  outcome`, plus `companyId` for SUPER_ADMIN only — company users
  never see a company selector). No invented params, no
  client-side slicing, no mutation controls of any kind.
- The store holds the server summary only (no pagination meta —
  the response is a single bounded object); loading/empty/error
  follow the list-page conventions.

## 11. Company Management page (Phase 2C-25)

Route `/companies` (`pages/CompaniesPage.jsx`, System nav) exposes
the Super Admin company lifecycle on top of the completed backend
company module (`backend/src/modules/companies/`, docs
`MULTI_COMPANY_SAAS.md` §AJ/AK/AO — list/detail/create/
suspend/restore, one-ADMIN provisioning, ADMIN password reset,
permanent deletion). Route guard
`allowedRoles={['SUPER_ADMIN']}` plus a matching
`SUPER_ADMIN`-only nav item; ADMIN/HEAD/MEMBER never see the
item and are bounced through the existing role-aware landing
(no new admission rule, no login↔route loop — backend
`authorize("SUPER_ADMIN")` stays authoritative on every
endpoint).

```
CompaniesPage → stores/useCompanyStore.js → services/company.service.js
                 ↓                                     ↓
          PageHeader/Table/Modal/           GET /companies (apiGetPage)
          Pagination/Empty/Error     POST /companies { name }
          Field/Input/Badge          POST /companies/:id/suspend|restore
                                     POST /companies/:id/admin { email, password, firstName, lastName?, phone? }
                                     POST /companies/:id/admin/password { password }
                                     DELETE /companies/:id { confirmName }
```

- Read-only-first list over the paginated backend envelope
  (`{ companies }` + top-level `meta` via `apiGetPage`;
  `search`/`status` filters only). Rows render platform metadata
  only (`name`, `status`, primary domain,
  timestamps) — products, orders, customers, inventory, and all
  other operational rows are never fetched and never rendered.
  The redundant Admin Status column was removed (exactly one
  ADMIN per company by invariant — presence is shown on the
  detail page instead); every row carries a Details action to
  `/companies/:id`.
- Create sends exactly `{ name }` (trimmed; UUID + ACTIVE are
  assigned server-side; `id`/`status`/`adminUserId`/`companyId`
  are rejected backend-side and never sent). Suspension
  confirms through the shared Modal (pauses the whole store,
  deletes nothing, reversible); restore applies directly.
  `COMPANY_ALREADY_SUSPENDED` / `COMPANY_ALREADY_ACTIVE`
  surface as toasts. Every mutation refetches the list instead
  of patching rows locally; `mutating` names the in-flight
  operation so duplicate submissions are impossible.
- ADMIN provisioning sends the documented fields (empty
  `lastName`/`phone` dropped) and renders only the safe admin
  the backend returns — the backend generates no credential to
  display, so none is shown, copied, logged, or persisted.
  `COMPANY_ADMIN_EXISTS` surfaces as a toast. Password reset
  sends exactly `{ password }` via POST (route id only — no
  `companyId`/`userId` in the body) through password/confirm
  inputs; the value travels request-only and is cleared with
  the dialog.
- Permanent deletion is deliberately separated: a non-prominent
  ghost icon, offered ONLY for SUSPENDED companies, never for
  protected Company #1 (`35b5a215-…`, shared
  `PROTECTED_COMPANY_ID`/`isProtectedCompany` guard), never as
  a primary action. The dialog states deletion is permanent and
  irreversible (suspension deletes nothing — deletion deletes
  everything), keeps the confirm button disabled until the
  entry matches the company name exactly, and never calls the
  API on mismatch or Cancel. Success sends exactly
  `{ confirmName }`; `COMPANY_PROTECTED` /
  `COMPANY_NOT_SUSPENDED` / `COMPANY_CONFIRMATION_MISMATCH` /
  `COMPANY_NOT_FOUND` surface as toasts and the list refreshes.
  No client-side cascade of any kind.
- Suspension vs deletion stay distinct everywhere: badges,
  toasts, and dialog copy never imply suspension deletes data.

## 11A. Platform Dashboard page (Phase 2C-32)

Route `/platform` (System nav, first item) is the dedicated
SUPER_ADMIN landing (`landingFor` sends SUPER_ADMIN here;
ADMIN keeps `/dashboard` + redirect, HEAD/MEMBER keep
`/audit-logs`). Route guard
`allowedRoles={['SUPER_ADMIN']}`; backend
`authorize("SUPER_ADMIN")` stays authoritative on the single
source endpoint. The page is visually and contractually
distinct from the company operational `DashboardPage` — it
renders aggregate counts only, never company operational
rows.

```
PlatformDashboardPage → services/company.service.js
  PageHeader/Table/      fetchPlatformSummary → GET /companies/summary
  Badge/Empty/Error/     ({ totalCompanies/activeCompanies/
  Pagination                suspendedCompanies, totals,
                             lean companies[] id/name/status/
                             primaryDomain + aggregates })
```

- Platform totals, status aggregates, and a per-company
  aggregate table (name, status, primary domain, user /
  product / order counts, Details link). Exactly one summary
  request per lifecycle (mount + manual refresh); the table
  paginates client-side (20/page, shared `Pagination`) so
  rendered DOM stays bounded as company count grows.
  Loading, empty, and error-with-retry follow the list-page
  conventions.

## 11B. Company Detail page (Phase 2C-32, profile + logo in 2C-33)

Route `/companies/:id` (SUPER_ADMIN only, reached via the
per-row Details action; deep-link safe) renders the
documented `GET /companies/:id` detail: metadata card
(status, admin presence, timestamps, googleSignInEnabled),
business-profile card (contact/address/website with “Not
provided” fallbacks, website link), logo card (thumbnail
or placeholder, upload/replace/remove), structural
aggregate counts, and a read-only domain registry
(management stays on the Companies list modal).
The Edit action opens the name+profile form over `PATCH
/companies/:id` (per-field client validation mirroring
backend limits, empty clears, in-dialog 422 surfacing,
business-data-only help text; `logoPath` never sent) —
lifecycle state, ADMIN credentials, and domains are never
editable here. Logo upload enforces JPEG/PNG/WebP ≤5MB
client-side with server-authoritative errors; removal uses
inline confirmation. Success refreshes both the detail and
the list mirror; 401/403/404 render the shared error state
with retry.

```
CompanyDetailPage → services/company.service.js
  PageHeader/Table/Modal/    fetchCompanyById → GET /companies/:id
  Field/Input/Badge/         updateCompany → PATCH /companies/:id { name?, profile… }
  Empty/Error                uploadCompanyLogo → POST /companies/:id/logo (FormData)
                             deleteCompanyLogo → DELETE /companies/:id/logo
                             resolveCompanyLogoUrl (media-base join, null fallback)
```

## 12. Company domain management (Phase 2C-27)

The per-row `Domains` control on `/companies` opens the registry
modal for the route company on top of the completed backend domain
module (`backend/src/modules/companies/` domain endpoints, docs
`MULTI_COMPANY_SAAS.md` §AV — list/register, primary promotion,
active toggling, guarded removal). Route guard and nav are
unchanged (`allowedRoles={['SUPER_ADMIN']}`, System nav);
ADMIN/HEAD/MEMBER/CUSTOMER never see the controls and the backend
`authorize("SUPER_ADMIN")` stays authoritative on every endpoint.

```
Domains modal → stores/useCompanyStore.js → services/company.service.js
  Table/Modal/                    openCompanyDomains → GET /companies/:id/domains
  Field/Input/Badge/              createNewDomain → POST /companies/:id/domains { domain }
  Empty/Error                     updateDomainState → PATCH /companies/:id/domains/:domainId { isActive?/isPrimary? }
                                  deleteDomain → DELETE /companies/:id/domains/:domainId
```

- The modal is server-driven: opening fetches the registry for the
  route company id (never a body/query/header companyId); every
  mutation refetches both the registry and the company list (rows
  render the primary domain) instead of assuming primary/active
  state. `mutating` (`domain-create`/`domain-update`/
  `domain-delete`) disables controls while pending, so duplicate
  submissions are impossible; Close/Cancel never call the API.
- Rows render the canonical hostname plus `Primary`/`Secondary`
  (`info`/`neutral`) and `Active`/`Inactive`
  (`success`/`neutral`) badges — never operational data. The
  add-domain form sends exactly `{ domain }` (trimmed; the server
  canonicalizes) with a hostnames-only hint; empty input is
  blocked client-side, backend conflicts
  (`COMPANY_DOMAIN_EXISTS`/`COMPANY_DOMAIN_INVALID`/primary
  guards) surface as toasts with the modal staying open.
- Promotion (`Make primary`), active toggles, and removal go
  through the exact PATCH/DELETE bodies; removal requires an
  inline `Remove this domain?` confirmation, and the trash control
  for a primary with siblings is disabled with an explanatory
  title (the backend `COMPANY_DOMAIN_IS_PRIMARY` guard stays
  authoritative). A suspended-company note states management is
  allowed while the storefront stays blocked until restore.

## 13. HEAD operational UI (Phase 4-1)

The backend Phase 3 RBAC contract is authoritative; this section
records how the frontend reflects it for `HEAD` (no second
permission matrix exists — visibility derives from
`useAuthStore((state) => state.isAdmin())` at render time, and
every control maps to an endpoint the backend authorizes).

HEAD-accessible sections (route branch `['ADMIN', 'HEAD']`, nav
`OPERATIONAL_HEAD`): Categories, Products (incl. new/edit,
variants, inventory, and media managers), Orders (list/detail
incl. bulk bar), Inventory, Coupons (incl. new/edit/history).
HEAD-hidden: Dashboard, Returns, Customers, Reviews, Marketing,
Announcements, Companies, Audit Retention (route guard bounces
to `/login`, which lands panel roles on `/audit-logs` — no loop).
MEMBER scope is recorded in §14 (Phase 4-5 operational UI).

Action-level restrictions (ADMIN-only controls hidden from HEAD):
- Categories/Products pages: the inactive/all status filter.
- Products page: hard Delete (deactivate/reactivate stay).
- Coupons page: hard Delete (deactivate/reactivate/history stay).
- Category/Product/Coupon forms: the Active checkbox is hidden;
  hidden toggles submit the default/existing active value, so HEAD
  can never send a denied `isActive` write.
- MediaManager: image Delete hidden (upload + metadata edit stay).
- Coupon new/edit pages: product eligibility lists load the
  `active` scope (ADMIN loads `all`).
- Product edit page: detail loads the `active` scope for HEAD
  (`all` for ADMIN).

Inactive-scope UI rule: HEAD/MEMBER are never offered inactive/all
filtering or inactive-row navigation, matching the backend's
intentional ADMIN-only inactive scope. The backend `403`s remain
authoritative for stale UI and direct requests (existing
toast/error handling; no silent retry).

MEMBER distinction: MEMBER reaches no operational page (router +
nav unchanged); nothing in this section broadens MEMBER.
SUPER_ADMIN semantics unchanged (platform pages only).

## 14. MEMBER operational UI (Phase 4-5)

The backend Phase 3 RBAC contract is authoritative; this section
records how the frontend reflects it for `MEMBER` (no new
permissions — visibility derives from the existing
`isAdmin()` gate plus the small shared `isMember()` helper in
`lib/roles.js` / `useAuthStore`, and every control maps to an
endpoint the backend authorizes).

MEMBER-accessible sections (route branch
`['ADMIN', 'HEAD', 'MEMBER']`, nav `OPERATIONAL_MEMBER`):
Categories, Products (incl. new/edit, variants, inventory, and
media managers), Orders (list/detail incl. status/payment/bulk),
Inventory, Coupons (list/detail/history ONLY), Audit Logs, Audit
Dashboard (role-scoped aggregates — MEMBER sees self-only numbers,
backend-enforced per §10; no new dashboard is created for MEMBER).
MEMBER-hidden: Dashboard / company statistics, Returns,
Customers, Reviews, Notifications, Announcements, Companies,
Audit Retention, coupon write routes (`/catalog/coupons/new`,
`/edit`), SUPER_ADMIN company management (route guard bounces to
`/login`, which lands non-ADMIN panel roles on `/audit-logs` —
no loop). No companyId selectors/params/headers or tenant
switching exist for MEMBER (company comes from auth context).

Action-level restrictions (MEMBER sees the page but not the control):
- Categories page: create/edit stay; deactivate/reactivate hide
  (no `category:DEACTIVATE` grant); inactive/all scope filter stays
  ADMIN-only (already hidden via `isAdmin()`).
- Category form: Active checkbox stays hidden; MEMBER payloads omit
  `isActive` entirely (any explicit `isActive` on PATCH is a backend
  403 — create defaults active server-side).
- Products page: create/edit stay; deactivate/reactivate hide (no
  `product:DEACTIVATE` grant); hard Delete and inactive/all scope
  stay ADMIN-only.
- Product form: Active checkbox stays hidden; MEMBER payloads omit
  `isActive` (same PATCH rule as categories); Featured stays.
- Variants (inherit the product namespace — no standalone variant
  namespace): create/edit stay; deactivate/reactivate hide
  (DELETE route is ADMIN/HEAD-only; PATCH `isActive` is a MEMBER
  403 in-service).
- Media: upload + metadata edit stay (product UPDATE action —
  `POST`/`PATCH` authorize `ADMIN`/`HEAD`/`MEMBER`); hard image Delete
  (`DELETE /products/:id/images/:imageId`, ADMIN-only) hides for both
  HEAD and MEMBER — `MediaManager` and `VariantMediaSection` both gate
  via `isAdmin()` (Phase 4-6 hardening: HEAD variant management never
  implied media-delete rights). Backend authorization stays
  authoritative.
- Inventory page + `InventoryManager`: initialize/adjust/history stay
  (no deactivation endpoint exists; no unauthorized controls exist).
- Orders list/detail: list, detail, status update, payment update,
  and bulk status update stay (single `order:MANAGE` grant — no
  MEMBER-only order behavior is added).
- Coupons page: list/detail/history stay; New Coupon, Edit,
  deactivate/reactivate, hard Delete, and ADMIN-only validation
  hide (MEMBER holds `coupon:READ` only; write routes are also
  route-guarded `['ADMIN', 'HEAD']`).
- Audit Logs: own rows only per backend visibility (page forwards
  filters, renders whatever the API returns). Audit Dashboard
  visibility is unchanged from §10 (all four panel roles).

Distinctions:
- MEMBER vs HEAD: HEAD keeps category/product/variant
  deactivate/reactivate and full coupon write (except hard delete);
  MEMBER keeps create/edit/read only (plus orders/inventory) and
  coupon read only.
- MEMBER vs ADMIN: ADMIN keeps full operational controls
  (inactive/all scopes, Active toggles, deactivate/reactivate,
  coupon write, hard deletes, media deletes, dashboard/returns/
  customers/reviews/marketing). MEMBER has none of these.
- Backend authorization remains authoritative on every endpoint
  (frontend gates are UX layering; 401/403 follows the existing
  global apiClient/error handling — no fake success, no silent
  swallow).

## 15. HEAD member management UI (Phase 4-8)

Exposes the established Phase 2C-31 staff-management capability
(no new permission): `GET /users`, `GET /users/:id`,
`POST /users`, `PATCH /users/:id { isActive }`,
`PATCH /users/:id/profile` (`users.routes|controller|service|
validation|repository`, `canManageRole`). This is company staff
management, not customer management — customers stay on the
ADMIN-only Customers page.

- Routes `/team` + `/team/:id` (list + detail) behind
  `ProtectedRoute allowedRoles={['ADMIN', 'HEAD']}`; MEMBER,
  CUSTOMER, unauthenticated, and SUPER_ADMIN callers bounce through
  the existing login/audit-logs landing (no loop). No companyId in
  URLs, query, body, or headers — tenancy derives from the
  authenticated context (strict backend schemas reject companyId).
- Navigation: `Team Members` in the People group, roles
  `['ADMIN', 'HEAD']` (new `TEAM_MANAGERS` constant reusing the
  existing per-item architecture). MEMBER/SUPER_ADMIN never see it.
- HEAD remit (MEMBER targets only, backend neutral-404s anything
  else): list/detail MEMBER rows; create MEMBER (role control absent
  — payload hardcodes `role: 'MEMBER'`); edit profile
  (`firstName`/`lastName`/`phone` only, no email/password/role/
  active-state surface, so no escalation path exists);
  deactivate/reactivate MEMBERs (self-deactivation stays a backend
  `409`). HEAD cannot create/edit/deactivate HEAD or ADMIN targets;
  unauthorized ids render the same not-found state as unknown ids.
- ADMIN remit on the shared page: create HEAD or MEMBER (role
  selector, `HEAD`|`MEMBER` only); edit MEMBER profiles; lifecycle
  on MEMBER and HEAD targets; ADMIN/self rows render read-only.
- Customer separation: rows whose roles are not all staff roles
  (`ADMIN`/`HEAD`/`MEMBER`) never render — HEAD responses cannot
  contain them (backend-forced MEMBER scope); ADMIN responses may,
  and the page excludes CUSTOMER/roleless/platform rows
  presentation-side while search/filter/pagination stay
  server-driven (server totals may therefore include non-staff rows
  for ADMIN; the header counts only rendered staff rows).
- State/service follow the existing conventions (`services/
  member.service.js`, `stores/useMemberStore.js`, shared
  Table/Modal/Pagination/toast patterns); backend 401/403 flows
  through the established auth handling.

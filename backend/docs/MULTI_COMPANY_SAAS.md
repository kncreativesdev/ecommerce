# MULTI_COMPANY_SAAS.md

## 0. Purpose and Status Labels

This document is the long-term source of truth for the Tech Pulse
multi-company SaaS architecture. It describes the AGREED target
architecture that the single-company backend will evolve toward.

Every statement in this document carries one of the following labels:

* `CURRENT` — already implemented and verified in the existing backend.
* `AGREED` — a fixed requirement confirmed for the SaaS conversion.
  It is not yet implemented unless the Implementation Status table says so.
* `FUTURE` — planned for a later implementation phase. Not implemented.
* `RECOMMENDATION` — architecture guidance where a final decision has
  not yet been made. Open to revision, but changes must be recorded here.

Do not silently change requirements. If an implementation decision
differs from this document, update this document in the same task and
explicitly report the change.

Related sources of truth (unchanged by this document):

* `docs/ARCHITECTURE.md` — request flow and module boundaries.
* `docs/DATABASE.md` — database contract.
* `docs/API.md` — API behavior and error envelope.
* `docs/SECURITY.md` — authentication and security posture.

Where this document and an older document disagree about SaaS behavior,
this document is authoritative for SaaS questions; the older document
remains authoritative for its own domain until it is updated.

---

## A. PRODUCT MODEL

* `AGREED` — Tech Pulse becomes a reusable SaaS ecommerce platform.
* `AGREED` — One Company = one ecommerce store/business.
* `AGREED` — Example: Company A sells gadgets, Company B sells clothing.
  Companies may have completely different products and business models.
* `AGREED` — Deployment architecture:

  ```text
  ONE backend deployment
  ONE MySQL database
  MANY companies
  ```

* `AGREED` — There is no separate backend deployment per company.
* `AGREED` — The same backend serves web and mobile applications.
* `AGREED` — Each company will eventually have its own mobile app
  (`FUTURE` mobile delivery; backend stays client-agnostic).
* `CURRENT` — The backend today is single-company: there is no `Company`
  model, no `companyId` column, and no tenant resolution anywhere in
  `prisma/schema.prisma` or `src/`. All existing data belongs to the one
  implicit store.

---

## B. ROLE HIERARCHY

* `AGREED` — Fixed roles only:

  ```text
  SUPER_ADMIN
  ADMIN
  HEAD
  MEMBER
  CUSTOMER
  ```

* `AGREED` — No custom roles. No user-created permission matrices.
* `AGREED` — Employee hierarchy:

  ```text
  SUPER_ADMIN
  ↓
  ADMIN
  ↓
  HEAD
  ↓
  MEMBER
  ```

* `AGREED` — `CUSTOMER` is company-scoped but sits outside the internal
  employee hierarchy.
* `AGREED` — Rules:
  * Users cannot access roles above them.
  * Users cannot access another company.
  * The company UUID is an internal isolation key only.
  * Users never select another company by submitting `companyId`
    (query, body, header, or any client-supplied field).
  * Frontend visibility is NOT the security boundary; backend
    authorization is authoritative.
* `CURRENT` — Only `CUSTOMER` and `ADMIN` exist today (seeded in
  `prisma/seed.js`; `Role.name` is a free-form unique string).
  `SUPER_ADMIN`, `HEAD`, and `MEMBER` do not exist yet (`FUTURE`).

---

## C. SUPER_ADMIN

* `AGREED` — `SUPER_ADMIN` is the platform owner/operator.
  Platform-level identity; it does NOT belong to a company ecommerce
  context.

SUPER_ADMIN can (`AGREED`, `FUTURE` implementation):

* create companies
* activate companies
* suspend companies
* restore suspended companies
* manage company-level configuration, including:
  * company name
  * logo
  * favicon
  * company email
  * contact information
  * address
  * social links
  * website links
  * theme/branding
  * company domain configuration
* create/generate the company's ADMIN credentials
* reset/change the company's ADMIN credentials
* view aggregate statistics for each company
* view own audit logs
* view company audit logs individually (select a company first, then
  inspect its permitted users/logs)
* configure audit-log retention
* permanently delete a company after the required safeguards (see H)

* `CLARIFIED` — the "company-level configuration" categories above
  (logo, favicon, email, contact, address, social, website,
  theme/branding) were agreed-as-goals without a field-level
  contract. The finalized contract is IMPLEMENTED (Phase 2C-33,
  see BL): dedicated nullable columns for `contactEmail`
  (lowercased), `contactPhone`, `addressLine1`/`addressLine2`,
  `city`/`state`/`country`, `postalCode`, `website`
  (HTTPS-only), and `logoPath` (backend-managed file reference
  via the dedicated upload/remove endpoints reusing the
  multer/Sharp/local-storage pipeline under
  `companies/<id>/branding/`). Excluded by product decision:
  favicon (no consumer, no .ico pipeline), social links (no
  consumer, unbounded shape), theme/configuration (no consumer;
  generic blob prohibited), billing/subscription/tax/legal/KYC
  (never required).
  * Contact/address/website/logo are business-public by
  design (future storefront Support-page/brand consumers
  per frontend GAP-01); ADMIN/CUSTOMER exposure stays a
  future per-domain-read contract decision — no public
  company-info endpoint exists yet. Summary/dashboard
  responses stay counts-only.

SUPER_ADMIN must NOT manage company ecommerce operations (`AGREED`).
SUPER_ADMIN must NOT access individual (`AGREED`):

* products
* product variants
* inventory records
* customers
* orders and order details
* reviews
* coupons
* carts
* wishlists
* any other company operational records

* `AGREED` — SUPER_ADMIN statistics are aggregate-only. Examples:
  customer count, order count, completed orders, revenue aggregate,
  product count, inventory aggregate, HEAD count, MEMBER count, and
  other high-level metrics.
* `AGREED` — The backend must prevent SUPER_ADMIN from using normal
  company operational endpoints to retrieve row-level ecommerce data
  (403 on operational detail routes; aggregate endpoints only).
* `CURRENT` — No SUPER_ADMIN exists; `GET /api/v1/dashboard/summary`
  is ADMIN-only and global. Its aggregation queries (status counts,
  recognized revenue, buckets, inventory snapshot) are the verified
  foundation for the future aggregate-statistics endpoints.

---

## D. ADMIN

* `AGREED` — Exactly ONE ADMIN exists per company.
* `AGREED` — ADMIN has full control over their own company.

ADMIN can (`AGREED`, `FUTURE` enforcement on top of current behavior):

* create HEADs
* update HEADs
* deactivate HEADs
* delete HEADs
* create MEMBERs
* update MEMBERs
* deactivate MEMBERs
* delete MEMBERs
* manage company ecommerce data
* create/update/deactivate/delete data according to the existing
  resource lifecycle rules (see I)
* manage orders
* manage inventory
* manage categories
* manage coupons
* manage products
* manage customers
* ban customers
* manage reviews
* manage permitted notifications/announcements
* view own audit logs
* view HEAD logs
* view MEMBER logs
* inspect individual HEAD/MEMBER activity
* change permitted company configuration/data

ADMIN cannot (`AGREED`):

* access SUPER_ADMIN
* access another company
* manage platform-level company lifecycle
* change the platform SUPER_ADMIN identity

* `AGREED` — SUPER_ADMIN remains responsible for ADMIN credentials at
  the platform level (initial generation + reset/change).
* `CURRENT` — ADMIN today is a global role (`authorize("ADMIN")`);
  user administration is limited to `GET /users`, `GET /users/:id`,
  and `PATCH /users/:id {isActive}` (deactivate/reactivate only —
  no delete, no role assignment, no ban flag). The one-ADMIN-per-company
  invariant does not exist yet.

---

## E. HEAD

* `AGREED` — There may be multiple HEADs in one company.

HEAD can (`AGREED`, `FUTURE`):

* see all MEMBERs in the same company
* create MEMBERs
* update MEMBERs
* deactivate MEMBERs
* add/update/deactivate inventory
* add/update/deactivate categories
* add/update/deactivate coupons
* create/update/deactivate products where permitted by the existing
  lifecycle rules
* manage/process orders
* manage operational company data according to the agreed permissions
* view own audit logs
* view MEMBER logs
* inspect individual MEMBER activity

HEAD cannot (`AGREED`):

* see another HEAD's details
* manage another HEAD
* create another HEAD
* manage ADMIN
* access SUPER_ADMIN
* delete MEMBERs
* delete products
* delete other company data
* access another company

* `AGREED` — Attribution note: when displaying a MEMBER to a HEAD, the
  UI should eventually show an attribution such as
  "Created by Head: [Head Name]". This attribution does NOT restrict
  other HEADs from seeing the MEMBER.
* `CURRENT` — No HEAD role exists. Catalog writes are ADMIN-only;
  there is no peer-visibility concept.

---

## F. MEMBER

MEMBER can (`AGREED`, `FUTURE`):

* process/manage orders
* create/update categories
* create/update products
* manage orders
* manage inventory
* perform permitted operational ecommerce work

MEMBER cannot (`AGREED`):

* delete data
* deactivate data
* manage HEADs
* manage MEMBER accounts
* manage ADMIN
* manage notifications
* create notifications
* access other MEMBER account details
* access HEAD/Admin/Super Admin details
* access another company

* `AGREED` — MEMBER can view their own audit logs only.
* `CURRENT` — No MEMBER role exists. Note the implied new guards:
  MEMBER create/update must be blocked from flipping `isActive` and
  from calling `DELETE` endpoints that ADMIN/HEAD may use.

---

## G. CUSTOMER

* `AGREED` — Customers are strictly company-scoped.
* `AGREED` — The same email may exist independently in different
  companies. `customer@example.com` in Company A and
  `customer@example.com` in Company B are separate customer accounts.
* `AGREED` — Customer functionality preserves the current customer
  application behavior wherever possible (cart, wishlist, addresses,
  own orders, own reviews, own notifications, coupon validation).
* `AGREED` — Only ADMIN can ban customers and manage reviews
  (per Section D).
* `AGREED` — Company isolation must be enforced by the backend
  (repository/service authorization level, never frontend-only).
* `CURRENT` — Registration always creates `CUSTOMER` with a globally
  unique email (`User.email @unique`); login, refresh, Google sign-in,
  and all ownership checks (`where: { id, userId }`) are global.
  The composite `[companyId, email]` uniqueness is `FUTURE`.

---

## H. COMPANY LIFECYCLE

* `AGREED` — Company states: `ACTIVE`, `SUSPENDED`.
* `AGREED` — Lifecycle:

  ```text
  ACTIVE
  ↓
  SUSPENDED
  ↓
  ACTIVE (restore)
  ```

* `AGREED` — Suspension deletes nothing and preserves all company data.
  While suspended:
  * customer storefront operation is disabled
  * ADMIN access is disabled
  * HEAD access is disabled
  * MEMBER access is disabled
  * the company can be restored by SUPER_ADMIN
* `AGREED` — Only SUPER_ADMIN can suspend or restore companies.
* `AGREED` — Permanent deletion requires ALL of the following:
  1. caller is SUPER_ADMIN
  2. company is already SUSPENDED (an ACTIVE company cannot be
     permanently deleted)
  3. deliberate destructive action (deliberately non-prominent UI control)
  4. exact company name entered by the operator
  5. backend-enforced exact-name confirmation (frontend check alone
     is insufficient)
  6. complete deletion of company-owned database data
  7. company-owned media/storage is removed
  8. database/storage space is reclaimed where applicable
* `CURRENT` — No company lifecycle exists. The only related mechanism
  is `User.isActive` gating (login/refresh/profile blocked when false)
  and per-resource `isActive` toggles. Suspension enforcement points
  (company-resolution middleware, login/refresh/me, all company routes)
  are `FUTURE`.

---

## I. EXISTING DELETE/DEACTIVATE RULES

* `AGREED` — Preserve existing resource-specific deletion/deactivation
  semantics unless a later approved requirement changes them.
* `CURRENT` — The implementation audit verified the following
  authoritative behaviors (they remain in force):
  * Categories: deactivate/reactivate (`isActive=false`, idempotent;
    reactivation via `PATCH { isActive: true }`). No hard delete.
  * Products: guarded two-stage behavior — `DELETE` on an active
    product returns 409 (deactivate first); `DELETE` on an inactive
    product is an idempotent soft-confirm; active-to-inactive
    transition is blocked while in-process orders exist
    (all statuses except CANCELLED/DELIVERED/COMPLETED).
  * Variants: deactivate (`isActive=false`), scoped to
    `(variantId, productId)`. No order-block check (known asymmetry).
  * Product images: hard delete of the row plus the filesystem file
    (single-primary invariant preserved transactionally).
  * Inventory: no delete endpoint; initialize-once plus
    adjust-with-ledger (`RESTOCK`/`ADJUSTMENT` + `InventoryTransaction`).
  * Orders: no delete and no deactivate; forward-only status machine
    with terminal `COMPLETED`/`CANCELLED`; customer self-cancel for
    eligible orders only.
  * Payments: no delete; state machine
    (`PENDING → PAID|FAILED`, `FAILED → PAID`, `PAID → REFUNDED`;
    `CANCELLED` written only by the atomic order-cancellation
    transaction).
  * Returns: current `REQUESTED`-only workflow (remaining enum values
    are reserved vocabulary; a request never mutates order, payment,
    or inventory state).
  * Reviews: customer can delete their own review (hard delete,
    owner-scoped); reviews are created immediately visible; the admin
    review endpoint is read-only today. ADMIN moderation/ban rules
    follow Sections D/G when implemented.
  * Coupons: hard delete only when `usedCount == 0`, otherwise 409
    with "deactivate instead"; `isActive` toggling otherwise.
  * Notifications: owner hard delete of a single row; read state via
    `isRead`/`readAt`.
  * Marketing notifications / site announcements: visibility toggle
    (`isActive` + time window) plus physical hard delete (no
    historical/accounting dependency by design).
* `AGREED` — Do NOT invent a universal "soft delete everything" rule.
  The resource-specific lifecycle rules above remain authoritative
  unless explicitly changed later.

---

## J. AUDIT LOGS

* `AGREED` — A permanent audit-log architecture will be added later
  (`FUTURE` database tables and endpoints). No `AuditLog` model exists
  today; the closest analogues are the FK-free, same-transaction
  `CouponHistory`, `OrderStatusHistory`, and `ReturnRequestHistory`
  tables.

Visibility (`AGREED`):

* MEMBER: own logs only.
* HEAD: own logs + MEMBER logs.
* ADMIN: own logs + HEAD logs + MEMBER logs.
* SUPER_ADMIN: own logs + company-specific logs (ADMIN/HEAD/MEMBER),
  with company selection first and then individual user filtering.
* Company-scoped staff roles cannot view audit events whose
  actor-role snapshot is SUPER_ADMIN, even when the audit event is
  associated with their company (enforced database-side in the
  shared audit visibility predicate for list, export, and summary).

* `AGREED` — There is NO "Delete Logs" button. No manual deletion.
* `AGREED` — Default retention: `NEVER` (retain indefinitely).
* `AGREED` — SUPER_ADMIN can change retention to `NEVER`, `30 DAYS`,
  or `1 YEAR`. Automatic cleanup runs only according to the configured
  policy.
* `AGREED` — The logs page must display the active retention policy,
  e.g. "Audit logs are retained indefinitely.",
  "Audit logs are automatically deleted after 30 days.", or
  "Audit logs are automatically deleted after 1 year."
* `AGREED` — SUPER_ADMIN can always see their own logs. SUPER_ADMIN
  logs are platform-level and may carry `companyId = NULL`.
* `AGREED` — Audit records should eventually capture: actor ID, actor
  role, actor email/identifier where appropriate, company ID when
  applicable, action, target entity/resource, target ID where
  applicable, timestamp, metadata/details, and outcome.
* `AGREED` — Company deletion may purge that company's audit logs as
  part of complete company deletion, while platform-level SUPER_ADMIN
  logs remain governed by the retention policy.

---

## K. PASSWORD RESET

* `AGREED` — ADMIN, HEAD, MEMBER, and CUSTOMER will eventually use the
  same recovery flow (`FUTURE`):

  ```text
  Forgot password → email → OTP → verify OTP → choose new password
  ```

* `AGREED` — Nodemailer will be used for email delivery (`FUTURE`;
  no mail infrastructure exists today).
* `AGREED` — OTP must eventually be: short-lived, single-use,
  rate-limited, securely stored/hashed, invalidated after successful
  use, and protected against account enumeration (uniform responses).
* `AGREED` — SUPER_ADMIN can directly reset/change company ADMIN
  credentials outside the OTP flow.
* `AGREED` — The initial ADMIN credentials generated by SUPER_ADMIN
  are NOT temporary. ADMIN may keep the provided password indefinitely
  or change it through the normal OTP-verified password-change flow.
* `CURRENT` — No password-reset, forgot-password, OTP, or email-sending
  code exists. Passwords are Argon2id-hashed; login failures return a
  generic `AUTH_INVALID_CREDENTIALS` message.

---

## L. COMPANY RESOLUTION

* `AGREED` — The company UUID is an internal isolation key. Users must
  not switch companies by sending `companyId`, `?companyId=`,
  `body.companyId`, or similar. Any client-supplied company identifier
  must be ignored or rejected; the backend derives company context
  server-side.
* `AGREED` — Web storefront company context will eventually be resolved
  from the registered company domain (`FUTURE`):

  ```text
  company-a.com → Company A
  company-b.com → Company B
  ```

* `AGREED` — The common admin panel uses the authenticated
  ADMIN/HEAD/MEMBER identity to determine company context.
* `AGREED` — SUPER_ADMIN uses platform context and must not be silently
  assigned a company ecommerce context.
* `AGREED` — Each company will eventually have its own mobile
  application. Mobile company context must be securely established by
  the app configuration/contract and must not be freely user-editable.
* `CURRENT` — One deployment equals one store everywhere: no host/domain
  logic, single/CSV `CORS_ORIGIN`, `SameSite=lax` cookies, and no
  company identifier on any public or authenticated route.

---

## M. DATA ISOLATION

* `AGREED` — Company-owned data must never cross company boundaries.
* `AGREED` — The backend must enforce company scope at
  repository/service authorization level. No frontend-only isolation.
  No client-supplied `companyId` trust.
* `AGREED` — At minimum, the following must eventually be isolated:
  users, addresses, categories, category media, products, product
  variants, product images, inventory, inventory transactions, carts,
  cart items, wishlists, wishlist items, orders, order items, order
  addresses, payments, order status history, returns, return history,
  reviews, coupons, coupon usage/history, notifications, marketing
  notifications, announcements, and company media/configuration.
* `CURRENT` — Every query against the above models is global today.
  Uniqueness is global where it must become company-scoped
  (`User.email`, `Category.slug`, `Product.slug`,
  `ProductVariant.sku`/`barcode`, `Coupon.code`, and — pending decision —
  `Order.orderNumber`).

---

## N. EXISTING DATA

* `AGREED` — The existing Tech Pulse data must become the first company.
  Do not destroy existing data.
* `AGREED` — Future migration sequence must be non-destructive:
  1. introduce `Company`
  2. create Company #1 from existing data
  3. backfill existing rows to Company #1
  4. introduce required company-scoped uniqueness
  5. tighten constraints only after successful backfill
* `AGREED` — Never use `prisma migrate reset`. Never delete or recreate
  existing migrations. Never upgrade Prisma unless explicitly approved.
* `CURRENT` — 8 migrations applied (from `20260916115156_init` to
  `20260930100445_add_order_returns`); `prisma/seed.js` is idempotent
  and seeds roles + catalog only (no users, carts, orders, or media).

---

## O. DOCUMENTATION MAINTENANCE RULE

This document must be updated whenever the SaaS architecture changes.
Future tasks must inspect this document before making SaaS architecture
changes. If an implementation decision differs from this document,
update the document in the same task and explicitly report the change.
Do not silently change the architecture.

### Implementation Status

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 0 | Permission matrix (unwired), company-context stub, isolation test harness, this document, resolved architecture decisions review | COMPLETE |
| Phase 1 | Company data-model foundation: `Company`/`CompanyDomain` models, Company #1, backfill (see R) | COMPLETE |
| Phase 2 | Company-scoped uniqueness, domain/identity resolution, catalog isolation, suspension, deletion, audit, credentials, domains (overall; all slices 2A—2C-30 delivered) | COMPLETE |
| Phase 2A | Server-authoritative company context at the auth boundary (resolution only, unwired — see S) | COMPLETE |
| Phase 2B-1 | Company-aware user provisioning foundation (ADMIN/HEAD/MEMBER server-authoritative assignment — see T) | COMPLETE |
| Phase 2B-2 | Mounted company-context request boundary with fixture migration (see U) | COMPLETE |
| Phase 2C-1 | Cart → checkout tenant enforcement with catalog stamping (see V) | COMPLETE |
| Phase 2C-2 | Order-surface tenant isolation: reads, mutations, aggregates, returns (see W) | COMPLETE |
| Phase 2C-3 | Inventory operational tenant isolation with ledger coverage (see X) | COMPLETE |
| Phase 2C-4 | Catalog tenant isolation for authenticated company operations (see Y) | COMPLETE |
| Phase 2C-5 | Customer-owned resource isolation: users/admin, wishlist, caller-scoped verification (see Z) | COMPLETE |
| Phase 2C-6 | Review + coupon tenant isolation with coupon company column (see AA) | COMPLETE |
| Phase 2C-7 | Notification/broadcast/announcement isolation with broadcast columns (see AB) | COMPLETE |
| Phase 2C-8 | Cart-display read gate closing the contaminated-line rendering gap (see AC) | COMPLETE |
| Phase 2C-9 | Product-media storage isolation with company-prefixed writes (see AD) | COMPLETE |
| Phase 2C-10 | Database tenant hardening: composites, NOT NULL, seed stamping (see AE) | COMPLETE |
| Phase 2C-11 | CompanyDomain runtime resolution with public context (see AF) | COMPLETE |
| Phase 2C-12 | Domain-separated public storefront reads (see AG) | COMPLETE |
| Phase 2C-13 | Centralized company suspension enforcement (see AH) | COMPLETE |
| Phase 2C-14 | Audit-log data model, writer, visibility groundwork (see AI) | COMPLETE |
| Phase 2C-15 | Super Admin company provisioning & lifecycle: list/detail/create/suspend/restore + one-ADMIN provisioning + lifecycle audit (see AJ) | COMPLETE |
| Phase 2C-16 | Admin credential management + secure password reset foundation: SUPER_ADMIN ADMIN-password reset, email-OTP forgot/reset/change flows, refresh watermark invalidation (see AK) | COMPLETE |
| Phase 2C-17 | Mutation-wide audit instrumentation: business-level AuditLog events across catalog/inventory/orders/returns/coupons/broadcasts/users with coverage inventory (see AL) | COMPLETE |
| Phase 2C-18 | Audit-log read API with hierarchy-aware visibility: GET /audit-logs, server-side predicates, platform/company scoping (see AM) | COMPLETE |
| Phase 2C-19 | Global audit retention policy + purge: NEVER/30_DAYS/1_YEAR, SUPER_ADMIN API, audited changes, batched cleanup + worker (see AN) | COMPLETE |
| Phase 2C-20 | Permanent company deletion: SUSPENDED-only, exact-name-confirmed, #1-protected destroy with full tenant purge + surviving platform audit (see AO) | COMPLETE |
| Phase 2C-21 | Audit CSV export: GET /audit-logs/export sharing read visibility, bounded, formula-safe (see AP) | COMPLETE |
| Phase 2C-22 | Admin audit-log UI: read-only /audit-logs page with filters, detail modal, CSV export (see AQ) | COMPLETE |
| Phase 2C-22R | Common admin-panel role model remediation: shared roles helper, per-branch guards, loop-free landing (see AQ.6) | COMPLETE |
| Phase 2C-23 | Super Admin retention UI: /audit-retention config page, confirm-gated reductions, exact { policy } saves (see AR) | COMPLETE |
| Phase 2C-24 | Audit dashboard/analytics: GET /audit-logs/summary with shared visibility, server-side aggregates, /audit-dashboard UI (see AS) | COMPLETE |
| Phase 2C-25 | Super Admin company management UI: /companies page, SUPER_ADMIN route/nav, lifecycle + credential actions, guarded permanent-deletion UX (see AT) | COMPLETE |
| Phase 2C-26 | Cross-company customer identity & login disambiguation: company-scoped (companyId, email) uniqueness, domain-derived auth, staff-determinism guards, scoped recovery/Google (see AU) | COMPLETE |
| Phase 2C-27 | Super Admin CompanyDomain management: registry list/register/promote/toggle/remove under the companies module, shared canonical normalization, exactly-one-primary, guarded deletion, scoped audit (see AV) | COMPLETE |
| Phase 2C-28 | Company/Domain lifecycle hardening & cross-tenant verification: audit of the 2C-27 lifecycle, misleading-error-message fix, restore-keeps-domain-state proof test, accepted residuals (see AW) | COMPLETE |
| Phase 2C-29 | SaaS architecture gap audit & next-phase definition: full tenant/auth/authz/isolation/audit/storefront audit, sole-ADMIN self-deactivation lockout fix + regression test, deferred-item classification, 2C-30 recommendation (see AX.0) | COMPLETE |
| Phase 2C-30 | Contract truth, documentation reconciliation & production cutover readiness: API matrix + DATABASE reconciliation, status-record truth, ADMIN_ARCH drift fixes, Company #1 cutover runbook, bulk-status P2034 retry (see AX) | COMPLETE |
| Phase 2C-31 | HEAD/MEMBER user-management HTTP API: member provisioning/profile/activation/deactivation + member-scoped reads on the users module reusing 2B-1 primitives, hierarchy guards, audit parity (see AY) | COMPLETE |
| Phase 2C-32 | SUPER_ADMIN platform company-management completion: rename-only `PATCH /companies/:id`, aggregate-only `GET /companies/summary` (bounded grouped counts), dedicated `/platform` dashboard landing + `/companies/:id` detail UI, Admin Status column removal, branding/contact schema deferred to product decision (see BK) | COMPLETE |
| Phase 3-1 | First operational RBAC slice: categories CRUD wired to permissions.js grants (HEAD create/update/deactivate/images, MEMBER create/update/images without active-state writes), service-level active-state guard, slice regression tests (see AZ) | COMPLETE |
| Phase 3-2 | Second operational RBAC slice: products + product images wired to permissions.js grants (HEAD create/update/deactivate/images-metadata, MEMBER create/update/images-metadata without active-state writes), delete-confirm + image-delete + variants stay ADMIN-only (see BA) | COMPLETE |
| Phase 3-3 | Third operational RBAC slice: standalone variants wired as product-sub-resource operations (HEAD create/update/deactivate, MEMBER create/update without active-state writes), nested-bypass analysis, no matrix change (see BB) | COMPLETE |
| Phase 3-4 | Fourth operational RBAC slice: inventory init/adjust/reads wired to the explicit inventory namespace (ADMIN/HEAD/MEMBER; no service guard needed, no deactivation endpoint exists), auth/business-error separation, ledger+transaction preservation (see BC) | COMPLETE |
| Phase 3-5 | Fifth operational RBAC slice: orders + payments + bulk wired to the single order:MANAGE grant (ADMIN/HEAD/MEMBER on all five company order routes), lifecycle/payment/bulk/retry semantics untouched (see BD) | COMPLETE |
| Phase 3-6 | Sixth operational RBAC slice: coupons wired to the explicit coupon namespace (reads for ADMIN/HEAD/MEMBER, create/update for ADMIN/HEAD, delete ADMIN-only); returns left ADMIN-only (no matrix grants exist, read-only surface preserved) (see BE) | COMPLETE |
| Phase 3-7 | Seventh RBAC slice (verification-only): marketing + announcements audited against permissions.js — HEAD/MEMBER hold no grants, all ten management routes stay ADMIN-only, posture locked by regression tests, zero production changes (see BF) | COMPLETE |
| Phase 3-8 | Final RBAC slice: inactive-scope audit — categories/products inactive reads stay intentionally ADMIN-only (HEAD/MEMBER 403, no grant models visibility scope), coupon inactive reads already open, all 12 domains verified, zero production changes (see BG) | COMPLETE |
| Phase 4-1 | HEAD operational UI in the admin frontend (router/nav/action gating for the Phase 3 contract; backend untouched) | COMPLETE |
| Phase 4-2 | Dashboard contract audit (verification-only): operational summary stays intentionally ADMIN-only (HEAD/MEMBER hold no company_statistics grant), stale global-scope comments corrected, posture locked by regression tests (see BH) | COMPLETE |
| Phase 4-3 | Per-company audit retention: inspected global foundation; no precedence decision (override/bound/combine) exists in architecture — implementation stopped per stop-rule, gap recorded with required product decisions (see BI) | COMPLETE (as decision record; no code change) |
| Phase 4-4 | Company-scoped Google sign-in allowlist: `Company.googleSignInEnabled` (default true), SUPER_ADMIN-only management, fail-closed flow gate before verification/linking, staff+customer uniform, suspension preserved (see BJ) | COMPLETE |
| Phase 2C-33 | Company business-profile contract: ten nullable profile columns (contact/address/website/logo), extended PATCH with clear semantics + HTTPS-only website + changedFields/previousValues audit, dedicated logo upload/remove on the raster pipeline with branding storage + cascade coverage, detail/profile/logo admin UI, no favicon/social/theme/billing, no public endpoint (see BL) | COMPLETE |
| Phase 2C-34 | Persistent one-time refresh-token rotation: `refresh_sessions` keyed by SHA-256 `jti`, atomic conditional consume (exactly-once incl. races), logout revocation, per-user + retention-tick expiry purge; error codes, claims, lifetimes, cookie contract unchanged (see BM) | COMPLETE |
| Phase 3 | Auth + role hierarchy enforcement (`HEAD`/`MEMBER`, user management) | COMPLETE (backend RBAC: all slices wired per matrix or intentionally ADMIN-only with locked regression coverage; residuals: HEAD operational UI, deferred SaaS features) |
| Phase 4 | Commerce isolation (cart/wishlist/orders/payments/returns/reviews/coupons) | COMPLETE (COD-only payments and read-only returns by accepted scope) |
| Phase 5 | Suspension enforcement + permanent deletion | COMPLETE |
| Phase 6 | Audit logs + retention + platform aggregate statistics | COMPLETE (global retention + dashboard done; per-company retention deferred by decision) |
| Phase 7 | Password-reset/OTP + Nodemailer, credential endpoints, domain cutover, mobile contract | PARTIAL (OTP/Nodemailer/reset/change + domain runtime + Google company allowlist done; P.6 per-company OAuth client list + mobile contract deferred) |

Do not mark a phase COMPLETE unless it has actually been implemented
and verified.

### Open Decisions — historical note

The nine decisions listed here at the end of Phase 0 scaffolding were
resolved during the Phase 0 architecture review. The original list is
retained for traceability; the resolutions live in section P and are
summarized in section Q. No Phase 1 implementation has begun.

Original list (verbatim):

1. Whether `companyId` is embedded in the JWT or resolved server-side
   per request (`RECOMMENDATION`: server-side resolution; avoids token
   staleness on suspension).
2. Whether `Order.orderNumber` stays globally unique or becomes
   per-company unique.
3. Whether `ProductVariant.companyId` is denormalized or always derived
   via `product.companyId` (`RECOMMENDATION`: denormalized for hot-path
   single-column predicates).
4. How the exactly-one-ADMIN-per-company invariant is enforced at the
   database level (MySQL has no partial unique index; join table vs
   service+test enforcement).
5. Domain registry storage (`CompanyDomain` table vs environment map)
   and TLS/cert strategy for custom company domains.
6. Per-company Google OAuth client strategy (shared vs per-company).
7. Suspended-company static-media handling (`express.static` is
   unauthenticated today).
8. Whether marketing/announcement management extends to HEAD or stays
   ADMIN-only (Section D/E wording is silent for HEAD).
9. Whether MEMBER negative inventory adjustments count as
   "deactivation" (Section F forbids MEMBER deactivation).

---

## P. RESOLVED ARCHITECTURE DECISIONS — PHASE 0 REVIEW

Each decision below is a `RECOMMENDED` architecture from the Phase 0
review. A recommendation is not an implementation: no schema, auth,
route, or test code changes with it. Phase 1 is COMPLETE (see §R).
Existing role boundaries (SUPER_ADMIN / ADMIN / HEAD / MEMBER /
CUSTOMER) are unchanged by every decision.

### P.1. JWT-embedded `companyId` vs server-resolved `companyId`

* `DECISION (RECOMMENDED)` — Resolve company context server-side on
  every request. Never embed `companyId` in the JWT, and never accept a
  client-supplied `companyId` as an isolation mechanism.
* `RATIONALE` — `CURRENT` tokens are minimal by design
  (`src/utils/jwt.js`): access carries `{ sub, roles }` (15m),
  refresh carries `{ sub, jti }` (7d). `src/middleware/authenticate.js`
  attaches `req.user = { id, roles }` with no database read, and the
  refresh flow (`src/modules/auth/auth.service.js`) is stateless with
  rotation-on-every-refresh. Embedding `companyId` would freeze company
  membership and suspension state into tokens: a suspended company's
  sessions would stay valid until access-token expiry, and any
  company move would require token versioning/revocation
  infrastructure the codebase deliberately avoids (concurrent
  same-cookie refreshes both succeed today by design —
  `tests/integration/auth-refresh-concurrency.test.js`). Server-side
  resolution keeps tokens unchanged (existing sessions survive the
  SaaS migration), makes suspension effective at the next request, and
  works identically for web and mobile. The only cost is one indexed
  `User.companyId` lookup per company request; public catalog routes
  resolve via the domain map (P.5), which is cacheable in memory.
* `IMPLEMENTATION CONSEQUENCES` — Phase 2 adds a `resolveCompanyContext`
  middleware in `src/middleware/companyContext.js` (mounted after
  `authenticate`): authenticated company users resolve via
  `User.companyId`; public/customer storefront routes resolve via
  `Host → CompanyDomain`; SUPER_ADMIN resolves to platform context
  (`companyId = NULL`). `login`/`refresh`/`getMe` additionally re-check
  `Company.status`. `hasClientCompanyId()` already exists as the single
  detection helper for ignore/reject behavior.
* `MIGRATION IMPACT` — None for existing sessions: token shape, secrets,
  lifetimes, cookie flags, and rate limiters are untouched. Backward
  compatible by construction.
* `STATUS` — `RECOMMENDED, IMPLEMENTED` (see §§S–AW).

### P.2. Global vs per-company `Order.orderNumber`

* `DECISION (RECOMMENDED)` — Keep `Order.orderNumber` globally unique.
  Do not convert it to per-company uniqueness.
* `RATIONALE` — `CURRENT` numbering is a global yearly sequence
  (`ORD-YYYY-000001`, zero-padded to 6 digits, max 999999/year enforced
  in `src/modules/orders/orders.service.js:nextOrderNumber`; latest
  lookup by `startsWith` prefix in
  `src/modules/orders/orders.repository.js:findLatestOrderNumberForYear`;
  `@unique` on a `VARCHAR(30)` column in `prisma/schema.prisma`).
  Per-company numbering would require a per-company sequence generator,
  a composite unique, backfill-safe renumbering rules, and a decision on
  what happens to pre-SaaS numbers — all for no isolation benefit,
  because order access is enforced by `companyId + ownership`, never by
  number secrecy. Global uniqueness is simpler, keeps the existing
  generator and retry-on-`P2002` logic (`orders.service.js`) untouched,
  preserves customer-facing number stability, and keeps platform-wide
  support lookups unambiguous. The residual effect (order volume is
  faintly inferable from sequence gaps across companies) is accepted as
  negligible for this platform.
* `IMPLEMENTATION CONSEQUENCES` — `Order` still gains a direct
  `companyId` column with `@@index [companyId, …]` for scoping; the
  `orderNumber @unique` constraint and generator stay exactly as-is.
  Admin search over `orderNumber`/SKU/product-name snapshots gains a
  `companyId` predicate.
* `MIGRATION IMPACT` — Zero: no data rewrite, no unique-index swap, no
  backfill conflict for this column.
* `STATUS` — `RECOMMENDED, IMPLEMENTED` (global uniqueness kept by decision; see §P.2 and §§S–AW).

### P.3. Denormalized `ProductVariant.companyId`

* `DECISION (RECOMMENDED)` — Store `companyId` directly on
  `ProductVariant` (denormalized alongside `Product.companyId`).
* `RATIONALE` — `CURRENT` hot paths address variants by `variantId`
  alone: cart purchasability/stock checks, `inventory` initialize/adjust
  (`findByVariantId`, `adjustWithLedger`), and the order-creation
  transaction (which selects `variant → product → inventory` per cart
  line). The admin inventory list is hand-written raw SQL
  (`inventory.repository.js:findInventoryAdmin` joining
  `product_variants v → products p → inventory i`). A direct
  `variant.companyId` enables single-column company predicates in all
  of these, including the raw SQL, without an extra join per check.
  Drift risk — the usual objection to denormalization — is negligible
  here: `productId` is not in the variant updatable field set, so a
  variant never moves between products/companies after creation;
  `companyId` is effectively write-once, set inside the existing
  `createProductWithVariants` transaction with a
  `variant.companyId == product.companyId` invariant check.
* `IMPLEMENTATION CONSEQUENCES` — `ProductVariant` gains non-nullable
  `companyId` (+ index); creation paths assert equality with the parent
  product's `companyId`; variant-scoped reads predicate on the column
  directly; company deletion can walk variants without joining products.
* `MIGRATION IMPACT` — Backfill is mechanical (`variant.companyId =
  parent product.companyId` for all rows, both landing on Company #1).
  No unique-index swap on this table beyond the planned
  `[companyId, sku]` composite.
* `STATUS` — `RECOMMENDED, IMPLEMENTED` (see §§S–AW).

### P.4. Exactly one ADMIN per company under MySQL

* `DECISION (RECOMMENDED)` — Enforce with `Company.adminUserId`
  (`CHAR(36)`, `@unique`, FK to `User.id`): one nullable column on the
  company row pointing at its ADMIN.
* `RATIONALE` — `CURRENT` role assignment has no invariant at all:
  `createUserWithRole` find-or-creates any role name, and the users
  module exposes no role-assignment endpoint (only
  `PATCH /users/:id { isActive }`). MySQL offers no partial unique
  index, so a "unique ADMIN per company" rule cannot live on `User`
  alone. Of the viable options — (a) `Company.adminUserId @unique`,
  (b) a `CompanyAdmin(companyId @unique, userId @unique)` join table,
  (c) service-plus-test enforcement only — option (a) wins: it is a
  single DB-enforced column, self-documenting, race-safe under
  concurrent provisioning (unique constraint, not app check), and it
  matches the provisioning order the requirements already imply
  (SUPER_ADMIN creates the company, then generates that company's
  ADMIN credentials — sections C/H). The column stays nullable only
  for the bootstrap window between company creation and ADMIN
  generation; application logic requires it set before activation.
  Option (b) adds a table for a cardinality the domain fixes at one;
  option (c) alone cannot close the concurrent-provisioning race.
* `IMPLEMENTATION CONSEQUENCES` — New `Company` model carries
  `adminUserId` unique FK; provisioning flow is
  create-company → generate-ADMIN → set `adminUserId` → activate;
  ADMIN replacement is a single audited update; HEAD/MEMBER management
  stays in `User`/`UserRole` service logic with tests.
* `MIGRATION IMPACT` — New table/column, no existing-data rewrite:
  Company #1's `adminUserId` is set to the existing ADMIN user during
  backfill. Nullable-until-provisioned avoids a chicken-and-egg
  migration.
* `STATUS` — `RECOMMENDED, IMPLEMENTED` (see §§S–AW).

### P.5. Domain-registry storage and TLS architecture

* `DECISION (RECOMMENDED)` — Store company domains in a
  `CompanyDomain` database table (`domain @unique`, `companyId` FK,
  `isPrimary`); terminate TLS outside the backend (reverse proxy /
  platform ingress). The backend stays plain HTTP behind the proxy and
  resolves company context from `Host` (or `X-Forwarded-Host`).
* `RATIONALE` — `CURRENT` host handling is a single/CSV `CORS_ORIGIN`
  (`src/config/env.js:parseCorsOrigin`) with no host-based logic
  anywhere. An environment map would require a redeploy per company and
  cannot be managed through the SUPER_ADMIN "company domain
  configuration" capability (section C). A table is dynamic,
  SUPER_ADMIN-manageable, and lookup-shaped exactly like the future
  `Host → company` middleware needs (exact-match + in-memory cache).
  TLS certificate issuance/renewal/automation is deployment
  infrastructure, not application behavior: building it into the
  Express backend would be speculative infrastructure the requirements
  never ask for. CORS origins and cookie `Domain`/`SameSite` remain
  derived from the registered domains at request time.
* `IMPLEMENTATION CONSEQUENCES` — New `CompanyDomain` model +
  SUPER_ADMIN CRUD; domain→company resolution middleware with a
  short-TTL cache; CORS/cookie handling consults the registry;
  deployment runbook (outside this repo's code) covers proxy + certs.
* `MIGRATION IMPACT` — New table only. Company #1's current origin is
  seeded as its primary domain; no existing rows change.
* `STATUS` — `RECOMMENDED, IMPLEMENTED` (registry + runtime resolution live; TLS stays outside the backend per the decision — see §§S–AW; Company #1 production hostname is an operator cutover step, see §AX).

### P.6. Shared vs per-company Google OAuth client

* `DECISION (RECOMMENDED)` — One shared platform Google OAuth client
  (`GOOGLE_CLIENT_ID`) for all companies, plus an optional per-company
  `googleClientIds` allowlist for company mobile apps that require
  their own client entry.
* `RATIONALE` — `CURRENT` verification (`src/modules/auth/auth.google.js`)
  checks RS256 against Google JWKS with `aud == GOOGLE_CLIENT_ID`
  (single value from `src/config/env.js`; empty means 503
  `AUTH_GOOGLE_NOT_CONFIGURED`). The Google `aud` identifies the
  backend's OAuth client, not the company: company binding must happen
  *after* Google verification, from the request's domain/app context
  (P.1/P.5), never from the Google token. Per-company backend clients
  would multiply secrets, JWKS-audience mapping, and app configuration
  for zero isolation gain. The genuine exception is mobile: each
  company's own app (distinct bundle id / package) may need its own
  OAuth client entry in the same Google Cloud project. The allowlist
  covers that without changing the default path: token `aud` must be
  in `{ platform GOOGLE_CLIENT_ID } ∪ company.googleClientIds`, and
  the company still comes from the app/domain contract, not from `aud`.
* `IMPLEMENTATION CONSEQUENCES` — `Company.googleClientIds` (JSON list,
  default empty = platform default only); verification accepts the
  union; empty platform ID preserves today's 503 behavior; no change to
  the JWKS cache/rotation logic.
* `MIGRATION IMPACT` — New nullable column with empty default; zero
  backfill; current single-client deployments behave identically.
* `STATUS` — `RECOMMENDED, NOT IMPLEMENTED`.

### P.7. Suspended-company static-media behavior

* `DECISION (RECOMMENDED)` — Keep `express.static` unauthenticated for
  performance, scope all new stored paths under a per-company prefix,
  enforce suspension at the API/data layer, and document the residual:
  already-distributed image bytes (and CDN/browser caches) are not
  recalled on suspension.
* `RATIONALE` — `CURRENT` serving is `express.static(UPLOADS_ROOT)`
  mounted *before* the rate limiter with `maxAge 7d`
  (`src/app.js`); the storage adapter writes DB-relative references
  (`products/<productId>/<uuid>.webp`,
  `categories/<categoryId>/<uuid>.webp`) with a traversal guard
  (`local.storage.js`), and `OrderItem.imageStoragePath` snapshots
  survive media deletion by design. Putting an auth/suspension guard in
  front of every image request would tax the hottest, most cacheable
  path to protect public marketing bytes, while the actually sensitive
  surface (prices, stock, customers, orders) is entirely API-served and
  therefore suspension-enforceable. The per-company prefix
  (`<companyId>/products/…`, `<companyId>/categories/…`) is still
  required: it makes permanent deletion reclaim storage by deleting a
  subtree, and lets any future guard scope by company. Legacy flat
  paths stay readable (dual-read) so existing storefront images never
  break; only new writes use the prefix.
* `IMPLEMENTATION CONSEQUENCES` — Storage `save()` callers pass the
  company prefix; deletion flow removes the company subtree;
  suspension middleware covers all API routes (including public catalog
  and customer auth) but not the static mount; the residual is
  documented for operators.
* `MIGRATION IMPACT` — No file moves, no DB rewrite of existing
  `storagePath` values. New writes use prefixed paths; old paths keep
  serving.
* `STATUS` — `RECOMMENDED, IMPLEMENTED` (prefixed writes + API/data-layer suspension gate live; residual documented — see §§S–AW).

### P.8. HEAD scope over marketing/announcements

* `DECISION (RECOMMENDED)` — Marketing notifications and site
  announcements stay ADMIN-only. HEAD gains no management rights over
  either.
* `RATIONALE` — The agreed matrix is explicit about HEAD's remit
  (operational: inventory, categories, coupons, products within
  lifecycle rules, orders — section E) and about ADMIN owning
  "permitted notifications/announcements" (section D), while MEMBER is
  expressly forbidden from managing notifications (section F) and
  CUSTOMER reads are fixed. Broadcasts render storefront-wide for every
  customer of the company (brand, legal, and pricing exposure), so they
  carry the highest blast radius of any "content" write — higher than
  single-product edits. The `CURRENT` code already enforces ADMIN-only
  management (`marketing.routes.js`, `announcements.routes.js`:
  `authenticate + authorize("ADMIN")` on all admin endpoints; public
  `GET /announcements/current` and auth-only active marketing list for
  reads), and the Phase 0 matrix (`src/config/permissions.js`) grants
  `notification:MANAGE`/`announcement:MANAGE` to ADMIN only. Extending
  HEAD would expand agreement scope, not resolve ambiguity. Revisit
  later if operations demand it — no schema change would be needed.
* `IMPLEMENTATION CONSEQUENCES` — None beyond the planned work: future
  role wiring adds HEAD to catalog/order/coupon routes but leaves
  marketing/announcement admin routes ADMIN-gated; company scoping
  still adds `companyId` to both models and predicates to their reads.
* `MIGRATION IMPACT` — None (no schema, constraint, or data change
  implied by this decision).
* `STATUS` — `RECOMMENDED, ADOPTED` (policy honoured in implementation: broadcasts/announcements stay ADMIN-only — see §§S–AW).

### P.9. MEMBER negative inventory adjustments vs deactivation

* `DECISION (RECOMMENDED)` — Negative inventory adjustments are NOT
  classified as deactivation. MEMBERs may record ledgered quantity
  adjustments up or down through the existing endpoint; deactivation
  keeps its codebase meaning (`isActive = false` toggles and `DELETE`
  endpoints), which MEMBERs can never invoke.
* `RATIONALE` — `CURRENT` semantics separate the two concepts cleanly:
  `adjustInventory` maps positive deltas to `RESTOCK` and negative
  deltas to `ADJUSTMENT` (`inventory.service.js`), every adjustment
  appends an `InventoryTransaction` ledger row, and the repository
  decrements atomically with an insufficient-stock guard
  (`adjustWithLedger`: negative deltas cannot drive quantity below
  zero — 409 instead). No `isActive` flag exists on inventory at all;
  availability state lives on product/variant, whose transitions
  MEMBERs are already barred from. Section F's "manage inventory" for
  MEMBERs therefore covers exactly this ledgered count work (receiving,
  cycle counts, damage write-offs), and every entry is attributable via
  the ledger plus the future audit log. The edge case motivating the
  question — zeroing stock makes a variant effectively unsellable — is
  real but bounded: it cannot go negative, it never hides the product,
  it is fully reversible by a positive adjustment, and it is visible to
  ADMIN/HEAD oversight. Capping MEMBER write-downs (e.g. "may not take
  a variant out of stock") would add read-modify-write predicates to a
  hot path for a policy the requirements never state; anomaly review
  stays an explicit non-goal.
* `IMPLEMENTATION CONSEQUENCES` — MEMBER role wiring includes the
  existing `POST`/`PATCH` inventory endpoints unchanged; every
  adjustment continues through `adjustWithLedger`; actor attribution
  flows into the audit log (Phase 6). No new guard, no new endpoint.
* `MIGRATION IMPACT` — None (no schema, constraint, or data change).
* `STATUS` — `RECOMMENDED, ADOPTED` (policy honoured in implementation — see §§S–AW).

---

## Q. PHASE 1 ENTRY CONDITIONS

All nine Phase 0 decisions are resolved as recommendations (section P).
Schema, authentication, company-isolation, domain-resolution, Google,
suspension, audit-retention, and password-reset/OTP implementation have
all been delivered — Phase 1 status is COMPLETE (see §R).

Phase 1 may begin when the operator confirms the nine recommendations
in section P (or records amendments there first, per the maintenance
rule in section O). The confirmed set then governs, in order: `Company`
/ `CompanyDomain` foundation with `Company.adminUserId` (P.4, P.5),
Company #1 backfill, server-side company resolution (P.1),
denormalized `ProductVariant.companyId` with composite uniques except
`orderNumber`, which stays global (P.2, P.3), Google allowlist column
(P.6), and company-prefixed media paths (P.7), with marketing (P.8) and
MEMBER inventory semantics (P.9) carried into role wiring as stated.

---

## R. PHASE 1 IMPLEMENTATION RECORD — DATA-MODEL FOUNDATION

Phase 1 status is COMPLETE: the database foundation below is
implemented, applied, backfilled, and verified. Platform CRUD endpoints
(SUPER_ADMIN company APIs/UI) were delivered by later phases (see §§AJ,
AT—AV and the phase table).

### R.1. Exact schema additions (`prisma/schema.prisma`)

* `enum CompanyStatus { ACTIVE, SUSPENDED }` (lifecycle values per H).
* `model Company` → `companies`: `id` UUID PK; `name VARCHAR(255)`
  required (no uniqueness: exact-name confirmation selects by id first,
  so global name uniqueness is not required); `status CompanyStatus`
  default `ACTIVE`; `adminUserId CHAR(36)` nullable `@unique`
  (exactly-one-ADMIN association per P.4; nullable only for the
  create/provision bootstrap window); `createdAt`/`updatedAt` per
  project conventions. Relations: `admin → User?` (`CompanyAdmin`,
  `onDelete: SetNull`), `users → User[]` (`CompanyUsers`),
  `domains`, `categories`, `products`, `variants`. Index on `status`.
  Extended branding/config columns (logo, contact, theme, …) are
  deferred to the platform-CRUD task.
* `model CompanyDomain` → `company_domains`: `id` UUID PK;
  `companyId CHAR(36)` required (FK → `companies.id`,
  `onDelete: Cascade`); `domain VARCHAR(255)` `@unique` (one hostname
  belongs to at most one company, per P.5); `isPrimary` default false
  (single-primary is application-enforced later — MySQL has no partial
  unique index); `isActive` default true (zero-downtime domain cutover);
  `createdAt`/`updatedAt` per conventions. Index on `companyId`.

### R.2. Tenant columns added (all nullable `CHAR(36)` + FK + index)

* `users.company_id → companies.id ON DELETE SET NULL` — identity root:
  every user-owned row derives company scope through the owner, and the
  ADMIN association target must itself be company-assigned. Nullable
  permanently for future platform identities (`SUPER_ADMIN` carries no
  company). Email uniqueness stays global until Phase 2.
* `categories.company_id → companies.id ON DELETE RESTRICT` — catalog
  root sibling of products; a product's category must be co-company for
  a coherent catalog boundary. Slug uniqueness stays global until
  Phase 2.
* `products.company_id → companies.id ON DELETE RESTRICT` — catalog
  root and the backfill source for variant tenancy. Slug uniqueness
  stays global until Phase 2.
* `product_variants.company_id → companies.id ON DELETE RESTRICT` —
  denormalized per P.3 (write-once at creation; `productId` is
  immutable by application behavior, so no sync mechanism). SKU/barcode
  uniqueness stays global until Phase 2.
* `Restrict` (not `Cascade`) on catalog edges matches the existing
  catalog FK posture: a company row cannot be dropped while catalog
  rows reference it; permanent deletion purges catalog first (Phase 5).
* Columns are nullable — not yet `NOT NULL` — by staged design: no
  service stamps `companyId` yet (company resolution is a later phase),
  so a `NOT NULL` constraint today would break every existing
  product/variant/category/user create path and its tests. Tightening
  to `NOT NULL` happens in Phase 2 together with service stamping and
  composite uniques. All existing rows are backfilled (R.4), so no
  legacy NULLs exist from this migration.

### R.3. Explicitly deferred tenant columns (no change now)

Orders, order items/addresses, payments, order status history, returns
(+ history), reviews, coupons (+ usage/history/products), carts (+
items), wishlists (+ items), addresses, inventory (+ transactions),
notifications, marketing notifications, announcements, product images —
all derivable through the four roots above (`User`, `Category`,
`Product`, `ProductVariant`). Adding unenforced nullable columns with
no readers would be speculative; each arrives with its composite-unique
work and enforcement in Phase 2/4. `Order.orderNumber` stays globally
unique per P.2 (no change ever planned).

### R.4. Company #1 backfill (verified)

* Company #1: id `35b5a215-0cf3-42db-ba42-6fac6656a708`
  (deterministic, hardcoded in the migration), name `Tech Pulse`
  (matches `BRAND` in `prisma/seed.js`), status `ACTIVE`.
* All pre-existing rows assigned: 1003 users, 494 categories,
  621 products, 999 variants (zero NULL `company_id` afterwards; counts
  identical before/after — UPDATEs only, no duplicates, no deletions).
* Variants backfilled from the parent product
  (`UPDATE … JOIN products … SET v.company_id = p.company_id`);
  post-migration mismatch count is 0.
* ADMIN association: `admin_user_id` set to the earliest ADMIN account
  (`admin@example.com`, active) via ordered subquery; stays NULL only
  when no ADMIN exists (bootstrap window). No user created, duplicated,
  or modified beyond the tenant association. No passwords appear in
  migration code.
* Order numbers, customer emails, and all existing ids untouched.

### R.5. Current-domain seed — deferred with reason

`CORS_ORIGIN` is `http://localhost:5173,http://localhost:3001,http://localhost:3000`
— development origins only, no production hostname. Per the task rule
against inventing hostnames, NO `CompanyDomain` row was seeded
(0 domains for Company #1). Missing input: the production storefront
hostname. Seeding resumes once it is provided.

### R.6. Migration

* ONE new migration: `20261002075021_phase1_company_foundation`.
* Strategy: generated DDL via the repo's Prisma 7 workflow
  (`migrate dev --create-only`), then inserted the deterministic
  backfill block (INSERT Company #1 → UPDATE roots → JOIN-update
  variants → ADMIN subquery) before the FK constraints; applied with
  `migrate dev`. No existing migration touched; no reset, no `db push`,
  no squash, no Prisma upgrade (client regenerated at 7.10.0).
* Prisma Client required one explicit `prisma generate` after apply
  before new models were importable; recorded here for future runs.

### R.7. Test coverage

* New `tests/integration/company-foundation.test.js` (8 tests, live
  MySQL, fixtures cleaned up, Company #1 read-only): lifecycle values,
  `adminUserId` uniqueness (`P2002` on double-assign), domain hostname
  uniqueness (`P2002`), domain cascade on company delete, variant↔
  product consistency (NULL-safe), no off-company tenant rows, order
  numbers intact. Assertions are concurrency-safe against sibling suites
  sharing the database (unstamped NULL rows are expected, not failures).
* Full suite: 36 files, 287/287 passed. No existing test modified.
* Known seed gap (documented, not fixed — seed changes were out of
  scope): `prisma/seed.js` still creates catalog rows without
  `companyId`; future seed runs yield NULL-company rows until Phase 2
  stamps Company #1 there.

### R.8. Explicitly still NOT IMPLEMENTED (as of Phase 2C-31)

Google per-company allowlist column (`Company.googleClientIds`),
billing/subscriptions, and the mobile/app company-resolution
contract. Everything else in the original list — authentication/JWT
company resolution, company-context enforcement, suspension
enforcement, runtime domain resolution, Super Admin APIs/UI,
password reset/OTP, audit logs/retention, and NOT NULL tightening +
composite uniques — is implemented (see phase table and §§S—AY).
HEAD/MEMBER user-management HTTP endpoints landed in 2C-31 (see
§AY); operational-route RBAC wiring (HEAD/MEMBER on catalog/order
routes, which stay ADMIN-only) remains the one role-hierarchy gap
(Phase 3 PARTIAL).

---

## S. PHASE 2A IMPLEMENTATION RECORD — COMPANY CONTEXT BOUNDARY

Phase 2A status is COMPLETE: server-side company resolution is
implemented, tested (24 new tests), and verified against the full suite
(38 files, 311/311). The resolver is NOT mounted on any route yet;
tenant enforcement, suspension, domain resolution, and RBAC remain NOT
IMPLEMENTED (Phase 2B and later).

### S.1. Resolution flow

`authenticate` (unchanged) establishes `req.user = { id, roles }`.
`resolveCompanyContext` (`src/middleware/companyContext.js`, intended
placement immediately after `authenticate` when Phase 2B wires it)
then:

1. rejects requests without `req.user.id` (401 `AUTH_UNAUTHORIZED`);
2. reads ONE repository projection,
   `findUserWithCompanyContext(userId)`
   (`src/modules/auth/auth.repository.js`): user id, scalar
   `companyId`, database-authoritative role names, and the owned
   company row (`id`, `name`, `status`, `adminUserId`);
3. applies the pure decision `decideCompanyContext(record)` (same file,
   no I/O) and either attaches the structured
   `req.companyContext = { companyId, company: { id, name, status } |
   null, isPlatformContext }` or fails closed with `next(AppError)`.

No step reads query/body/headers for company data and no step writes
to the JWT. A global mount was deliberately avoided: pre-SaaS
ADMIN-role fixture accounts predate company provisioning and would
fail the ADMIN consistency check, so wiring waits for Phase 2B
(provisioning + fixture migration first).

### S.2. SUPER_ADMIN vs company-scoped roles

* SUPER_ADMIN (database role) always receives platform context
  (`companyId: null`, `company: null`, `isPlatformContext: true`) —
  even if the row carries a `companyId`, and never rejected for a null
  one. `isPlatformContext(req)` is the single predicate later
  authorization uses to tell platform from company context.
* ADMIN/HEAD/MEMBER/CUSTOMER must resolve to exactly one company via
  `User.companyId`; null fails closed (403 `AUTH_COMPANY_REQUIRED`).
  Role names for resolution come from the database, not token claims
  (verified by a test resolving with empty claims).

### S.3. ADMIN consistency check

When database roles include ADMIN, resolution additionally requires
`Company.adminUserId === user.id`, else 403 `AUTH_COMPANY_INCONSISTENT`
— including while `adminUserId` is still NULL (incomplete provisioning
grants nothing). No automatic repair or reassignment exists by design.
HEAD/MEMBER/CUSTOMER treat `User.companyId` as authoritative with no
further check.

### S.4. Client-supplied companyId

Ignored by construction: the middleware has no code path that reads
`query.companyId`, `body.companyId`, or the `x-company-id` header for
resolution. `hasClientCompanyId()` remains the single detector.
Tests prove an adversarial request carrying all three still resolves
to the database company.

### S.5. Missing/suspended companies

* Null `companyId` (company roles) → 403 `AUTH_COMPANY_REQUIRED`.
* Set-but-unreadable `companyId` → 403 `AUTH_COMPANY_INVALID`
  (defensive; foreign keys normally prevent it). Unknown user id and
  role-less users fail closed with the pre-existing 401/403 codes.
* All failure messages are neutral about other companies' existence.
* `Company.status` is exposed on `company.status` (SUSPENDED verified
  visible) and never blocks in this phase. Account-active (`isActive`)
  enforcement stays exactly where it is (login/refresh/profile paths);
  no new gate was added.

### S.6. JWT and refresh behavior — unchanged (verified)

* `src/utils/jwt.js`, `src/middleware/authenticate.js`,
  `src/middleware/authorize.js`, refresh rotation, cookie flags,
  lifetimes, secrets, rate limiters, and Google flow are byte-identical
  to Phase 1. Access payload keys remain exactly
  `sub/roles/iat/exp` (locked by test). Refresh concurrency suites
  pass unmodified in the full run.

### S.7. Tests added

* `tests/unit/company-context.test.js` (14 tests, no database):
  all fail-closed branches via the pure decision function, success
  paths incl. SUPER_ADMIN-with-companyId and SUSPENDED exposure,
  middleware no-identity shell, client-override detector contract, JWT
  shape lock.
* `tests/integration/company-context.test.js` (10 tests, live MySQL):
  ADMIN/HEAD/MEMBER/CUSTOMER resolve to `User.companyId`,
  DB-roles-beat-claims, SUPER_ADMIN platform context, null-company and
  inconsistent-ADMIN fail-closed, override ignored live, SUSPENDED
  exposed without enforcement. Fixtures cleaned up (test users deleted,
  cascading test role links; `HEAD`/`MEMBER`/`SUPER_ADMIN` role rows
  remain as future reference data).
* Full suite: 38 files, 287 pre-existing + 24 new = 311/311 passed.
  No existing test modified.

### S.8. Files changed in Phase 2A

* `src/middleware/companyContext.js` (extended: decision + middleware;
  pure helpers byte-identical), `src/modules/auth/auth.repository.js`
  (one read-only projection added), two new test files, this document.
  No schema, migration, route, service, JWT, permission-matrix, or
  config change.

### S.9. Remaining Phase 2B work

Mount `resolveCompanyContext` after `authenticate` route-by-route;
migrate fixtures/pre-SaaS ADMIN accounts to provisioned company
memberships; service-level tenant stamping + composite uniques +
`NOT NULL` tightening; `CompanyDomain` runtime resolution; suspension
enforcement; RBAC wiring from `src/config/permissions.js`.

---

## T. PHASE 2B-1 IMPLEMENTATION RECORD — USER PROVISIONING FOUNDATION

Phase 2B-1 status is COMPLETE: company-aware employee provisioning is
implemented as internal service primitives (no new APIs), tested
(11 new tests), and verified against the full suite (39 files,
322/322). `companyContext` remains unmounted. Overall Phase 2 was
NOT STARTED at this point, pending 2B-2 (mounting) and tenant
stamping — now COMPLETE (see phase table and §AX).

### T.1. Creation paths inspected

* `auth.service.register` → always CUSTOMER, no company input, no
  company assignment (public flow; assignment deferred — T.4).
* `auth.service.loginWithGoogle` → always CUSTOMER, same deferral.
* No employee-creation endpoint exists; no validation schema anywhere
  accepts `companyId` (verified by search), so there was no client
  tenant field to strip — client tenancy is impossible by construction.
* Tests create users via HTTP registration (CUSTOMERs, deferred class)
  or synthetic JWT identities; exactly one suite (`coupon-history`)
  attached a real ADMIN role — now company-stamped (T.5).

### T.2. New provisioning primitives (service layer, no routes)

* `users.service.provisionCompanyAdmin(companyId, identity)`:
  companyId identifies the target Company as an internal-operation
  input; verifies the company exists and has no ADMIN (409
  `COMPANY_ADMIN_EXISTS`); atomically creates the ADMIN stamped with
  the company and links `Company.adminUserId` in one transaction
  (`users.repository.provisionCompanyAdminTx`); the UNIQUE constraint
  on `admin_user_id` is the concurrent-provisioning race guard (P2002
  → 409). Never creates a second ADMIN.
* `users.service.provisionEmployee(creator, { role, …identity })` for
  HEAD/MEMBER only (ADMIN/CUSTOMER/SUPER_ADMIN/unknown → 422):
  `creator` is an explicit `{ id, companyId, roles }` server context
  (never `req`); role compatibility via the permission matrix
  `canManageRole` (ADMIN→HEAD/MEMBER, HEAD→MEMBER, else 403); the new
  user inherits `creator.companyId`; any `companyId` on the input is
  destructured away and ignored. Repository:
  `users.repository.createUserWithCompanyRole` (transactional
  create + find-or-create role + link, mirroring the auth repository).
* Passwords hashed with the existing Argon2id helper; identity rules
  mirror registration (email normalized, password 8–128, firstName
  required). `toSafeUser` response shape unchanged (`companyId`
  selected at repository level but never serialized).

### T.3. companyId sources (answering "where does companyId come from?")

* ADMIN: the target Company row of the provisioning operation.
* HEAD/MEMBER: the creator's server-resolved company context.
* CUSTOMER: DEFERRED (no secure resolution until CompanyDomain
  runtime; public registration behavior preserved, NULL locked by test).
* SUPER_ADMIN: platform-scoped, no company; no creation path added
  (Super Admin APIs remain a later phase).
* Never: request body/query/header, JWT claim, frontend state, or
  hard-coded Company #1 in production code.

### T.4. Deferred paths (behavior preserved, not guessed)

* CUSTOMER registration and Google OAuth keep current behavior exactly
  (verified: registration still 201s with NULL `companyId`; Google
  untouched; full auth/refresh suites pass). Assignment resumes with
  domain/app-context resolution in a later phase.

### T.5. Fixture migration

* New `tests/helpers/userFixtures.js`: shared `COMPANY_ONE_ID` +
  `stampUserCompany()` (test-setup-only; null-needing boundary tests
  must not use it). `company-foundation`/`company-context` tests now
  import the shared constant; `coupon-history`'s real ADMIN fixture is
  stamped with Company #1 (one additive update; assertions unchanged).
* Synthetic-JWT suites (`"admin-test"`/`randomUUID()` identities) are
  intentionally untouched: they exercise claim-based `authorize`, and
  their migration to provisioned users belongs to Phase 2B-2 mounting,
  which now has the `provisionCompanyAdmin` primitive to build on.

### T.6. Why companyContext remains unmounted

Mounting now would flip pre-SaaS ADMIN-role accounts (fixtures and
legacy rows whose `adminUserId` points elsewhere) from working to
403 without their provisioning story complete. Mounting (2B-2) follows
after fixture/provisioning migration uses this phase's primitives.
`app.js`/router mounting untouched — verified.

### T.7. Tests and verification

* New `tests/integration/user-provisioning.test.js` (11 tests, live
  MySQL, dedicated test companies, Company #1 read-only): ADMIN
  link-both-sides, duplicate-ADMIN 409 with link intact, unknown
  company 404 with no orphan user, HEAD/MEMBER inheritance incl.
  HEAD→MEMBER, HEAD-cannot-create-HEAD, MEMBER-cannot-create,
  payload-`companyId` ignored, role allowlist 422s, registration
  deferral lock (201 + NULL), Company #1 ADMIN untouched.
* Full suite: 39 files, 322/322 passed. No existing test modified
  except the one additive fixture stamp (T.5).
* Unchanged (verified by diff): JWT, authenticate/authorize, refresh
  flow/cookies/concurrency, rate limits, Google verification, login/
  logout/register behavior, Prisma schema, all migrations (no new
  migration, no reset, no `db push`, no upgrade), product/order/cart/
  inventory logic, permissions.js, companyContext behavior, frontend.

### T.8. Prerequisites remaining for Phase 2B-2

Mount `resolveCompanyContext` after `authenticate` route-by-route;
migrate claim-only test identities to provisioned users via §T.2;
service-level tenant stamping with composite uniques + `NOT NULL`
tightening; `CompanyDomain` runtime resolution (unlocks CUSTOMER/
Google assignment); suspension enforcement; RBAC wiring; Super Admin
provisioning APIs.

---

## U. PHASE 2B-2 IMPLEMENTATION RECORD — MOUNTED REQUEST BOUNDARY

Phase 2B-2 status is COMPLETE: the resolver is mounted on the full
authenticated company-scoped surface, fixtures are migrated, and the
suite passes 40 files / 333 tests. Resource-level tenant filtering/
stamping, `NOT NULL` tightening, composite uniques, domain resolution,
suspension enforcement, RBAC wiring, and Super Admin CRUD remain NOT
COMPLETE.

### U.1. Synthetic identities found and classified

* 22 suites used the byte-identical claim-only ADMIN line
  (`signAccessToken({ id: "admin-test", … })` — a nonexistent subject).
* `coupons.routes.test.js` minted fresh `randomUUID()` subjects per
  call (also nonexistent).
* ~35 HTTP-registered CUSTOMER users carried NULL `companyId`
  (deferred class, resolvable by stamping).
* Intentionally synthetic (untouched in meaning): no-token 401s,
  malformed-token 401s, unknown-user cases, negative registration
  validations, the NULL-company deferral lock, and the dangling-row
  unit branch (unreachable over HTTP — foreign keys prevent it).

### U.2. Migration performed

* The 22 `admin-test` lines now use Company #1's provisioned ADMIN id
  via a read-only cached lookup (`companyOneAdminId()`, top-level
  await per suite — no production mutation).
* Every 201-success HTTP registration is followed by
  `stampUserCompany()` (test-setup-only stamping; negative-validation
  sites skipped — they create no user).
* `coupons.routes`: ADMIN → Company #1 ADMIN; CUSTOMER → one real
  stamped user (preserves 403-from-`authorize` semantics instead of
  collapsing to 401).
* `coupon-history`: rebuilt on a dedicated test company with a
  `provisionCompanyAdmin` ADMIN (a Company #1-stamped non-admin would
  fail ADMIN-consistency by design); actor-identity assertions
  unchanged in strength.
* New shared helpers: `companyOneAdminId`,
  `companyOneAdminHeaders` (`tests/helpers/userFixtures.js`).

### U.3. Mount boundaries and ordering

* Inserted `resolveCompanyContext` immediately after `authenticate`
  (before `authorize`/`uploadSingleImage`/controllers) in all 19 route
  files: auth (`GET /me` only), users, addresses, cart, wishlist,
  notifications, returns (+ admin), reviews, orders, coupons,
  marketing, announcements, media writes, inventory (nested + admin),
  categories writes, products writes, dashboard.
* `requireAdminForInactiveScope` threads the resolver inside its
  authenticated admin branch only
  (authenticate → companyContext → authorize); public catalog reads
  (`?status` absent/`active`) never reach it.
* Verified ordering on every chain: authenticate → companyContext →
  authorize. No unrelated middleware reordered.
* Explicitly outside the boundary (no `authenticate`, unchanged):
  `/health`, register/login/google/refresh/logout, public catalog and
  image reads, public product reviews, `GET /announcements/current`,
  static media serving. No SUPER_ADMIN-only routes exist yet; a
  SUPER_ADMIN calling company routes gets platform context and is
  still refused by the pre-existing `authorize` role checks.

### U.4. Runtime behavior established

* Company users resolve to `User.companyId`; ADMIN additionally
  requires `Company.adminUserId` agreement (proven firing before
  `authorize` via the `AUTH_COMPANY_INCONSISTENT`-vs-`AUTH_FORBIDDEN`
  distinction); SUPER_ADMIN resolves platform with Company #1
  untouched; missing/dangling/inconsistent fail closed with neutral
  codes; `Company.status` rides the context unenforced; query/header
  companyId is silently ignored while body companyId keeps its
  pre-existing strict-validation 422 (both proven: neither overrides).
* Controllers/services remain company-unaware by design; JWT shape,
  refresh rotation/concurrency, cookies, lifetimes, rate limits, and
  Google verification are byte-identical (full auth suites pass).

### U.5. Tests and verification

* New `tests/integration/mounted-company-context.test.js` (11 tests):
  per-role mounted resolution (ADMIN/HEAD/MEMBER/CUSTOMER/SUPER_ADMIN
  incl. platform-no-access), query/header/body override impotence,
  missing/inconsistent fail-closed, SUSPENDED non-blocking, public
  routes open, session flows unchanged. Dedicated companies; Company #1
  read-only.
* Full suite: 40 files, 322 pre-existing + 11 new = 333/333 passed.
  No assertions weakened; no existing test logic changed beyond
  identity/fixture stamping.
* Source-verified: resolver referenced only after `authenticate`
  (plus the conditional-gate thread); `git diff` contains no schema,
  migration, JWT, permission-matrix, or frontend change; no reset,
  `db push`, upgrade, commit, or push.

### U.6. Remaining work before resource-level tenant enforcement

Per-model `companyId` predicates/stamping (cart → orders chain first:
variant/product same-company assertions inside the order transaction);
composite uniques + `NOT NULL` tightening; `CompanyDomain` runtime
resolution (unlocks CUSTOMER/Google assignment and public catalog
scoping); per-company media prefix for new writes; suspension
enforcement; RBAC wiring from `permissions.js`; Super Admin
provisioning/CRUD APIs; ADMIN-credential flows.

---

## V. PHASE 2C-1 IMPLEMENTATION RECORD — CART → CHECKOUT ENFORCEMENT

Phase 2C-1 status is COMPLETE: the cart → order creation chain enforces
tenancy from server-side context, proven by 7 dedicated isolation tests
within a 41-file / 340-test green suite. No schema migration was
needed. Overall Phase 2 was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX)
(V.6).

### V.1. Design: derivation, not duplication (no schema change)

No new columns: cart ownership derives via `Cart.userId`, cart lines
via their cart, variants via denormalized `companyId` (Phase 1/P.3),
products via their own `companyId`, addresses via `Address.userId`.
`companyId` selects were added to repository projections only
(cart/variant/product/category shapes) and are never serialized
(mappers pick explicit fields — verified). The order row itself gains
no column yet; its Company A ownership holds through
`Order.userId → User.companyId` plus the transaction guarantee below
(a dedicated `Order.companyId` arrives with the orders slice).

### V.2. Predicates and stamping added

* Cart add/update (`cart.service`, new `companyId` param from
  `req.companyContext` via a local `companyIdOf` controller helper):
  new `assertSameCompany` requires a non-null company (fail closed,
  incl. platform contexts) and variant+product company equality, else
  404 `PRODUCT_VARIANT_NOT_FOUND` — identical to unknown ids, so no
  existence oracle. Cart read/remove stay `userId`-scoped (already
  cross-user-safe by construction).
* Checkout (`orders.service.createOrder` + `createOrderTransaction`,
  same `companyIdOf` handoff): the transaction selects variant/product
  `companyId` in the SAME read that feeds availability, totals,
  snapshots, inventory decrement, and cart clearing; any line failing
  the match aborts with a new `cross-company` outcome mapped to 404
  `PRODUCT_VARIANT_NOT_FOUND`. Check and consumption can never
  diverge — no TOCTOU window.
* Catalog stamping (required coherence, else even Company #1's own
  storefront breaks on new rows): category/product creates stamp the
  creator's company and validate parent/category same-company grafting
  (404s, no oracle); variants inherit the parent product's company at
  write time (P.3 invariant by construction); product category changes
  re-validate. Null creator company fails closed.
* Untouched: validation schemas (already `.strict()` — body
  `companyId` keeps its pre-existing 422), order lifecycle/inventory/
  payment/numbering/history/returns, coupon scoping (no
  `Coupon.companyId` exists yet — `order.couponId` linkage is the
  documented residual for the coupons slice), SUPER_ADMIN platform
  behavior, suspension (exposed only), public catalog.

### V.3. Cross-company attacks tested

New `tests/integration/cart-order-isolation.test.js` (dedicated
companies A/B, provisioned admins, per-company catalog): same-company
add/read; B-blind-to-A-cart; B mutate/delete of A lines → 404; A-add-B
→ 404 identical to random-UUID control; body `companyId` → 422 while
query/header ids are ignored (200, owner intact); planted B-line
checkout → 404 with zero order/stock/cart side effects (atomicity
proven); clean A checkout → 201 with all lines verified Company A and
exact inventory decrement.

### V.4. Verification and fallout

* New file 7/7; full suite 41 files, 333 pre-existing + 7 new =
  340/340. Two self-caught test bugs fixed (Zod rejects
  version-less UUIDs — randomUUID control; missing `quantity` select).
* One architectural fallout surfaced and resolved: enforcement exposed
  that API-created catalog carried NULL `companyId` (49 failures),
  fixed by the V.2 stamping above — not by weakening tests. The shared
  database also holds dedicated-company rows from overlapping runs, so
  the foundation suite's exact-total assertion was replaced with
  production-row pins + baseline lower bounds + FK-dangling checks.
* No existing behavior changed except the intended fail-closed
  additions; no migration (verified: `prisma/migrations` diff empty),
  no reset/`db push`/upgrade/commit/push.

### V.5. Deferred tenant work

Orders slice (`Order.companyId`, reads/cancel/admin scoping),
coupon/product-link scoping, wishlist parity, inventory/cart-display
predicates, marketing/announcement/notification/review/returns
scoping, composite uniques + `NOT NULL` tightening, CompanyDomain
runtime + public catalog scoping, media prefixes, suspension
enforcement, RBAC wiring, Super Admin CRUD/credentials, audit retention.

---

## W. PHASE 2C-2 IMPLEMENTATION RECORD — ORDER-SURFACE ISOLATION

Phase 2C-2 status is COMPLETE: every order read, mutation, aggregate,
payment, and order-linked return enforces the authoritative
`Order.user → User.companyId` boundary, proven by 18 dedicated tests
within a 42-file / 358-test green suite. No schema migration was
needed. Overall Phase 2 was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX)
(W.6).

### W.1. Ownership derivation (no schema change)

`Order.companyId` was evaluated and deliberately NOT added: the
existing `Order.userId → User.companyId` relationship is sufficient
and safe — every order has exactly one owning user, users are already
company-assigned, and the relationship is enforced with join predicates
in the same query/transaction that reads or mutates the order. A
dedicated column would duplicate this without closing any gap.

### W.2. Predicates added (repository boundary)

* Customer reads (`findOrdersByUserId`, `findOrderByIdAndUserId`) and
  the return order gate (`findOrderForReturn`): `where` extended with
  `user: { companyId }` — own-but-other-company and unknown ids read
  identically missing (existing 404s preserved).
* Admin list (`findOrdersAdmin`): the company predicate leads the AND
  chain, so search/status/payment/city/state/date/pagination/sorting
  can never escape it. Admin detail (`findOrderByIdAdmin`) is now a
  company-filtered `findFirst` (was unscoped `findUnique`).
* Mutations (`updateOrderStatusTransaction`,
  `bulkUpdateOrderStatusTransaction`,
  `updateOrderPaymentStatusTransaction`): each reads the order with its
  owner's `companyId` INSIDE the mutating transaction and aborts on
  mismatch (`cross-company` outcome → 404; bulk throws input-echo-only
  404 per order) — check and write share one transaction, so the
  service pre-read can never race the write (no TOCTOU).
* Admin returns (`findReturnsAdmin`, `findReturnByIdAdmin`): scoped via
  the return's owning customer (`user.companyId` — the return user is
  always the order user by creation rule).
* Dashboard order aggregates (status counts via relation filter;
  revenue/period/completed/buckets via bound `JOIN users …
  u.company_id = ?`): scoped per admin company. The inventory snapshot
  is NOT order-based and stays global by design.
* Services thread the server-resolved `companyId` (controllers pass
  `req.companyContext.companyId`) with a shared fail-closed guard
  (403 on missing — platform contexts have no order operations);
  cross-company outcomes map to the pre-existing 404 codes. Addresses
  stay owner-scoped (`Address.userId` — already tenant-safe);
  notifications/history inherit order gating; coupon rows remain the
  documented unscopable residual for the coupons slice.

### W.3. Attacks tested

New `tests/integration/order-isolation.test.js` (dedicated companies
A/B, 4+1 orders): own-list exactness; exact-id cross reads/mutations
→ 404 without number leakage (incl. 404-not-409 on status/payment
paths); B-cancel-A → 404 then own-cancel → 200; B-address-at-checkout
→ 404; mixed bulk → atomic 409 with input-only failure entries and
untouched orders, pure bulk → 200; city/search filters correct;
query/header/body companyId impotent; B history/return access → 404s,
B return list empty vs A's 1; dashboard totals exactly 4 vs 1;
SUPER_ADMIN → 403 on admin surface and guarded 403 (never 404-or-data)
on customer surface.

### W.4. Verification

* New file 18/18; full suite 42 files, 340 pre-existing + 18 new =
  358/358. No assertions weakened; lifecycle/payment/inventory/
  numbering/history/returns/JWT/refresh behavior byte-identical.
* No migration (verified: `prisma/migrations` diff empty), no reset/
  `db push`/upgrade/commit/push. Changed: order/return/dashboard
  repository+service+controller layers only, plus the new test file.

### W.5. Clarified contract (discovered while testing)

Strict `.strict()` schemas reject body `companyId` with the
pre-existing 422 (unchanged); query/header ids are silently ignored.
SUPER_ADMIN on customer order routes receives 403
`AUTH_COMPANY_REQUIRED` (guard-before-query — identical for every id,
hence leak-free), distinct from `authorize`'s 403 on admin routes.

### W.6. Deferred tenant work

`Order.companyId` only if a future gap demands it; coupon/review/
wishlist/inventory-display/marketing/notification scoping; composite
uniques + `NOT NULL` tightening; CompanyDomain runtime + public
catalog scoping; media prefixes; suspension enforcement; RBAC wiring;
Super Admin CRUD/credentials; audit retention.

---

## X. PHASE 2C-3 IMPLEMENTATION RECORD — INVENTORY ISOLATION

Phase 2C-3 status is COMPLETE: every inventory read, mutation, ledger
view, and the admin stock list enforce the
`ProductVariant.companyId` boundary, proven by 14 dedicated tests
within a 43-file / 372-test green suite. No schema migration was
needed. Overall Phase 2 was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX)
(X.6).

### X.1. Ownership derivation (no schema change)

Inventory rows carry no `companyId` and need none: every record is
keyed by `variantId`, and `ProductVariant.companyId` is write-once
(`productId` immutable), so the variant gate cannot race the keyed
mutation. Ledger rows likewise key off `variantId` and are only ever
read/written through a gated variant. No redundant column was added.

### X.2. Predicates added (repository boundary)

* All nested operations (detail, initialize, adjust, ledger history)
  funnel through one service choke point, `assertVariant`, now
  requiring the `(variantId, productId)` pair AND variant-company
  equality → 404 `PRODUCT_VARIANT_NOT_FOUND` (identical to unknown
  ids); null company fails closed first.
* Cross-variant admin list (`findInventoryAdmin` raw SQL): the variant
  tenant predicate (`v.company_id = ?`, bound) leads all filter
  combinations — search/stock/active/sort cannot escape it.
* Dashboard snapshot decision: the snapshot is served EXCLUSIVELY on
  the ADMIN-only operational dashboard (which rejects SUPER_ADMIN),
  i.e. a company operator's stock alert — so it is scoped by company
  like the order aggregates. No platform aggregate exists yet; one
  will be built separately with platform statistics, not by unscoping
  this query.
* Controllers pass `req.companyContext.companyId`; services never
  accept tenant input. No bulk-mutation or inventory-ID endpoint
  exists (verified by route inspection) — N/A by construction, not
  omitted. Strict schemas keep rejecting body `companyId` (422);
  query/header ids are ignored.

### X.3. Attacks tested

New `tests/integration/inventory-isolation.test.js` (dedicated
companies A/B/S): own list/detail/ledger; cross-variant reads via both
id pairings → 404 with no name/quantity leakage; own adjust (+ledger
row) vs cross adjust → 404 with byte-identical stock and ledger count;
cross initialize → 404; own initialize on unstocked variant → 201;
negative/overflow semantics unchanged; override channels impotent;
checkout decrement + cancel restore + `ORDER_CANCELLED` ledger intact;
SUPER_ADMIN → 403 on list and detail (no bypass); SUSPENDED admin
reads own stock → 200 (non-blocking).

### X.4. Verification

* New file 14/14; full suite 43 files, 358 pre-existing + 14 new =
  372/372. Checkout/order/return/dashboard suites pass unmodified —
  order flows already consume tenant-clean variants and never call the
  gated inventory functions directly (they use in-transaction keyed
  writes).
* No migration (verified: `prisma/migrations` diff empty), no reset/
  `db push`/upgrade/commit/push. Changed: inventory
  controller/service/repository (+admin route handoff) and dashboard
  snapshot predicate only.

### X.5. Deferred tenant work

Coupon/review/wishlist/cart-display/marketing/notification scoping;
composite uniques + `NOT NULL` tightening; CompanyDomain runtime +
public catalog scoping; media prefixes; suspension enforcement; RBAC
wiring; Super Admin CRUD/credentials; audit retention.

---

## Y. PHASE 2C-4 IMPLEMENTATION RECORD — CATALOG ISOLATION

Phase 2C-4 status is COMPLETE: every authenticated company operation
on categories, products, variants, and product images enforces its
company boundary, proven by 18 dedicated tests within a 44-file /
390-test green suite. No schema migration was needed. Overall Phase 2
was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX) (Y.6).

### Y.1. Route classification (verified by inspection)

* Public (no `authenticate`, untouched, still global): health, auth
  session endpoints, `GET /categories[/:id]`, `GET /products[/:id]`,
  `GET /products/:id/images[/:imageId]`,
  `GET /reviews/product/:productId`, `GET /announcements/current`,
  static media. No default company is invented for these; domain
  resolution stays a later phase.
* Authenticated company operations (scoped in this phase): all
  category/product/variant/media writes plus the ADMIN-gated
  inactive/all reads (context arrives via the mounted boundary and
  the conditional-gate thread).
* Platform: no SUPER_ADMIN catalog routes exist; `authorize("ADMIN")`
  keeps rejecting platform callers (proven 403).

### Y.2. Predicates added (repository boundary)

* Reads take an optional `companyId` (null = unscoped public path,
  byte-identical queries to before): category/product list/detail,
  variant lookup, media product gate. These list/detail queries contain
  no OR search conditions (verified), so the top-level AND predicate
  cannot be escaped by filter logic.
* Writes require non-null company (fail closed): category
  update/deactivate/image upload/remove (scoped pre-reads; parent
  grafting already company-checked); product update/deactivate (scoped
  pre-reads — cross-company delete 404s before the name-bearing 409);
  guarded deactivation verifies company inside its transaction;
  variant create gated on the parent product's company then inherits
  it; variant update/deactivate scoped by denormalized company;
  media writes gate product then variant pair.
* Controllers pass `req.companyContext.companyId`; `companyId` is not
  updatable anywhere (variant `productId` rejected by strict schemas);
  review/coupon joins in product reads verified absent (no leak
  surface); lifecycle/deletion semantics and file/storage behavior
  unchanged.

### Y.3. Relationship checks tested

A-product+B-category create/update, A-product+B-variant pairings both
directions, variant creation inheritance + B-product rejection,
productId-in-body immovability (422, row unchanged), image upload/
update/delete against B products (product gate fires first — equally
opaque 404), body override 422 with query/header ignored (row lands in
the creator's company).

### Y.4. Verification

* New `tests/integration/catalog-isolation.test.js`: 18/18 (dedicated
  companies A/B/S, API-created stamped catalog, images cleaned via
  API, catalog deactivated). One self-caught expectation fixed
  (product-gate-first code, documented in-test).
* Full suite: 44 files, 372 pre-existing + 18 new = 390/390. Cart,
  checkout, inventory, order, return, dashboard, and primary-image
  suites pass unmodified — downstream consumers already operate on
  tenant-clean catalog.
* No migration (verified: `prisma/migrations` diff empty), no reset/
  `db push`/upgrade/commit/push. Changed: category/product/media
  repository+service+controller layers only.

### Y.5. Deferred tenant work

Coupon/review/wishlist/cart-display/marketing/notification scoping;
composite uniques + `NOT NULL` tightening; CompanyDomain runtime +
public catalog scoping; media prefixes; suspension enforcement; RBAC
wiring; Super Admin CRUD/credentials; audit retention.

---

## Z. PHASE 2C-5 IMPLEMENTATION RECORD — CUSTOMER-OWNED ISOLATION

Phase 2C-5 status is COMPLETE: ADMIN customer management and wishlist
adds enforce the company boundary, and every caller-scoped resource
was verified structurally incapable of cross-company access — proven
by 18 dedicated tests within a 45-file / 408-test green suite. No
schema migration was needed. Overall Phase 2 was NOT STARTED at this
point, pending the remaining slices (now COMPLETE — see phase table and §AX) (Z.6).

### Z.1. Classification (verified by inspection)

* Caller-scoped by construction (owner key is always `req.user.id`;
  no cross-user targeting exists): profile read/update, addresses
  (all reads/writes pair `(id, userId)`), cart (2C-1), notifications
  (all reads/writes pair `(id, userId)`), wishlist reads/removal
  (wishlist header resolved from caller). No code change required or
  made; isolation follows from ownership with zero company logic.
* Company-gated in this phase: ADMIN user list/detail/ban
  (`users.service` + repository) and wishlist product adds.
* Duplicate email across companies is NOT yet possible:
  `User.email` stays globally unique until the composite-unique phase.
  Registration maps the conflict to the pre-existing 409 (locked by
  test); no new global assumption was introduced.

### Z.2. Predicates added (repository boundary)

* `findUsersAdmin`: `{ companyId }` leads the AND chain, so the
  search OR-conditions (nested in one AND member) cannot escape it;
  new `findUserByIdAndCompany` backs admin detail; ban/deactivate
  pre-reads scoped first (no reassignment API exists, so the check
  cannot race the write). Foreign users read as missing (existing
  404s).
* Wishlist add selects the product's `companyId` (never serialized)
  and requires equality, else the same 404 as unknown ids.
* Services take server `companyId` with the shared fail-closed guard;
  controllers pass `req.companyContext.companyId`. Strict schemas
  keep rejecting body `companyId`/`userId` (422); address routes accept
  no userId field at all.

### Z.3. Attacks tested

New `tests/integration/customer-resources-isolation.test.js`
(dedicated companies A/B/S): own profile/address/cart/wishlist/
inbox use; cross reads/mutations/deletes/defaults → existing 404
codes with state verified intact; wishlist B-product and unknown
product → identical 404s; ADMIN list exact to company (3 users),
search blind to B, B detail/ban → 404 with user untouched, own
ban/restore round-trip; HEAD still 403 on user management;
override channels impotent; SUPER_ADMIN → 403 without access;
SUSPENDED customer unblocked; duplicate-email 409 locked.

### Z.4. Verification

* New file 18/18; full suite 45 files, 390 pre-existing + 18 new =
  408/408. One legitimate fixture migrated (Google inactive-account
  user stamped — its admin deactivation is now company-scoped);
  nothing else weakened. Cart/checkout/order/inventory/catalog suites
  pass unmodified.
* No migration (verified: `prisma/migrations` diff empty), no reset/
  `db push`/upgrade/commit/push. Changed: users + wishlist
  repository/service/controller layers only.

### Z.5. Clarified contract

SUPER_ADMIN on customer order routes receives the guard's 403
(`AUTH_COMPANY_REQUIRED`) rather than a 404 — identical for every
id, hence equally leak-free, and distinct from `authorize`'s 403 on
admin routes. Both are pre-existing codes.

### Z.6. Deferred tenant work

Coupon/review/marketing/notification-broadcast/cart-display scoping;
composite uniques (incl. cross-company duplicate email) + `NOT NULL`
tightening; CompanyDomain runtime + CUSTOMER/Google assignment +
public catalog scoping; media prefixes; suspension enforcement; RBAC
wiring; Super Admin CRUD/credentials; audit retention.

---

## AA. PHASE 2C-6 IMPLEMENTATION RECORD — REVIEW + COUPON ISOLATION

Phase 2C-6 status is COMPLETE: reviews isolate through product/user
ownership and coupons through a new direct company column, proven by
14 dedicated tests within a 46-file / 422-test green suite. Overall
Phase 2 was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX) (AA.6).

### AA.1. Ownership models (schema decision recorded)

* Reviews: NO new column. Two authoritative paths already exist —
  `Review.userId → User.companyId` (caller-owned reads/mutations) and
  `Review.productId → Product.companyId` (admin list, creation
  eligibility) — jointly sufficient, so a redundant column was
  refused.
* Coupons: new `Coupon.companyId` (nullable `CHAR(36)`, FK Restrict,
  index) was GENUINELY REQUIRED: unrestricted coupons (no product
  links) have no derivable company, and the checkout transaction must
  compare a stored company value in-commit — derivation cannot supply
  either. Migration `20261002122349_phase2c6_coupon_company` adds the
  column, backfills all pre-existing rows to Company #1, then adds
  index + FK. `NOT NULL` tightening deferred with composites.
* CouponHistory: no column (FK-free by design); reads are gated by the
  scoped coupon lookup, so history follows its coupon. CouponUsage:
  no new column; rows exist only for committed checkouts and are
  keyed by gated coupon/user/order — creation is refused upstream.

### AA.2. Predicates added (repository boundary)

* Reviews: creation gates the order item through
  `order.user → companyId` AND verifies the purchased product's
  company explicitly (legacy mixed orders fail closed); admin list
  leads with `product.companyId` (search OR nested, unescapable);
  caller-owned reads/mutations and product-keyed public reads
  unchanged by design (no mixing structurally possible).
* Coupons: id-addressed reads scoped (`findCouponById` now filtered);
  global code lookup stays global (codes remain globally unique) with
  a company-match check on redemption paths (unknown-id-identical
  404); admin list leads with `companyId`; creation stamps creator
  company; product restrictions verified same-company;
  update/delete/history pre-read scoped (company immutable → no
  race); checkout re-reads the coupon row INSIDE the order
  transaction and aborts like-missing on mismatch (no quote-to-
  consume TOCTOU).
* Services take server `companyId` with the shared fail-closed guard;
  controllers pass `req.companyContext.companyId`. Strict schemas
  keep rejecting body tenant fields; lifecycle/deletion/usage rules
  and audit actions byte-identical.

### AA.3. Attacks tested

New `tests/integration/review-coupon-isolation.test.js` (dedicated
companies A/B/S, API-created stamped data): admin review list exact;
no admin mutation endpoint to abuse (404, row intact); cross review
mutate/create → 404s; public reviews never mix; admin coupon list
exact with B detail/mutate/deactivate/delete → 404s and intact row;
B-product restriction rejected; B-code validate/checkout → 404 with
zero order and zero usage rows; one-time usage preserved; history
follows its coupon; company-less callers → 403 on mounted routes;
SUPER_ADMIN → 403s; override channels impotent; suspended admin
creates stamped coupons.

### AA.4. Verification

* New file 14/14; full suite 46 files, 408 pre-existing + 14 new =
  422/422. Cart/checkout/order/inventory/catalog/auth suites pass
  unmodified. No assertions weakened.
* One additive migration (above); history preserved; no reset/
  `db push`/upgrade/commit/push. Changed: review + coupon + order-tx
  repository/service/controller layers and the schema.

### AA.5. Clarified contract

`assertUniqueCode` stays global (composite codes are a later phase);
coupon `code` uniqueness therefore still spans companies while all
reads/redemptions are company-gated — recorded so the composite
phase knows exactly what tightens.

### AA.6. Deferred tenant work

Marketing/notification-broadcast/cart-display scoping; composite
uniques (codes, emails, slugs, SKUs) + `NOT NULL` tightening;
CompanyDomain runtime + CUSTOMER/Google assignment + public catalog
scoping; media prefixes; suspension enforcement; RBAC wiring; Super
Admin CRUD/credentials; audit retention.

---

## AB. PHASE 2C-7 IMPLEMENTATION RECORD — NOTIFICATIONS + BROADCASTS

Phase 2C-7 status is COMPLETE: customer notifications verified
caller-owned, marketing and announcement management company-scoped
through new direct columns, proven by 11 dedicated tests within a
47-file / 433-test green suite. Overall Phase 2 was NOT STARTED at this
point, pending the remaining slices (now COMPLETE — see phase table and §AX) (AB.6).

### AB.1. Classification (verified by inspection)

* Customer notifications (`Notification.userId → User`, Cascade):
  every read/mutation pairs `(id, userId)` with the caller as the only
  key, and every creation site (order checkout/status transactions,
  return creation) writes the gated order's owner — tenant-correct by
  construction, no code change, no column (owner = caller always).
* Marketing broadcasts: NO derivable company (never fanned out to
  per-user rows; `createdBy` is an FK-less nullable string, not an
  authoritative relation) → direct `companyId` required.
* Announcements: same — direct `companyId` required for ADMIN
  management. The public `/current` read is the exception (AB.4).
* No recipient/audience/read-state tables exist anywhere (verified by
  schema + code search) — N/A by design, not omitted.

### AB.2. Predicates added (repository boundary)

* Marketing: admin list/detail scoped; creation stamps creator
  company; update/delete pre-read scoped (company immutable → no
  race); viewer `/active` list scoped to the viewer's company;
  CATEGORY/PRODUCT/COUPON link targets validated same-company (SHOP
  and null need none), else the pre-existing 404s.
* Announcements: admin list/detail/create/update/delete scoped the
  same way; lifecycle and hard-delete semantics byte-identical.
* Services take server `companyId` with the shared fail-closed guard;
  controllers pass `req.companyContext.companyId`. Strict schemas
  keep rejecting body tenant fields.

### AB.3. Public `/current` limitation (documented, not patched)

The endpoint is unauthenticated with no trustworthy company signal,
so it still resolves the single global current row. Any company
filter there would require client-controlled selection — explicitly
rejected. Correct per-storefront resolution is assigned to the
CompanyDomain runtime phase; ADMIN management of the underlying rows
is already isolated.

### AB.4. Verification

* New `tests/integration/notification-broadcast-isolation.test.js`:
  11/11 (inbox separation, cross mark-read/delete → 404s intact,
  creation attribution, admin exactness, cross detail/mutate/
  deactivate/delete → 404s intact, link-target rejection, viewer
  scoping, HEAD/SUPER_ADMIN 403s, override impotence, suspension
  non-blocking, public shape preserved).
* Full suite: 47 files, 422 pre-existing + 11 new = 433/433. Order,
  notification, coupon-history, and marketing/announcement suites
  pass unmodified.
* One additive migration
  (`20261002124125_phase2c7_broadcast_company`: two nullable columns
  + Co1 backfill + indexes + FKs); history preserved; no reset/
  `db push`/upgrade/commit/push. Changed: marketing/announcement
  repository/service/controller layers and the schema.

### AB.5. Deferred tenant work

Composite uniques + `NOT NULL` tightening; CompanyDomain runtime
(unlocks public `/current` scoping + CUSTOMER/Google assignment +
public catalog); media prefixes; suspension enforcement; RBAC wiring;
Super Admin CRUD/credentials; audit retention.

---

## AC. PHASE 2C-8 IMPLEMENTATION RECORD — CART-DISPLAY ISOLATION

Phase 2C-8 status is COMPLETE: the one genuine gap found — cart reads
rendering unvalidated lines — now fails closed, and the rest of the
display surface was proven safe by inspection plus test, within a
48-file / 444-test green suite. No schema migration was needed.
Overall Phase 2 was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX)
(AC.6).

### AC.1. Surface audit (verified by inspection)

* Endpoints: get/add/update/remove only — no clear/count/summary/
  preview/reprice/merge endpoints exist. All mounted with
  authenticate → companyContext.
* Reads resolve the header by `userId` and embed variant + product +
  images + inventory; the serializer emits only names/slugs/prices/
  `inStock` boolean/display-image — no category object, no raw
  quantities, no coupon/discount fields, no `companyId`, no seller
  metadata. Cart persists no coupon state (validate → quote →
  checkout applies); update takes quantity only (variant
  reassignment impossible by strict schema).
* Mutations were already gated in 2C-1; checkout re-validates in-tx.

### AC.2. The gap and the fix

Mutation and checkout gates run at write time, but READS rendered
whatever lines existed: a contaminated line (pre-enforcement legacy,
direct writes, null-company catalog) displayed foreign product,
variant, image, price, and stock data before checkout refused it.
`readSafeCart` (covering get/add/update/remove responses) now
verifies every line's variant AND product company against the
reader's company and fails the whole read with the same 404 as
unknown ids — fail closed, never mixed data, nothing repaired.
The coupon quote path (which reads carts directly) received the
identical gate so foreign prices cannot leak through eligible
totals. Missing company fails closed (platform contexts have no
cart operations).

### AC.3. Attacks tested

New `tests/integration/cart-display-isolation.test.js` (dedicated
companies A/B/S): ownership read/mutate/remove incl. positive
controls; query/header override ignored; cross-variant add identical
to unknown-id 404; update-retarget rejected by schema with row
intact; planted foreign and null-company lines → read 404s then
clean recovery; response contains only own identifiers with no
`companyId`/`reservedQuantity`/coupon/discount/category keys and a
boolean `inStock`; subtotal math, stock validation, and coupon
quotes intact; SUPER_ADMIN → 403; suspended reads → 200.

### AC.4. Verification

* New file 11/11; full suite 48 files, 433 pre-existing + 11 new =
  444/444. Cart/checkout/coupon/order/inventory suites pass
  unmodified.
* No migration (verified: `prisma/migrations` diff empty), no reset/
  `db push`/upgrade/commit/push. Changed: cart
  repository/service/controller, coupon quote gate, new test file.

### AC.5. Legacy-data finding

Null-company catalog rows (e.g. future seed runs, which still stamp
nothing) fail closed on cart reads by design. Seed stamping remains
the documented gap; no data repair is performed — contaminated lines
surface as 404s until removed.

### AC.6. Deferred tenant work

Composite uniques + `NOT NULL` tightening (incl. seed stamping);
CompanyDomain runtime + CUSTOMER/Google assignment + public catalog
scoping; suspension enforcement; RBAC wiring; Super Admin
CRUD/credentials; audit retention.

---

## AD. PHASE 2C-9 IMPLEMENTATION RECORD — MEDIA STORAGE ISOLATION

Phase 2C-9 status is COMPLETE: new product/category uploads land in
server-derived company subtrees while the 91 legacy rows and their
bytes keep serving untouched, proven by 11 dedicated tests within a
50-file / 455-test green suite. No schema migration was needed.
Overall Phase 2 was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX)
(AD.6).

### AD.1. Ownership model (no schema change)

`ProductImage → Product.companyId` (2C-4 gates) is sufficient — no
`companyId` column was added to images. Filenames were already
server-generated UUIDs (no client path input); the traversal guard in
the storage adapter is unchanged and covered by unit test.

### AD.2. Storage design

* New product uploads: `companies/<companyId>/products/<productId>/`
  (both segments from the authoritative product row, never the
  request); new category uploads mirror it. Unstamped legacy products
  keep the historical layout (backward-compatible fallback, never a
  failure).
* `express.static` serves the whole root unchanged — both layouts
  resolve with zero middleware change; reads stay unauthenticated;
  no suspension gate at this layer. Deletion keeps deriving paths
  from authoritative DB rows (verified safe for both layouts).
* Responses carry the relative `storagePath` only (no `companyId`
  serialized); legacy URLs are byte-identical.

### AD.3. Attacks and compat tested

New suites (`media-storage-isolation` integration + `media-storage`
adapter unit): disjoint A/B subtrees with files on disk; cross
upload/promote/delete → 404s with foreign files and primary flags
intact; delete removes its file; category prefix parity; legacy
row+file publicly readable and listed; prefixed files publicly
served; SUPER_ADMIN → 403; suspended admin unblocked; traversal
outside the root rejected; missing-file removal returns false.

### AD.4. Verification

* New files 11/11; full suite 50 files, 444 pre-existing + 11 new =
  455/455. Catalog/cart/media suites pass unmodified.
* No migration (verified: `prisma/migrations` diff empty), no reset/
  `db push`/upgrade/commit/push. Changed: media + category upload
  path construction only.

### AD.5. Product lifecycle cleanup (verified unchanged)

Deactivation is soft (rows and files retained); no hard-delete path
orphans files; per-image delete removes row + file with warn-only
file-failure semantics — all preserved exactly.

### AD.6. Deferred tenant work

Company deletion with subtree reclamation (prefixes now make this a
directory delete); CompanyDomain runtime + CUSTOMER/Google assignment
+ public catalog scoping; suspension enforcement; RBAC wiring; Super
Admin CRUD/credentials; audit retention.

---

## AE. PHASE 2C-10 IMPLEMENTATION RECORD — TENANT HARDENING

Phase 2C-10 status is COMPLETE: composites are per-company where the
business requires it, company-owned rows require their company at the
database level, and the seed stamps Company #1 — proven by 13
dedicated tests within a 51-file / 468-test green suite. Overall
Phase 2 was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX) (AE.6).

### AE.1. Unique-constraint audit (classification enforced)

* Company-scoped (converted): `Category[companyId,slug]`,
  `Product[companyId,slug]`, `ProductVariant[companyId,sku]` — slugs
  are display identifiers (all lookups are by id; verified no
  slug-based route lookups), SKUs are merchant-local. Same value
  reused across companies accepted; duplicates within rejected with
  the pre-existing 409 codes.
* Intentionally global (kept): `User.email` (login/register/Google
  resolve identities by email alone — disambiguation needs the
  deferred domain context; composite now would break login),
  `ProductVariant.barcode` (manufacturer-global namespace),
  `Coupon.code` (reaffirmed; redemption gating is company-scoped),
  `Order.orderNumber` (P.2), `CompanyDomain.domain` (one domain
  resolves to one company), `Role.name`, `Company.adminUserId`,
  structural uniques (cart/wishlist/order-item keys, usage pairs).
* Data audit before migration: zero same-company duplicates for every
  candidate, zero cross-company collisions, no slug-based public
  lookups to go ambiguous.

### AE.2. NOT NULL audit (tightened vs deferred)

* Tightened (all rows populated, every writer stamps): Category,
  Product, ProductVariant, Coupon, MarketingNotification,
  SiteAnnouncement. A pre-migration read-only audit found 777 orphan
  NULLs (190/244/343 across catalog — seed runs and pre-stamping
  fixtures); all were deterministically backfilled to Company #1
  (dedicated-company fixtures always stamp explicitly), zero
  remaining, then constrained.
* Deferred nullable: `User.companyId` (434 NULLs — SUPER_ADMIN has no
  company by design; CUSTOMER/Google assignment awaits CompanyDomain
  runtime; tightening now would break registration and login).
* `Company.adminUserId` stays nullable for the documented bootstrap
  window.

### AE.3. Migration

`20261002133116_phase2c10_tenant_hardening` (single, additive):
idempotent `IS NULL` backfills, FK drop/re-add around the
nullability change, old global uniques dropped, three composite
uniques added — DDL generated by Prisma (`migrate diff` + `deploy`;
`migrate dev --create-only` is non-interactive-blocked in Prisma 7
for constraint-dropping diffs). History preserved; 12 migrations
applied, schema in sync; no reset/`db push`/upgrade.

### AE.4. Seed, fixtures, compatibility

* `prisma/seed.js`: ensures Company #1 by fixed UUID (never
  recreated), upserts by composite keys, stamps on create AND update
  (repairs pre-stamping NULLs on re-run); verified by an in-suite
  seed execution asserting zero NULLs and intact Co1 ownership.
* Application compatibility: no service changes were needed (all
  writers already stamp; guards already fail closed); `toSafe*`
  mappers never serialized `companyId`. Two test-only adjustments:
  null-variant construction is now impossible (replaced with a
  database-rejection proof) and one slug lookup uses `findFirst`.
* Marketing repository passthrough fixed (it dropped the stamped
  `companyId`; announcements already passed it through).
* Auth behavior byte-identical (login shape/cookies/rotation/Google
  untouched; full auth suites pass). Duplicate customer email remains
  globally rejected (409 locked by test) pending the auth redesign
  that domain resolution unlocks.

### AE.5. Verification

* New `tests/integration/tenant-hardening.test.js`: 13/13 (DB-level
  NOT NULL rejections, creator stamping, cross-company reuse
  accepted, same-company dups 409, barcode/code/email/domain global
  rejections, login shape, seed run).
* Full suite: 51 files, 455 pre-existing + 13 new = 468/468.
* No commit/push; temp shadow database created for the diff and
  dropped afterwards; no production data deleted or merged.

### AE.6. Deferred tenant work

Cross-company duplicate email (needs login disambiguation via
domain context); CUSTOMER/Google assignment + public catalog
scoping; company deletion with subtree reclamation; media prefixes
done; suspension enforcement; RBAC wiring; Super Admin
CRUD/credentials; audit retention.

---

## AF. PHASE 2C-11 IMPLEMENTATION RECORD — DOMAIN RUNTIME RESOLUTION

Phase 2C-11 status is COMPLETE: hostnames resolve to companies
through the registered `CompanyDomain` table with a public request
context, and self-registration inherits the resolved company —
proven by 22 dedicated tests within a 53-file / 490-test green
suite. No schema migration was needed. Overall Phase 2 stays NOT
STARTED pending the remaining slices (AF.6).

### AF.1. Flow and trust

`Host` header → `normalizeHostname` (lowercase, single trailing dot
stripped, numeric `:port` stripped for local dev, bracketed IPv6
accepted; URLs/paths/credentials/whitespace/multi-colon strings,
malformed labels, and UUID lookalikes rejected) →
`CompanyDomain.domain` exact match with `isActive` →
`{ companyId, company: { id, name, status }, source: "domain" }` on
`req.companyContext`. Only `Host` is read: the app has no
trusted-proxy configuration, so `X-Forwarded-Host` is deliberately
ignored — production must forward the real Host at the reverse
proxy (deployment requirement, not app code). No third-party
dependency added.

### AF.2. Context model

The context gained an internal `source` discriminator (`identity` /
`domain` / `platform`; never serialized by the module). Identity
resolution overwrites unconditionally while the public resolver
never overwrites an attached context — so authenticated users keep
their database company on any hostname and SUPER_ADMIN stays
platform. Unknown/inactive/malformed hosts attach nothing and pass
through (no oracle, localhost/dev preserved). Suspension status is
exposed, never enforced.

### AF.3. Mounted routes (additive, behavior-preserving)

Public data reads (categories/products GETs, product reviews,
current announcement, product media reads) and the register/Google
entry points. Public queries are NOT re-scoped in this phase; the
context is available for later scoping and is consumed now only by
registration. Login/refresh/logout flows untouched.

### AF.4. Registration and Google status

* CURRENT: `register` stamps the domain-resolved company (or null
  on unregistered hosts — legacy behavior preserved); body
  `companyId` is stripped by the non-strict schema and can never
  select a tenant; global email uniqueness and login semantics
  unchanged (duplicate emails still 409).
* Google assigns the same way through the shared repository path,
  but live assignment is unverifiable here (`GOOGLE_CLIENT_ID`
  unconfigured → 503 before creation) — full Google verification
  with a configured client remains deferred alongside the
  login-disambiguation redesign.

### AF.5. Verification

* New unit suite (11: normalization matrix, public decision) and
  integration suite (11: live resolution incl. multi-domain,
  case/port handling, inactive/unknown passthrough, precedence,
  suspension exposure, registration assignment + legacy + smuggle
  rejection + duplicate-409 + login, storefront passthrough).
* Full suite: 53 files, 468 pre-existing + 22 new = 490/490. Three
  pre-existing `toEqual` context assertions extended with `source`
  (kept exact, not weakened).
* No migration (verified: `prisma/migrations` diff empty), no reset/
  `db push`/upgrade/commit/push. Changed: companies repository
  (new), companyContext, auth repository/service/controller/routes,
  five public route files, new tests.

### AF.6. Deferred tenant work

Login disambiguation for duplicate emails (needs domain-aware auth
redesign); live Google verification with configured client;
suspension enforcement; RBAC wiring; Super Admin CRUD/credentials;
audit retention.

---

## AG. PHASE 2C-12 IMPLEMENTATION RECORD — STOREFRONT ISOLATION

Phase 2C-12 status is COMPLETE: public catalog, media, review, and
announcement reads resolve their company from `Host` and fail closed
without one, proven by 11 dedicated tests within a 54-file /
501-test green suite. No schema migration was needed. Overall Phase 2
was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX) (AG.6).

### AG.1. Scoped endpoints and predicates

Categories/products list/detail (status scopes preserved — no search
ORs exist in these queries, so the top-level AND predicate cannot be
escaped), product media reads (product gate), product reviews
(product gate first), current announcement (company predicate added
to the active/in-window selection). Nested variants/images/category
briefs follow their gated root. Unknown hosts fail closed with the
resource's existing 404 (`PRODUCT/CATEGORY_NOT_FOUND`,
`ANNOUNCEMENT_NOT_FOUND`); companies without a qualifying
announcement keep the legacy 200-null shape.

### AG.2. Precedence and trust

Public resolvers attach first; authenticated identity overwrites
(`requireAdminForInactiveScope` chain) — ADMIN writes on a foreign
Host still land in the admin's own company while public reads follow
the Host. SUPER_ADMIN sees public data like anyone (no operational
gain). `X-Forwarded-Host` remains untrusted (no proxy config);
localhost/127.0.0.1 are registered to Company #1 as documented
dev/test bootstrap (production Host values never collide with them).

### AG.3. Verification

* New `tests/integration/storefront-isolation.test.js`: 11/11
  (per-host lists, cross-company 404s without field leakage,
  nested-data purity, media/review gating, per-host announcements,
  unknown-host 404s, identity-over-Host precedence, SUPER_ADMIN
  public parity, suspended non-blocking).
* Six pre-existing suites updated to the new contract (dedicated
  domains or explicit unregistered hosts; assertions intact):
  catalog/media/review-coupon/user-provisioning/domain-resolution.
* Full suite: 54 files, 490 pre-existing + 11 new = 501/501.
* No migration (verified: `prisma/migrations` diff empty), no reset/
  `db push`/upgrade/commit/push. Changed: six service files, four
  controllers, one repository predicate, localhost bootstrap rows.

### AG.4. Media/static limitation (unchanged)

Raw `express.static` file serving carries no company context by
design — the boundary is DB-backed discovery (which product/image
rows and metadata each host may resolve). Direct file URLs remain
unguessable random UUIDs under both layouts.

### AG.5. Suspension explicitly not enforced

Suspended hosts resolve and serve exactly like active ones; no 403
was added anywhere in this phase.

### AG.6. Deferred tenant work

* Login disambiguation for duplicate emails; live Google verification;
  RBAC wiring; Super Admin CRUD/credentials (incl. suspend/restore
  endpoints); audit retention; company deletion with subtree
  reclamation.

### AG.7. Local-development bootstrap (operator procedure)

§AG.2 records the intent that `localhost`/`127.0.0.1` resolve to
Company #1 for development, and §R.5 records that no `CompanyDomain`
row was seeded for it. Operational consequence, verified against
current databases: with no `localhost` domain row, public storefront
reads fail closed (`404 PRODUCT_NOT_FOUND` / `CATEGORY_NOT_FOUND`)
and customer registration stamps no company, so authenticated
customer operations cannot establish company context. The fix is
data, not code: register `localhost` for the ACTIVE `Tech Pulse`
company. No company creation, user creation, seed operation,
migration, or database reset is required — or permitted — for this
local setup.

1. Sign in to the admin frontend at `http://localhost:3001` with the
   operator's existing SUPER_ADMIN credential. Credentials are
   intentionally never stored or documented in this repository — the
   credential comes from the operator's secure source outside the repo.
2. In the admin UI open Companies → the `Tech Pulse` company → Domains
   and register `localhost` — or call the equivalent API as that
   SUPER_ADMIN: `POST /api/v1/companies/:id/domains` with body
   `{ "domain": "localhost" }`. Use the company id shown by the
   authenticated Companies list/detail response; it is not embedded
   here.
3. Host normalization is port-insensitive (`localhost:3000`,
   `localhost:5173`, and `localhost:3001` all resolve as `localhost`),
   so this single domain row covers the local API and both frontends.

Expected result: public `GET /api/v1/products` and
`GET /api/v1/categories` resolve to Tech Pulse; customer registration
becomes company-scoped; `GET /auth/me`, cart, checkout, orders, and
other authenticated customer operations resolve company context
normally.

This is distinct from a development-only SUPER_ADMIN bootstrap
mechanism, which does NOT exist: there is no seed script, setup
endpoint, or documented default credential that creates a first
SUPER_ADMIN. That remains an explicit open decision, not an
implemented capability.

---

## AH. PHASE 2C-13 IMPLEMENTATION RECORD — SUSPENSION ENFORCEMENT

Phase 2C-13 status is COMPLETE: one centralized guard plus session
gates refuse suspended-company operation everywhere, proven by 15
dedicated tests within a 55-file / 516-test green suite. Suspension
deletes and mutates nothing. Overall Phase 2 was NOT STARTED at this
point, pending the remaining slices (now COMPLETE — see phase table and §AX) (AH.6).

### AH.1. Centralized enforcement point

New `requireActiveCompany` (`src/middleware/companyContext.js`) —
the ONLY suspension check in the request path. Mounted immediately
after every company resolver (all authenticated chains, the
conditional admin gate, public storefront reads, register/Google
entries), before `authorize`/controllers. Semantics: no context →
pass through (other layers decide); platform → pass through;
`SUSPENDED` → 403 `COMPANY_SUSPENDED` (new neutral code, no
identifiers); anything else → pass through. No service duplicates
it. Ordering is uniformly
authenticate → companyContext → requireActiveCompany → authorize.

### AH.2. Authenticated, public, and session behavior

* All company roles (ADMIN/HEAD/MEMBER/CUSTOMER) are refused on
  every mounted route; Host/query/body/header tricks cannot bypass
  (identity governs, guard runs regardless).
* Suspended public domains refuse storefront reads; ACTIVE domains
  unchanged; unknown hosts still 404 (never 403 — no oracle).
* Login, refresh, and Google sign-in re-check the live company row
  (`USER_WITH_ROLES` now selects company status; payloads and JWT
  untouched), so pre-suspension tokens cannot renew: suspended →
  403, invalid/expired → existing 401s, ACTIVE/NULL-company/
  platform sessions unchanged. Registration on suspended domains
  creates nothing.
* SUPER_ADMIN passes every guard (platform) with `authorize`
  semantics byte-identical; anonymous logout unaffected.

### AH.3. Static media residual (unchanged, documented)

Raw `express.static` still serves bytes with no middleware — DB
discovery (which rows each host resolves) is blocked, direct file
URLs are not. No filesystem auth layer was invented.

### AH.4. Verification

* New `tests/integration/suspension-enforcement.test.js`: 15/15
  (per-role refusal, pre-work guards, bypass attempts, public
  matrix, unknown-host 404s, login/refresh/register gates,
  platform preservation, data-intactness asserts).
* Eight pre-existing suites updated from non-enforcement to the
  enforced contract (assertions strengthened to 403, never
  weakened); resolver-only tests (decide/middleware-level) needed
  no changes — resolution itself is untouched.
* Full suite: 55 files, 501 pre-existing + 15 new = 516/516.
* No migration (verified: `prisma/migrations` diff empty), no reset/
  `db push`/upgrade/commit/push. Changed: companyContext (guard),
  19 route files + conditional gate (mounting only), auth
  repository projection + login/refresh/Google gates.

### AH.5. Clarified contract

One code for every suspended refusal: 403 `COMPANY_SUSPENDED`
("Company operations are unavailable while the company is
suspended"), except pre-existing 401s which still fire first on
invalid credentials/tokens. Unknown-host behavior is unchanged.

### AH.6. Deferred tenant work

Suspend/restore/delete company APIs and UI; login disambiguation
for duplicate emails; live Google verification; RBAC wiring; Super
Admin CRUD/credentials; audit retention.

---

## AI. PHASE 2C-14 IMPLEMENTATION RECORD — AUDIT LOG FOUNDATION

Phase 2C-14 status is COMPLETE: the append-only audit model, a
validated writer with transaction support, role/company visibility
queries, and two instrumented user-management paths are implemented
and proven by 14 dedicated tests within a 56-file / 530-test green
suite. Overall Phase 2 was NOT STARTED at this point, pending the
remaining slices (now COMPLETE — see phase table and §AX) (AI.6).

### AI.1. Pre-existing infrastructure (preserved, not replaced)

No general audit log existed. Domain histories
(`OrderStatusHistory`, `CouponHistory` with FK-free `actorId` +
email snapshots, `ReturnRequestHistory`, inventory ledger) stay
intact — the new log is cross-cutting and never an authorization
source. Pino remains ops-only logging. The FK-free nullable-actor
convention and the coupon-history action vocabulary
(CREATED/UPDATED/DEACTIVATED/REACTIVATED/DELETED) were reused.

### AI.2. Schema and migration

`AuditLog` (`audit_logs`): UUID id; nullable `actorId` (system/
platform events) with NO user FK (survives deletion, history
convention); `actorRole` snapshot (fixed roles; `SYSTEM` marker
allowed only with null actor); `actorEmail` snapshot; nullable
`companyId` (null = platform event; FK Cascade so future company
purge removes its logs while platform rows follow retention);
`action`/`resource`/`resourceId`/`outcome`; `details` JSON;
`createdAt`. Indexes on `(companyId, createdAt)`,
`(actorId, createdAt)`, `(resource, resourceId, createdAt)` —
nothing more. Migration
`20261002150105_phase2c14_audit_log` (single table + FK, no data
touch); 13 migrations applied, schema in sync; no reset/`db push`/
upgrade.

### AI.3. Writer, validation, and transactions

`audit.repository.createAuditEvent(data, tx?)` accepts a transaction
client (in-commit writes) or defaults to shared Prisma; no update
or delete path exists anywhere (structurally append-only).
`audit.service.recordAuditEvent` validates role (matrix reuse, no
second matrix), action/resource/outcome vocabularies, UUID shapes,
and runs a recursive secret scan that REJECTS password/token/cookie/
OTP/JWT-bearing metadata (proven, incl. benign-lookalike
acceptance). Login events deliberately deferred (auth
timing/rate-limit sensitivity); failed mutations write nothing.

### AI.4. Instrumented paths (representative, not exhaustive)

* `provisionCompanyAdmin`: audit payload validated pre-tx, written
  INSIDE the provisioning transaction — rollback proven (duplicate
  provision leaves zero rows; mechanism proven with a forced tx
  failure).
* `setUserActiveAdmin` (ban/deactivate/reactivate): event recorded
  post-commit with the resolved actor snapshot (highest-ranked
  role) — the documented non-transactional pattern; controller
  threads the caller id.
* No HTTP audit endpoints; no client-submitted records possible.

### AI.5. Visibility groundwork (no UI)

`listAuditLogs` derives everything from server identity: MEMBER
own-only, HEAD own+MEMBER (same company), ADMIN whole company,
SUPER_ADMIN everything with optional validated company/actor
filters, CUSTOMER/role-less denied, company-less employees fail
closed. Covered live with provisioned A/B users.

### AI.6. Deferred tenant work

Mutation-wide instrumentation; login/logout event integration;
retention policy setting + deletion worker (policy stays NEVER);
audit UI; manual deletion (never planned); suspend/restore/delete
company APIs; login disambiguation; RBAC wiring; Super Admin
CRUD/credentials.

---

## AJ. PHASE 2C-15 IMPLEMENTATION RECORD — SUPER ADMIN COMPANY PROVISIONING & LIFECYCLE

Phase 2C-15 status is COMPLETE: SUPER_ADMIN-only company
list/detail/creation/suspend/restore plus the exactly-one-ADMIN
provisioning endpoint, all transactionally audited, proven by 24
dedicated tests within a 57-file / 554-test green suite. No schema
migration was needed (the Phase 1 `Company`/`CompanyDomain` model
plus the 2C-14 `AuditLog` model already fit). Overall Phase 2 was
NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX) (AJ.7).

### AJ.1. Module and endpoints (existing architecture, no new convention)

New `src/modules/companies/` follows HTTP → Route → Controller →
Validation → Service → Repository → Prisma, mounted at
`/api/v1/companies` (`src/routes/index.js`). Chain on every route:
`authenticate → resolveCompanyContext → authorize("SUPER_ADMIN")`
— deliberately NO `requireActiveCompany`, so platform callers can
manage SUSPENDED companies (SUPER_ADMIN resolves platform context,
never a company).

* `GET /api/v1/companies` — paginated list (`page`/`limit`/`search`/
  `status`), management metadata only.
* `GET /api/v1/companies/:id` — detail: metadata plus structural
  aggregate counts (AJ.3).
* `POST /api/v1/companies` — creation (`{ name }` only; strict
  schema rejects `id`/`status`/`adminUserId`/`companyId` with 422).
* `POST /api/v1/companies/:id/suspend` — ACTIVE → SUSPENDED.
* `POST /api/v1/companies/:id/restore` — SUSPENDED → ACTIVE.
* `POST /api/v1/companies/:id/admin` — provisions the company's one
  ADMIN (AJ.4). Unknown ids 404 on every `:id` route.

### AJ.2. Creation behavior (verified)

Name trimmed, required non-empty, max 255 (Zod + service double
check); UUID generated server-side (database default — client `id`
rejected, never trusted); status always `ACTIVE` (client `status`
rejected); `adminUserId`/`companyId` rejected; `Company.name` stays
non-unique (duplicate names accepted, proven; Company #1 pinned
untouched). No tenant assignment is possible: creation takes no
company selector of any kind.

### AJ.3. List/detail visibility (aggregate-only, verified)

List rows carry exactly `id/name/status/adminProvisioned/domains/
createdAt/updatedAt` (exact-keys test); detail adds `aggregates`
with counts only: `totalUsers/totalCustomers/totalHeads/
totalMembers/totalProducts/totalOrders` (single `Promise.all`
read batch — no N+1, no operational rows). Orders count through
`user.companyId`; roles through the `UserRole` join. A Company #1
detail test (real seeded data) locks the exact key sets and asserts
no `passwordHash`/`password_hash`/`orderNumber`/`refreshToken`/
`orderItems`/`cartItems` material appears. `totalUsers` is an
extra platform convenience count, not an operational leak.

### AJ.4. ADMIN provisioning status — IMPLEMENTED (secure, not deferred)

`POST /:id/admin` delegates to the existing atomic
`users.service.provisionCompanyAdmin` → `provisionCompanyAdminTx`
(user create + ADMIN role link + `Company.adminUserId` set + USER
audit event, one transaction; Argon2id-hashed credentials, never
plaintext; `P2002` race mapped to 409 `COMPANY_ADMIN_EXISTS`).
Exactly-one invariant proven (second provision 409s, link intact,
user count unchanged); no credential material in audit details
(proven). Credential management beyond initial provisioning
(reset/change, forgot-password/OTP) stays deferred per scope —
nothing insecure was invented.

### AJ.5. Suspend/restore (verified)

Guarded `updateMany({ id, status: from })` transitions serialize
concurrent races; 404 when missing, deterministic 409s
(`COMPANY_ALREADY_SUSPENDED` / `COMPANY_ALREADY_ACTIVE`, incl.
restore of a never-suspended ACTIVE company). No deletion, no
ecommerce/credential mutation (user counts asserted identical);
suspension keeps working through the 2C-13 gate
(`Host → CompanyDomain → context → requireActiveCompany`):
suspend blocks ADMIN `GET /users/me` and Host-scoped storefront
reads with 403 `COMPANY_SUSPENDED`; restore reopens both (proven
live on a dedicated company with its own domain).

### AJ.6. Audit (verified)

Lifecycle events use the 2C-14 writer transactionally inside the
mutating transaction (rollback leaves no row): actor = live
SUPER_ADMIN snapshot (id/role/email), `companyId: NULL`
(platform-level), `resource: "COMPANY"`, `resourceId` = company
id, actions `CREATED`/`SUSPENDED`/`RESTORED`, outcome `SUCCESS`,
details `{ name }` on create only. No client-controlled records;
secret scan unchanged (passwords/tokens/JWT rejected).

### AJ.7. Recovery defects found and fixed in this session

The previous session left the implementation present but red
(9 failed / 7 passed): (1) `companies.service` rebuilt the
validated audit payload field-by-field and dropped `resource`,
so every creation/suspend/restore audit write failed Prisma
validation → 500s (fixed by passing the validated audit object
through); (2) the lifecycle test's denied-company ADMIN fixture
was never linked via `Company.adminUserId`, so platform-boundary
tests observed `AUTH_COMPANY_INCONSISTENT` instead of the
authorize gate's `AUTH_FORBIDDEN` (fixed by linking the fixture —
the resolution boundary itself is covered elsewhere, not
weakened). Coverage was then extended without touching
production code: full role × endpoint rejection matrix (ADMIN/
HEAD/MEMBER/CUSTOMER × all five endpoints), anonymous rejection
on reads and writes, query/header `companyId` trick impotence,
Company #1 aggregate-only detail lock, and restore-ACTIVE
conflict. Focused file: 24/24. Full suite: 57 files, 554/554.

### AJ.8. Deferred work (unchanged scope)

Permanent company deletion (requires the H safeguards); Super
Admin credential reset/change; forgot-password/OTP; audit
retention policy + worker + UI; login disambiguation for
duplicate emails; live Google verification with configured
client; RBAC wiring beyond the fixed hierarchy; billing/
subscriptions; mobile-app contract. `CompanyDomain` design
untouched; suspension gate untouched.

---

## AK. PHASE 2C-16 IMPLEMENTATION RECORD — ADMIN CREDENTIAL MANAGEMENT + PASSWORD RESET

Phase 2C-16 status is COMPLETE: SUPER_ADMIN rotates any company's
designated ADMIN password, and ADMIN/HEAD/MEMBER/CUSTOMER use an
email-OTP forgot-password flow plus an authenticated OTP change
flow — proven by 35 dedicated tests within a 61-file / 589-test
green suite. JWT claims, refresh architecture/rotation/concurrency,
login/register/logout/Google behavior, and all rate-limit budgets
are byte-identical except the intended additions below. Overall
Phase 2 was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX) (AK.9).

### AK.1. Discovery (nothing existed)

No OTP, Nodemailer, reset-token, or change-password code existed
anywhere (verified by search — only the audit secret-scan named
OTP). Refresh tokens are stateless JWTs (`{ sub, jti }`, 7d) with
rotation-on-every-refresh and same-cookie concurrency by design;
logout only clears the cookie. There was therefore NO server-side
session store to invalidate against — the design below uses the
refresh flow's existing live user lookup instead (AK.5).

### AK.2. Endpoints (all new, existing conventions)

Auth (`src/modules/auth`, Zod-strict, `AppError` codes):
* `POST /auth/forgot-password { email }` — always the same 200
  message; body `companyId` keeps the platform 422 contract,
  query/header ids are ignored.
* `POST /auth/verify-reset-otp { email, otp }` — 200
  `{ verified: true }`, else uniform 400 `AUTH_OTP_INVALID`.
* `POST /auth/reset-password { email, otp, newPassword }` —
  two-step completion (verified code re-supplied, no extra token
  type); 200 message, else uniform 400 (gated 403s below).
* `POST /auth/change-password/otp` and
  `POST /auth/change-password { otp, newPassword }` —
  `authenticate → companyContext → requireActiveCompany`; identity
  from `req.user.id` only (body `userId` → 422); success returns a
  fresh pair (login shape + refresh cookie).

Companies: `POST /companies/:id/admin/password { password }` —
SUPER_ADMIN-only (limiter after `authorize`); target is the route
company's `Company.adminUserId` ADMIN, consistency-checked
(`companyId` match + ADMIN role) else 409
`COMPANY_ADMIN_INCONSISTENT`; no-ADMIN → 404
`COMPANY_ADMIN_NOT_FOUND`. Password-only by design: identifier
(email) changes are deferred (AK.9). Responses are `toSafeUser`
shapes — never hashes or credential material.

### AK.3. OTP security properties (verified)

6 digits from `crypto.randomInt`; Argon2id-hashed storage only
(proven: hash verifies, never contains the code); 10-minute
expiry; max 5 attempts per code (correct code dies after five
wrong tries — proven); single-use (`usedAt` in the rotation
transaction); issuance supersedes older codes (deleted);
verify-then-re-verify completion for reset, inline verification
for change; dummy Argon2id work on no-user/no-code paths keeps
initiation/verification timing uniform (no enumeration oracle).

### AK.4. Schema and migration (one, additive)

`20261003055040_phase2c16_credential_management`: new
`password_otps` table (UUID id; `userId` FK Cascade; `purpose`
enum `PASSWORD_RESET`/`PASSWORD_CHANGE`; `otpHash`; `expiresAt`;
`attempts`; nullable `verifiedAt`/`usedAt`; indexes on
`(userId, purpose)` and `expiresAt`) plus nullable
`User.passwordChangedAt` watermark. 14 migrations applied, schema
in sync; no reset/`db push`/upgrade. `User.email` stays globally
unique (duplicate-across-companies deferred, AK.9).

### AK.5. Session/token invalidation (no JWT changes)

Every rotation (reset, change, SUPER_ADMIN reset) sets
`passwordChangedAt` in the same transaction. `refresh()` rejects
tokens with `iat` older than the watermark (second granularity —
same-second tokens postdate it at JWT precision) using the
existing neutral 401 `AUTH_REFRESH_TOKEN_INVALID`. Claims,
rotation, concurrency, bootstrap/401/429 semantics untouched
(full auth/refresh suites pass). Residual (documented): access
tokens live to their 15-minute expiry; change-password mints a
fresh pair so the caller stays signed in, forgot-reset does not
(re-login required).

### AK.6. Email (Nodemailer, first and only provider)

New `nodemailer` dependency; `src/config/mailer.js` sends via
SMTP (`MAIL_SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`; unset host →
503 `EMAIL_NOT_CONFIGURED`, mirroring Google convention).
Messages carry only the code + 10-minute expiry (no password,
ids, or company data). Test mode (`NODE_ENV=test`) captures to
an in-memory outbox on `globalThis` (shared across the runner's
module resolution paths) — no inbox, no browser testing.

### AK.7. Rate limiting and audit

New `authPasswordResetRateLimiter` instance (same 30/15-min env
budget, independent of login/refresh so recovery traffic can
never starve either — cap proven 30×200 then 429 in an isolated
file). Per-code DB attempt bounds are the primary OTP guard.
Audit: `USER`/`UPDATED` events (actor snapshot, company context,
`{ via: password-reset | password-change | super-admin-reset }`
+ email for platform resets) written INSIDE the rotation
transaction; failed attempts write nothing (2C-14 convention);
secret scans plus key-shape assertions prove no password/hash/
OTP/token material is recorded.

### AK.8. Company safety (verified)

No client tenant selector on any flow; cross-company ADMIN
targeting impossible (no user-id input; inconsistency fails
closed with the foreign hash untouched); one user cannot reset
another's password; platform endpoint returns safe-user shapes
only. Suspension: initiation silently skips suspended/inactive
accounts (uniform 200); completion enforces `COMPANY_SUSPENDED`
/ `AUTH_ACCOUNT_INACTIVE` after code verification, so reset can
never bypass 2C-13 (login/refresh/me gates unchanged).

### AK.9. Deferred work (unchanged scope)

ADMIN email/identifier change; duplicate-email-across-companies
+ login disambiguation (global uniqueness preserved; flows key
on it safely); OTP/email retention cleanup worker; audit UI/
retention; permanent deletion; Google redesign; RBAC/billing/
mobile changes. Null-company legacy accounts use the public
forgot flow (authenticated change needs company context like all
authed routes). Test-only finding (fixed, not production):
runner module duplication required the `globalThis` outbox.

---

## AL. PHASE 2C-17 IMPLEMENTATION RECORD — MUTATION-WIDE AUDIT INSTRUMENTATION

Phase 2C-17 status is COMPLETE: business-level AuditLog events now
cover every administrative mutation family, proven by 19 dedicated
tests within a 63-file / 608-test green suite. No migration was
needed (only the `RETURN` resource name was added to the validator
vocabulary — no schema change). No read APIs, UI, retention, or
deletion were built. Overall Phase 2 was NOT STARTED at this point,
pending the remaining slices (now COMPLETE — see phase table and §AX) (AL.5).

### AL.1. Coverage inventory (implemented in this phase)

| Resource | Mutation | Audit Event | Actor Scope | Notes |
|----------|----------|-------------|-------------|-------|
| Company | create/suspend/restore | CREATED/SUSPENDED/RESTORED | SUPER_ADMIN platform | Pre-existing (2C-15), untouched |
| Company | permanent delete (SUSPENDED-only, exact-name, #1-protected) | DELETED (platform, companyId NULL) | SUPER_ADMIN platform | Phase 2C-20 (see AO): full tenant purge in one tx; company-scoped audits cascade, platform DELETED row survives |
| User | ADMIN provisioned | CREATED | SUPER_ADMIN/platform | Pre-existing (2B-1), untouched |
| User | ADMIN credential reset | UPDATED | SUPER_ADMIN, company scope | Pre-existing (2C-16), untouched |
| User | HEAD/MEMBER provisioned | CREATED `{email, role}` | creating ADMIN/HEAD | NEW: in-tx via `createUserWithCompanyRole` audit param |
| User | ban/deactivate/restore | DEACTIVATED/REACTIVATED | ADMIN | Pre-existing (2C-14), untouched |
| Customer | (ban/restore above) | — | ADMIN | Same path; no new customer capabilities added |
| Category | create/update/deactivate/reactivate/image upload/remove | CREATED/UPDATED/DEACTIVATED/REACTIVATED | ADMIN | NEW: post-commit; isActive flips classify (coupon convention) |
| Product | create/update/deactivate/delete-confirm | CREATED/UPDATED/DEACTIVATED/DELETED | ADMIN | NEW: create + guarded-deactivate in-tx; rest post-commit. Nested variant creation is covered by the product CREATED event (no per-variant rows) |
| ProductVariant | create/update/deactivate (+reactivate via update) | CREATED/UPDATED/DEACTIVATED/REACTIVATED | ADMIN | NEW: post-commit, `{sku}` metadata |
| Product | image add/promote/edit/remove | UPDATED `{imageOperation, imageId}` | ADMIN | NEW: attached to owning product (images carry no company); tx paths in-tx |
| Inventory | initialize/adjust | CREATED `{quantity}` / UPDATED `{delta, type}` | ADMIN | NEW: in-tx with ledger; rejected adjustments (404/409/422) record nothing |
| Order | admin status change | UPDATED `{from, to}` | ADMIN/HEAD/MEMBER per routes | NEW: in-tx via `options.audit`; history + notifications intact |
| Order | bulk status change | UPDATED per order | ADMIN | NEW: per-order rows inside the all-or-nothing tx |
| Order | admin payment change | UPDATED `{from, to, scope: payment}` | ADMIN | NEW: in-tx via audit param |
| Return | request created | CREATED `{orderId, reason}` | owning CUSTOMER | NEW: in-tx; only the constrained reason enum is stored (free text excluded) |
| Coupon | create/update/deactivate/reactivate/delete | CREATED/UPDATED/DEACTIVATED/REACTIVATED/DELETED | ADMIN | NEW: in-tx alongside CouponHistory; AuditLog details are code-redacted (changed-field names only) |
| Marketing | create/update/delete | CREATED/UPDATED/DELETED `{title}` | ADMIN | NEW: post-commit; role restrictions untouched |
| Announcement | create/update/delete | CREATED/UPDATED/DELETED | ADMIN | NEW: post-commit (no title field exists — resourceId identifies) |
| Credentials | reset/change/SUPER_ADMIN reset | UPDATED | self / SUPER_ADMIN | Pre-existing (2C-16), untouched |

### AL.2. Intentionally NOT audited (ordinary activity, not administration)

* Cart/wishlist/addresses CRUD — caller-owned shopping activity.
* Order placement (checkout) and customer self-cancel — customer
  purchase activity (history/ledger keep domain state).
* Customer reviews create/update/delete + review reads — ordinary
  activity; the admin review surface is read-only (no admin
  mutation exists to instrument).
* Customer notification reads/mark-read/delete + system-created
  notifications — inbox activity and order-mutation side-effects
  (covered by the originating order event).
* Customer registration/Google/login/logout/refresh — login events
  deliberately deferred (AI.3); registration is ordinary signup.
* Profile read/update (`/users/me`) — ordinary account activity.
* Coupon validate/quote + usage consumption — read/advisory and
  checkout side-effects.
* All GET/read/list endpoints — never audited.
* HEAD/MEMBER update/delete endpoints — do not exist yet (Phase 3);
  deactivation rides the audited ban path.

### AL.3. Semantics and safety

* Actions reuse the existing vocabulary only (no additions);
  resources reuse it plus one minimal addition (`RETURN` — the
  return trail previously had no name). No generic resources.
* Actor/company always server-derived (`req.user.id` threaded as
  `{ id }` by controllers, `companyId` from `req.companyContext`;
  returns reuse the owner `userId`; marketing creates reuse
  `createdBy`). No client actor/company input exists on any path.
* Metadata allowlist per family (names, titles, SKUs, quantities,
  transitions, reasons, field names); coupon codes, free-text
  return details, and all credential material excluded. The
  recursive secret scanner validates every payload; arrays are
  rejected by it (found live: coupon field lists ship as joined
  strings).
* No N+1: one actor-snapshot read per mutation (reused across bulk
  rows); no extra reads where identity already loaded.

### AL.4. Transaction discipline (verified by test)

* In-tx (payload validated pre-tx, committed with the mutation):
  product create + guarded deactivation, variant-less image
  primary paths, inventory init/adjust, order status/bulk/
  payment, return creation, coupon create/update/delete,
  ADMIN/employee provisioning, company lifecycle, credentials.
* Post-commit (single-write ops with no transaction to join;
  recorded only after success, mirroring `setUserActiveAdmin`):
  category CRUD + images, product/variant update/delete,
  non-primary image paths, marketing/announcements.
* Proven: failed/rolled-back mutations leave no rows — rejected
  adjustments, ghost-id updates, duplicate-race P2002s,
  pre-validation bulk failures, a mid-transaction
  `ORDER_INVENTORY_MISSING` rollback (status + ledger + audit all
  revert), and cross-company 404s (no audit attributed to any
  company).

### AL.5. Verification and deferred work

* New suites: `audit-instrumentation-catalog` (10/10: category/
  product/variant/image/inventory/broadcast/coupon + failure
  proofs) and `audit-instrumentation-orders` (9/9: employee/
  ban/ status/payment/bulk/return + cross-company + both
  rollbacks). Full suite: 63 files, 589 pre-existing + 19 new =
  608/608. Two self-caught defects fixed (an edit that briefly
  duplicated a repository block — repaired before any test ran;
  the metadata array-shape rejection above).
* No migration (verified: `migrate status` → 14 applied, in sync),
  no reset/`db push`/upgrade/commit/push. JWT/refresh, lifecycle
  semantics, history tables, permissions, and RBAC untouched.
* Deferred (unchanged): audit read/filter endpoints, UI,
  dashboards, export, retention settings/worker, audit deletion;
  HEAD/MEMBER update/delete APIs (Phase 3); review moderation
  endpoints (none exist); permanent deletion; billing/mobile.

---

## AM. PHASE 2C-18 IMPLEMENTATION RECORD — AUDIT READ API & VISIBILITY

Phase 2C-18 status is COMPLETE: `GET /api/v1/audit-logs` serves
paginated, role-scoped audit reads on the Phase 2C-14 visibility
architecture (which already existed service-side and is reused
unchanged in shape), proven by 24 dedicated tests within a
64-file / 632-test green suite. No UI, export, retention, or
deletion was built. Overall Phase 2 was NOT STARTED at this point,
pending the remaining slices (now COMPLETE — see phase table and §AX) (AM.5).

### AM.1. What already existed (reused, not rewritten)

`listAuditLogs` (role/company/actor scoping, page/limit,
action/resource/company/actor/date filters, newest-first with id
tiebreak) and `findAuditLogs` (explicit safe projection, AND
predicate builder) already covered MEMBER-own / HEAD-own+members
/ ADMIN-company / SUPER_ADMIN-everything. Gaps closed in this
phase: `outcome`, `role` (`actorRole`), and `resourceId` filters
(`outcome` needed a new repository predicate; the others rode
existing builder paths), plus a SUPER_ADMIN company-existence
check (unknown UUID → 404 `COMPANY_NOT_FOUND`; SUPER_ADMIN can
already enumerate companies, so nothing leaks).

### AM.2. Endpoint and chain

`GET /api/v1/audit-logs` (`src/modules/audit/`: new
`audit.routes.js` / `audit.controller.js` /
`audit.validation.js`, mounted in `src/routes/index.js`):
`authenticate → resolveCompanyContext → requireActiveCompany →
authorize("ADMIN", "HEAD", "MEMBER", "SUPER_ADMIN")`. Anonymous
401s, CUSTOMER 403s at the gate. Reads are strictly non-mutating
(proven by scoped row counts — no read-audit rows, no timestamp
touches). Envelope mirrors the admin-list convention:
`{ success, data: { logs }, meta: pagination }`.

### AM.3. Visibility (agreed model, verified per role)

* MEMBER: actor forced to self (foreign `actorId` ignored —
  always exactly own rows).
* HEAD: fixed self+members set (foreign params ignored).
* ADMIN: whole company; validated narrowing to one own-company
  actor (`actorId` of an unknown/foreign actor yields an empty
  200 page, never 404 — no cross-company oracle).
* SUPER_ADMIN: everything; `companyId` UUID (existence-checked)
  or the literal `companyId=null` for platform-only rows;
  `actorId` freely combinable (actor+company mismatches yield
  empty pages).
* Role filter (`role`) applies as an AND beside the scope, so it
  only narrows: MEMBER+`role=ADMIN`, ADMIN+`role=SUPER_ADMIN`,
  and HEAD+`role=HEAD` (own rows only — peers excluded) all
  behave without broadening. Over-scope combinations return zero
  rows (200), never foreign rows and never a forbidden error that
  would signal existence.

### AM.4. Filters, pagination, projection, suspension

* Filters: `page/limit/actorId/resourceId/companyId/resource/
  action/outcome/role/from/to`. `from/to` are ISO-8601 parsed to
  UTC, inclusive (`gte/lte`); malformed values 422. Invalid
  UUIDs/enums 422 (`VALIDATION_ERROR` from Zod,
  `AUDIT_INVALID_*` from the service). Over-max `limit` 422s at
  the schema level (established list convention); default 20,
  max 100. Newest-first, id tiebreak; no client ORDER BY.
* Text search deliberately omitted: no suitable index exists and
  `details` is schemaless JSON — UI search starts with structured
  filters (documented limitation).
* Projection is the explicit repository select (id, actor
  snapshot, companyId, action, resource, resourceId, outcome,
  details, createdAt) — details were sanitized at write time and
  the read adds no fields.
* Suspension: members of suspended companies get 403
  `COMPANY_SUSPENDED` like every company route (no bypass);
  SUPER_ADMIN platform context reads suspended companies freely
  (proven on a dedicated suspended company).

### AM.5. Verification and deferred work

* New `tests/integration/audit-read.test.js` (24/24): auth gates,
  per-role isolation matrices, smuggling impotence (query/header/
  body companyId, foreign actorId), SA platform/company/actor/
  combo/suspended reads, all filters + 422s, date bounds,
  pagination defaults/caps/pages/ordering, exact projection keys,
  read-only proof. Two self-caught test-isolation defects fixed
  (global-table counts and unfiltered first-page presence are
  load-dependent under parallel workers — both rescoped to
  file-owned rows). Affected suites (foundation, both
  instrumentation files, lifecycle, context, suspension): 82/82.
  Full suite: 64 files, 608 pre-existing + 24 new = 632/632.
* No migration (schema already sufficient; verified in sync), no
  reset/`db push`/upgrade/commit/push. JWT/refresh, mutations,
  histories, permissions, and RBAC untouched.
* Deferred (unchanged): audit UI/dashboard/export/CSV, retention
  settings/worker, audit deletion; login disambiguation;
  permanent deletion; billing/mobile.

---

## AN. PHASE 2C-19 IMPLEMENTATION RECORD — AUDIT RETENTION & CLEANUP

Phase 2C-19 status is COMPLETE: a global NEVER/30_DAYS/1_YEAR
retention policy (SUPER_ADMIN-only API, audited changes) plus a
server-side age-based purge (in-process worker + one-shot script,
no manual delete endpoint), proven by 16 dedicated tests within a
65-file / 648-test green suite. No UI was built. Overall Phase 2
was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX) (AN.6).

### AN.1. Discovery (nothing existed)

No scheduler, worker, cron, settings model, or retention
terminology existed anywhere (verified by search). `server.js` is
a plain listen + graceful shutdown; scripts are `dev/start/test`
only. The design below fits that shape: one deployment runs one
in-process worker, started only from `server.js` (never on app
import, so tests and scripts stay side-effect free).

### AN.2. Persistence (one minimal migration)

New `audit_retention_policy` table (migration
`20261003073742_phase2c19_audit_retention`): single row
(`id = "global"`), `policy` string default `NEVER`, nullable
`updatedBy` actor snapshot (no user FK — history convention),
timestamps. No row means NEVER (fresh default). No companyId, no
per-company policy, no enum type (the server-owned string
vocabulary in `retention.service.js` is the single source of
truth; every writer validates). 15 migrations applied, schema in
sync; no reset/`db push`/upgrade.

### AN.3. API (SUPER_ADMIN-only, platform chain)

`GET /api/v1/audit-retention` → `{ policy, description,
updatedAt, updatedBy }` (nulls when never configured).
`PATCH /api/v1/audit-retention` takes exactly `{ policy:
NEVER|30_DAYS|1_YEAR }` (strict — companyId, numeric days,
dates, and extra fields 422). Same-value updates succeed
idempotently WITHOUT an audit row (no change happened).
Chain `authenticate → resolveCompanyContext →
authorize("SUPER_ADMIN")` with deliberately NO company-active
check (platform configuration; suspended companies never block
it). Descriptions are server-owned copy for the future UI
(order-notification precedent).

### AN.4. Change audit

Every real change writes one `AUDIT_RETENTION`/`UPDATED` event
(new minimal resource name, existing action) in the same
transaction as the policy upsert: SUPER_ADMIN snapshot actor,
`companyId: NULL`, `details: { previousPolicy, newPolicy }`, no
secret material. Rollback leaves neither row. Retention-change
audits age out like any other row under a later cutoff — they
are never singled out (proven: change history reads back
exactly).

### AN.5. Cleanup semantics and safety

`runRetentionCleanup()`: derives the policy server-side, uses
`createdAt` only, deletes rows STRICTLY older than now − N days
(N = 30 / 365; a year is exactly 365 days; boundary rows
survive), in bounded `ORDER BY createdAt, id LIMIT 1000` batches
(raw SQL — Prisma has no delete limit — cutoff parameterized,
limit a server constant), never loads rows into memory, writes
no audit rows, idempotent and empty-safe, NEVER deletes nothing.
Guards: no client cutoff, no HTTP delete surface (`DELETE`
on both audit routes 404s), non-audit tables untouched, UTC
throughout, errors logged with counts only (never contents).
Execution: in-process interval (default 24h via
`AUDIT_CLEANUP_INTERVAL_MS`, first run one interval after boot,
duplicate-start guarded, unref'd, stopped on shutdown) plus
`npm run cleanup:audit-logs` one-shot script for external
schedulers (documented as either/or, never both, for
multi-process deployments).

### AN.6. Verification and deferred work

* New `tests/integration/audit-retention.test.js` (16/16):
  auth matrix (anon 401, all four company roles 403 both verbs),
  fresh-default NEVER, exact-enum acceptance, nine-shape 422
  rejection, full transition cycle with idempotent same-value
  behavior, exact six-row audit chain with actor/platform/shape
  assertions, NEVER/30_DAYS/1_YEAR purges with ±60s deterministic
  boundaries, repeat/empty safety, other-table survival,
  smuggling impotence, suspended-company non-blocking, and both
  DELETE 404s. Affected suites re-run green. Full suite:
  65 files, 632 pre-existing + 16 new = 648/648.
* One latent flake fixed (pre-existing 2C-16 second-granularity
  watermark race, unrelated to retention): invalidation tests now
  cross a second boundary between login and reset instead of
  racing the wall clock; production behavior unchanged.
* Deferred (unchanged): audit/retention UI, export, retention
  worker dashboards, company-specific policies, permanent company
  deletion (which may one day purge company-scoped rows —
  retention never authorizes deletion), billing/mobile.

---

## AO. PHASE 2C-20 IMPLEMENTATION RECORD — PERMANENT COMPANY DELETION

Phase 2C-20 status is COMPLETE: `DELETE /api/v1/companies/:id`
permanently destroys one SUSPENDED, exact-name-confirmed,
non-#1 company with its full tenant graph in a single
transaction, leaving a platform `DELETED` audit behind. Proven
by 17 dedicated tests within a 66-file / 665-test green suite.
No migration was needed (existing cascades already correct;
`Restrict` edges get explicit ordered deletes). Overall Phase 2
was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX) (AO.7).

### AO.1. Dependency graph (mapped from prisma/schema.prisma)

Company outgoing `Restrict` (emptied explicitly): Category,
Product, ProductVariant, Coupon, MarketingNotification,
SiteAnnouncement. Auto-`Cascade` on company delete:
CompanyDomain, AuditLog (company-scoped rows only).
User outgoing `Cascade` (roles, OTPs, addresses, carts + items,
wishlists + items, notifications, coupon usages) vs `Restrict`
(orders, reviews, return requests — deleted first). Order
subgraph scoped via `user.companyId`: status history / address /
payment / items (all `Restrict`) then orders. FK-free tables
deleted by collected id lists: CouponHistory (by coupon),
OrderStatusHistory is FK-bound (`Restrict`, deleted by order
scope). `SetNull` edges need no work (category parent, image
variant, notification order, coupon order link, user company,
company admin link). Global data untouched by construction:
Role rows (no company predicate anywhere), SUPER_ADMIN users
(`companyId NULL`, outside every user-scoped delete), other
companies, Company #1. FK-free actor snapshots (`createdBy`,
`actorId`, `createdBy` strings) intentionally survive as
history-convention orphans.

### AO.2. Endpoint and guards

`DELETE /api/v1/companies/:id { confirmName }` (strict —
`companyId`/`status`/`adminUserId`/`force`/`delete` flags 422),
same SUPER_ADMIN platform chain as all company management (no
`requireActiveCompany`). Fail-before-destruction order: 404
`COMPANY_NOT_FOUND` → 403 `COMPANY_PROTECTED` (Company #1 by
stable UUID `35b5a215-…`, matching the foundation migration and
seed — never by name) → 409 `COMPANY_NOT_SUSPENDED` → 422
`COMPANY_CONFIRMATION_MISMATCH` (case-sensitive `===` against
the live name; UUID never substitutes). Success answers
`{ deleted: { id, name } }` — no operational data. No schema
change, no FK toggle, no raw table wipes, no `db push/reset`.

### AO.3. Transaction and concurrency

One Prisma transaction, exact order: reviews → coupon-id list →
inventory ledger → inventory → product images → returns →
order sub-rows + history → orders → coupon history + coupons →
users → variants → products → categories → broadcasts →
platform `DELETED` audit (`COMPANY`, `companyId: NULL`,
`{ companyId, companyName }`, secret-free) → guarded final
`deleteMany({ id, status: SUSPENDED, name })`. Zero matched rows
(a concurrent restore, or a racing second delete) rolls
everything back (`COMPANY_NOT_FOUND`, nothing partial). No
distributed locks. A self-caught defect fixed in development:
the in-tx audit initially missed its `resourceId` stamp (found
by test, one-line fix).

### AO.4. Audit and retention interaction

Company-scoped audit rows die with the company (schema cascade);
platform lifecycle rows (`CREATED`/`SUSPENDED`, `companyId
NULL`) and the new `DELETED` row survive as platform history —
verified coexisting. Unchanged retention semantics: retention
governs scheduled age-based cleanup only, NEVER neither prevents
nor authorizes deletion, and the surviving `DELETED` row ages
out normally. `GET /audit-logs` behavior unchanged (proven
post-deletion: row still readable by SUPER_ADMIN).

### AO.5. Media and filesystem

Pre-transaction collection of product-image `storagePath`s and
category `image` refs; post-commit removal via the guarded
storage adapter plus recursive removal of the
`companies/{companyId}` subtree (UUID-validated, root-pinned,
warn-only — the committed database is authoritative). Verified:
referenced file gone, subtree gone. Documented limitation:
filesystem work is NOT in the DB transaction (a crash between
commit and cleanup can leave unreferenced bytes). No shared or
legacy-flat files of other companies touched; no storage
redesign; no garbage collector.

### AO.6. Verification

New `tests/integration/company-deletion.test.js` (17/17):
ACTIVE/wrong/empty/missing confirmations, #1 UUID protection
(both names), role matrix (4×403) + anonymous 401, flag/body
rejection + query/header inertness (route id governs),
per-table zero-counts across 25 scopes (users, addresses,
carts, wishlists, notifications, catalog ×6, inventory ×2,
orders ×5, returns ×2, reviews, coupons ×4, broadcasts ×2,
domains, company audits), media reclamation (file + subtree),
platform audit shape/secrets, repeat-404, keep-company/global/
SA/#1 intactness, restore-then-delete lifecycle guard,
retention-cleanup coexistence. Two self-caught test defects
fixed (brace typo; `expect.anything()` with `toBe`).
Affected suites re-run green (97/97). Full suite: 66 files,
648 pre-existing + 17 new = 665/665. `migrate status`: 15
applied, in sync. No dependency changes.

### AO.7. Deferred work (unchanged)

Audit/retention UI, export, per-company retention, login
disambiguation, billing/mobile. Deletion is final by design —
no restore, no soft-delete, no undelete path exists.

---

## AP. PHASE 2C-21 IMPLEMENTATION RECORD — AUDIT CSV EXPORT

Phase 2C-21 status is COMPLETE: `GET /api/v1/audit-logs/export`
serves a CSV rendering of the exact read visibility scope and
filters, proven by 12 unit + 23 integration tests within a
68-file / 700-test green suite. No migration was needed (no
schema change), no dependency was added, no UI was built.
Overall Phase 2 was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX)
(AP.6).

### AP.1. Design (shared model, bounded output)

There is exactly one authorization model: the read path was
refactored so `listAuditLogs` and the new `exportAuditLogs`
share `buildAuditFilters` (role resolution, vocabulary checks,
SUPER_ADMIN/company/HEAD/MEMBER branches byte-identical —
affected read suites re-run green). Export differs only in
windowing: one bounded `take` of `AUDIT_EXPORT_MAX_ROWS + 1`
(10,000) instead of pages; overflow fails explicitly with 422
`AUDIT_EXPORT_TOO_LARGE` (never truncated). A single 10k-row
window keeps serialization in memory by explicit bound rather
than true streaming: keyset batching was evaluated and rejected
as a second query path to keep in sync for this dataset scale
(the bound is documented and enforced, not silent).

### AP.2. Endpoint and validation

`GET /api/v1/audit-logs/export` on the existing audit router
(same `authenticate → companyContext → requireActiveCompany →
authorize(ADMIN, HEAD, MEMBER, SUPER_ADMIN)` chain; suspended
members 403, SUPER_ADMIN platform reads suspended scopes).
`auditExportQuerySchema` mirrors the read filters minus
`page/limit` (export always represents the complete filtered
set — pagination params are stripped/ignored, never applied);
same 422s for bad UUIDs/enums/dates, same unknown-company 404,
same empty-page (not oracle) semantics. No DELETE route exists
(proven 404). Reads and exports are both strictly non-mutating:
no export audit rows, no retention/timestamp touches.

### AP.3. CSV shape and safety

Dependency-free `audit.csv.js` over the exact 11-field safe
projection in select order (`id` … `createdAt`): `details` as
compact JSON in one cell, dates as UTC ISO, nulls as empty
cells, RFC 4180 quoting (commas/quotes/CRLF), CRLF row endings,
UTF-8 `text/csv; charset=utf-8`, deterministic server-side
filename `audit-logs-YYYYMMDDTHHMMSSZ.csv` (no user input).
Formula-injection guard per OWASP CSV guidance: cells leading
with `=`, `+`, `-`, `@` get a `'` text-marker prefix (audit
data and GET responses byte-identical — representation-only
defense, documented here). Row order equals the read ordering
(`createdAt DESC, id DESC`), proven identical ID sequences
against GET for the same filters.

### AP.4. Coexistence

Retention: export neither reads nor writes retention state
(policy sampled before/after in tests); purged rows simply stop
appearing. Company deletion: deleted companies' scoped rows are
gone (their company filter 404s like the read path); the
surviving platform `DELETED` audit exports under the null scope
(proven live). No resurrected data anywhere.

### AP.5. Verification

* New `tests/unit/audit-csv.test.js` (12/12): projection order,
  null/date cells, RFC quoting, JSON-in-cell, formula prefixes,
  document assembly, filename shape.
* New `tests/integration/audit-export.test.js` (23/23): auth
  gates, suspended behavior both sides, per-role export↔GET ID
  parity (including peer/admin/foreign exclusion and
  broaden-attempt impotence), all-filter parity, full 422
  matrix, smuggling inertness, content-type/disposition,
  exact header, escaping round-trip via a real CSV reader,
  null cells, all four formula triggers, ordering parity,
  secret scan, header-only empties, deleted-company
  exportability + gone-company 404, retention coexistence,
  service-level size-boundary proof (`maxRows` override:
  over-limit 422s, wide bound passes), both DELETE 404s.
* Three self-caught test defects fixed (two assertions
  contradicting the correct ignore-forcing semantics; one
  row-id vs `resourceId` field mix-up that briefly implicated
  the filter before a probe exonerated it). Affected suites
  (read, foundation, retention, deletion, lifecycle): green in
  the full run. Full suite: 68 files, 665 pre-existing + 35
  new = 700/700. `migrate status`: 15 applied, in sync.
* No dependency changes, no JWT/auth/mutation/rbac changes.

### AP.6. Deferred work (unchanged)

Audit UI/dashboard, export scheduling/delivery, larger/streamed
exports beyond the documented bound, per-company retention,
login disambiguation, billing/mobile. The bound constant is the
single knob if export volumes ever demand revisiting.

---

## AQ. PHASE 2C-22 IMPLEMENTATION RECORD — ADMIN AUDIT LOG UI

Phase 2C-22 status is COMPLETE: the admin application serves a
read-only Audit Logs page (`/audit-logs`) on the existing
backend read/export APIs, proven by 26 new frontend tests within
a 45-file / 336-test green admin suite. Backend unchanged (no
endpoints, migrations, or semantics touched). Overall Phase 2
was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX) (AQ.5).

### AQ.1. Page and architecture reuse

`pages/AuditLogsPage.jsx` follows the ReviewsPage pattern:
`PageHeader` + filter toolbar + `Table` (local horizontal scroll
via the shared shell — no page overflow) + backend-`meta`
`Pagination` + `Modal` detail + skeleton/`ErrorState` (retry)
+ `EmptyState` (pristine vs filtered variants). State is local
Zustand (`stores/useAuditStore.js`: filters/page/rows/meta,
filter change resets to page 1, no URL state — matching existing
list pages) over `services/audit.service.js`
(`fetchAuditLogs` via `apiGetPage`, `downloadAuditLogsCsv` via
the new `apiDownloadCsv` client helper with identical
401-refresh semantics). Route registered under the unchanged
`ProtectedRoute`; Operations nav entry (`FileText` icon);
header title branch added.

### AQ.2. Filters, table, detail, export

Filters map 1:1 to backend params (action/resource/outcome/role
selects immediate; actor/resource/company-ID text via Apply +
Enter; date pickers immediate; clear-all; no search box —
backend offers none; no invented params). `companyId` renders
only for `SUPER_ADMIN` sessions (no selector abstraction was
invented). Table shows Time (local, exact in title/detail),
Actor (email → short id → `System`), Role/Outcome badges,
Action, Resource, truncated Company (`Platform` for null), and
a Details opener; the modal renders the full safe 11-field
projection with pretty-printed JSON (no HTML, no mutation
controls anywhere). Export downloads the backend CSV verbatim
for current filters (never `page/limit`, never client-built);
filename from `Content-Disposition` (`audit-logs.csv`
fallback); `AUDIT_EXPORT_TOO_LARGE` → actionable narrow-filters
toast; other errors follow the `ApiError`/toast conventions.

### AQ.3. Roles and backend-unchanged confirmation

The app's login requires `ADMIN` and `ProtectedRoute` admits
ADMIN only (verified, unchanged — HEAD/MEMBER/SUPER_ADMIN
backend access stays API-available). [Superseded by AQ.6 below:
the common panel now admits all four staff roles.] No backend
file changed in this phase; no migration (15 applied, in sync);
no dependency changes. Customer frontend untouched.

### AQ.4. Verification

* New: `services/__tests__/audit.service.test.js` (param
  allowlisting, meta mapping, export URL/filename passthrough),
  `pages/__tests__/AuditLogsPage.test.jsx` (15: render, fields,
  SYSTEM/null safety, filter→param mapping, page reset +
  persistence, clear, modal + 11 fields, mutation-control
  absence, states + retry, export wiring/filters/pagination
  exclusion, TOO_LARGE toast, SUPER_ADMIN company field),
  `routes/__tests__/router.test.jsx` (+3: registration, nav
  reachability, CUSTOMER redirect without service calls),
  `lib/__tests__/apiClient.test.js` (+3 download cases).
  `AdminLayout.test.jsx` count updated 11 → 12 with the new
  link asserted (nothing weakened).
* Full admin suite: 45 files, 310 pre-existing + 26 new =
  336/336. ESLint strict (`--max-warnings 0`) clean on all
  touched files. No manual browser testing.
* Deferred (unchanged): audit dashboard/analytics, retention
  UI, export scheduling, per-company retention, login
  disambiguation, billing/mobile.

### AQ.5. Remaining work

UI-level company search for SUPER_ADMIN (plain ID field today),
retention-policy UI, and any analytics dashboards stay
explicitly deferred. Backend audit work is untouched by this
phase.

### AQ.6. Remediation 2C-22R — common admin-panel role model (frontend only)

The 2C-22 report overstated the frontend gate: it described the
pre-existing ADMIN-only login/guard as the intended convention,
which locked SUPER_ADMIN/HEAD/MEMBER out of the panel although
the backend audit API serves all four roles. Corrected without
touching any backend file: one shared panel model
(`ADMIN_PANEL_ROLES`: SUPER_ADMIN/ADMIN/HEAD/MEMBER; CUSTOMER
and unknown roles denied), the login + bootstrap gates admit
panel roles, `ProtectedRoute` takes explicit per-branch roles
(operational routes stay ADMIN-only; `/audit-logs` admits the
four), navigation mirrors per-item roles (non-ADMIN roles see
only Audit Logs), and the login landing is loop-free (ADMIN
honors `redirect`; others land on `/audit-logs`). Backend
`authorize(...)` remains the sole authority; no client-side
audit filtering was added.

---

## AR. PHASE 2C-23 IMPLEMENTATION RECORD — SUPER ADMIN RETENTION UI

Phase 2C-23 status is COMPLETE: the admin application serves a
SUPER_ADMIN-only Audit Retention page (`/audit-retention`) on
the existing Phase 2C-19 API, proven by focused frontend tests
within a 48-file / 398-test green admin suite. No backend file
changed, no migration, no dependency change. Overall Phase 2
was NOT STARTED at this point, pending the remaining slices (now COMPLETE — see phase table and §AX) (AR.5).

### AR.1. Page and architecture reuse

`pages/AuditRetentionPage.jsx` follows the app's config-page
shape: `PageHeader` + current-state card + radio-card selector
+ `Modal` confirm + `ErrorState` retry, over
`stores/useRetentionStore.js` (load/save/status, server state
only) and `services/retention.service.js` (`fetchRetentionPolicy`
via `apiGet`, `updateRetentionPolicy` via `apiPatch` with
exactly `{ policy }`). New `System` nav section (single item —
no settings framework invented); `FileText`-style icon
conventions reused (`History`). Draft sync uses the codebase's
sanctioned render-time derived-state pattern (same as
AdminLayout's route reset), never clobbering in-progress
selection except on genuine server-state change.

### AR.2. Access control (SUPER_ADMIN only)

New route branch `allowedRoles={['SUPER_ADMIN']}` (existing
per-branch mechanism from 2C-22R); nav item likewise; ADMIN/
HEAD/MEMBER/CUSTOMER redirect away via the shared guard
(backend `authorize("SUPER_ADMIN")` authoritative). The
guard's redirect is loop-free by construction (authenticated
users go to plain `/login`, whose role-aware landing sends
them to a permitted page — verified by an ADMIN deep-link
regression test). `/audit-logs` restrictions untouched; no
company selector, no per-company policy, no cleanup/deletion
controls anywhere.

### AR.3. Behavior contracted and verified

Supported policies exactly `NEVER`/`30_DAYS`/`1_YEAR` (local
constant mirroring backend); server `description`/`updatedAt`/
`updatedBy` rendered readably with null-safe fallbacks;
reductions confirm via Modal (increases and same-value saves
apply directly; `changed:false` is success); save control
loading-guards duplicates; `422`/`403`/network errors toast
per conventions; "eligible cleanup" wording only, plus the
standing retention-vs-deletion note.

### AR.4. Verification

* New: `services/__tests__/retention.service.test.js`
  (vocabulary exactness, GET/PATCH shapes), `pages/__tests__/
  AuditRetentionPage.test.jsx` (14: load states, all three
  policies, null-safe metadata, exact selector options, exact
  `{ policy }` body, duplicate guard, toasts incl. idempotent
  and error paths, confirm/cancel/increase semantics, control
  absence), `routes/__tests__/router.test.jsx` (+6: SA entry,
  four-role denial, audit-log invariance, ADMIN deep-link
  loop regression), `AdminLayout.test.jsx` (+1 SUPER_ADMIN nav).
* Full admin suite: 48 files, 372 pre-existing + 26 new =
  398/398. ESLint strict clean. No manual browser testing.
* Backend: zero files changed (docs-only record here);
  multisite `migrate status` untouched (15 applied, in sync).

### AR.5. Deferred work (unchanged)

Retention-policy scheduling UI, per-company policies, custom
durations, audit dashboard/analytics, export scheduling,
billing/mobile. The page intentionally offers no timing
promises beyond schedule eligibility.

---

## AS. PHASE 2C-24 IMPLEMENTATION RECORD — AUDIT DASHBOARD / ANALYTICS

Phase 2C-24 status is COMPLETE: `GET /api/v1/audit-logs/summary`
aggregates exactly the rows each viewer could list, and the admin
application serves a read-only `/audit-dashboard` page on it.
Proven by focused backend/frontend tests within green full
suites on both sides. No migration was needed (no schema
change), no dependency was added. Overall Phase 2 stays NOT
STARTED pending the remaining slices (AS.6).

### AS.1. Metrics and why each is defensible

Every metric derives directly from stored `AuditLog` columns —
no business meaning is inferred beyond counting and grouping
what the schema already records:
- `total`: scoped row count (same predicate as the list count).
- `byOutcome` / `byAction` / `byResource`: per-value counts over
  the validated vocabulary (no invented categories).
- `topActors`: top 10 `(actorId, actorRole)` pairs by volume —
  the same identifiers the viewer already sees in row reads, so
  the audience never widens; capped server-side.
- `byDay`: daily UTC buckets over the effective period,
  zero-filled server-side (bounded output, see AS.3).
- `recent`: the latest in-scope row in the safe projection
  (null when the scope is empty).
- `period`: the effective `{ from, to }` the numbers cover.

Deliberately omitted: revenue/funnel/business-KPI readings
(the log carries none), per-actor emails in aggregates (row
reads remain their home), unbounded windows, text search.

### AS.2. Visibility and safety

`buildAuditFilters` (2C-18/2C-21) is reused verbatim — the
summary path adds no authorization logic of its own. The Prisma
`where` construction moved into `buildAuditWhere`, shared by
row reads and every aggregate; the single raw-SQL query (daily
`DATE()` buckets, which Prisma cannot express) translates the
SAME normalized filter object with bound parameters only, and
throws on any predicate shape it does not recognize instead of
dropping it. Proven per role: MEMBER self-only numbers, HEAD
self+members with peer-HEAD activity absent from totals and
actor lists, ADMIN company-only, SUPER_ADMIN selected scope
(including suspended-company scopes and the platform null
scope). Unknown-company 404, invalid UUID/enum/date 422s, and
empty-scope zero shapes all match the read endpoint.

### AS.3. Periods, bounds, and performance

`from`/`to` share the read endpoint's inclusive UTC semantics.
Absent bounds default to the trailing 30 days; spans over 366
days are rejected (422). Output is bounded by construction
(≤367 daily buckets, top-10 actors, fixed vocabularies). All
math runs in the database (Prisma `groupBy`/`count` plus one
parameterized `GROUP BY day` query following the dashboard and
retention raw-SQL precedents) — rows are never hydrated for
summing and nothing unbounded enters application memory.

### AS.4. API and UI surface

* `GET /api/v1/audit-logs/summary` (same
  authenticate → companyContext → requireActiveCompany →
  `authorize(ADMIN, HEAD, MEMBER, SUPER_ADMIN)` chain;
  export-style filter contract, no pagination params).
  Response: `{ success, data: { summary } }`. Read-only; list
  and export contracts byte-identical (re-verified).
* Admin `/audit-dashboard` (Operations section, four panel
  roles — same branch as `/audit-logs`): `PageHeader`, stat
  cards, the hand-rolled `TrendChart` reused verbatim for daily
  buckets (backend-shaped `{ bucketStart, orders }`, no new
  dependency), `Table`s for action/resource/actor breakdowns,
  a recent-activity card, date/action/resource/outcome filters
  (+ company field for SUPER_ADMIN only), backend-`meta`-free
  single-shot fetch via `useAuditDashboardStore`, and the
  loading/empty/error conventions. No mutation controls, no
  client-side filtering, no invented params.

### AS.5. Verification

* New `backend/tests/integration/audit-summary.test.js` (19):
  auth gates, per-role totals/actor-exclusion proofs, peer-HEAD
  invisibility, broadening impotence with list-parity checks,
  suspended behavior both sides, 422/404 matrix, default-period
  exclusion, inclusive from/to boundaries (ms precision),
  zero-filled buckets, 366-day rejection, empty-scope zeros,
  exact breakdown arrays, read-contract stability.
* New/extended admin suites: `audit.service` summary cases,
  `AuditDashboardPage` (render/cards/chart/tables/recent,
  filter mapping, allowlist proof, clear, SA-only company
  field, HEAD/MEMBER loads, states, mutation-control
  absence), router registration + four-role + CUSTOMER +
  nav cases. Full backend suite and full admin suite green;
  ESLint strict clean. Two self-caught test-counting defects
  fixed (provisioning-audit rows are in-window company data;
  SYSTEM actor bucket).
* No migration (`migrate status`: still 15 applied, in sync),
  no reset/push/upgrade/commit/push. JWT/refresh, mutations,
  histories, permissions, retention, deletion, and RBAC
  untouched.

### AS.6. Deferred work (unchanged)

Per-actor drill-through, custom date presets beyond from/to,
larger export-style unbounded analytics, scheduled
digest emails, billing/mobile. The 10-actor cap and 366-day
span cap are the single knobs if volumes ever demand
revisiting.

---

## AT. PHASE 2C-25 STATUS RECORD — SUPER ADMIN COMPANY MANAGEMENT UI

Phase 2C-25 status is COMPLETE: the admin application serves a
SUPER_ADMIN-only `/companies` page on top of the completed
backend company module (§AJ/AK/AO) with no backend change of
any kind. Backend authorization semantics, audit visibility,
retention, export, and analytics behavior are untouched.

### AT.1. Frontend surface (existing conventions only)

* Route `/companies` under the existing SUPER_ADMIN
  `ProtectedRoute` branch (`admin/src/routes/router.jsx`);
  System-section nav item (`Companies`, SUPER_ADMIN-only) and
  `Companies` header title in `AdminLayout.jsx`. ADMIN/HEAD/
  MEMBER never see the item; rejected callers flow through the
  unchanged role-aware landing (no login↔route loop; the
  four-role panel admission from Phase 2C-22R is unchanged, as
  are `/audit-logs`, `/audit-dashboard`, and retention
  behavior).
* `services/company.service.js` (explicit methods over the real
  envelopes) → `stores/useCompanyStore.js` (server-driven
  list/filter/pagination, refetch-after-mutation, named
  `mutating` duplicate-submit guard) → `pages/CompaniesPage.jsx`
  (`PageHeader`/`Table`/`Pagination`/`Modal`/`Field`/`Input`/
  `Badge`/`ErrorState`/`EmptyState`, sonner toasts). No raw API
  calls in the page, no new dependencies.

### AT.2. Exact payloads (backend contracts §AJ.1/AK.2/AO.2)

* `GET /companies?page/limit/search/status` (paginated envelope;
  aggregate metadata rows only — no operational data).
* `POST /companies { name }` (trimmed; no id/status/adminUserId/
  companyId — UUID + ACTIVE assigned server-side).
* `POST /companies/:id/suspend` and `POST /:id/restore`
  (empty bodies; 409 conflicts surfaced, list refreshed).
* `POST /companies/:id/admin`
  `{ email, password, firstName, lastName?, phone? }` (empty
  optionals dropped; safe admin returned — no credential
  displayed, copied, logged, or persisted).
* `POST /companies/:id/admin/password { password }` (route id
  only — no companyId/userId in the body; request-only value,
  never rendered or stored). A pre-existing scaffold defect
  used PATCH here; fixed to the documented POST before tests.
* `DELETE /companies/:id { confirmName }` (exact body only —
  no force flags, no UUID substitutes, no client cascade).

### AT.3. Permanent-deletion safeguards

Ghost-icon control (never primary), rendered only for
SUSPENDED companies and never for protected Company #1
(`35b5a215-…` by UUID via shared `PROTECTED_COMPANY_ID` /
`isProtectedCompany` — never by name). The dialog states
deletion is permanent and irreversible, keeps the confirm
disabled until the entry matches exactly (mismatch/Cancel
never reach the API), and the store surfaces
`COMPANY_PROTECTED` / `COMPANY_NOT_SUSPENDED` /
`COMPANY_CONFIRMATION_MISMATCH` / `COMPANY_NOT_FOUND` as
toasts with list refresh. Suspension vs deletion stay
distinct in every label and toast.

### AT.4. Verification

* New admin suites: `company.service` (exact endpoints/bodies,
  POST-not-PATCH proof, deletion body, #1 guard),
  `useCompanyStore` (load/error, validation, transition
  conflicts, duplicate-submit, no credential persistence, no
  client cascade), `CompaniesPage` (aggregate-only rendering,
  loading/error+retry/empty states, all six action flows,
  ACTIVE + #1 delete absence, mismatch/Cancel safety,
  success-removes-row), router `/companies` registration
  (SUPER_ADMIN entry, ADMIN/HEAD/MEMBER/CUSTOMER denial,
  loop-free ADMIN landing, audit branches unchanged).
* Extended: `AdminLayout` nav (SUPER_ADMIN gains Companies;
  all other roles unchanged). Full admin suite green; ESLint
  strict clean. No backend test touched, no migration, no
  reset/push/upgrade, no commit/push, no manual browser
  testing.

### AT.5. Deferred work (unchanged)

Per-company detail/aggregate view beyond the list, domain
management, branding/configuration management, billing/
subscriptions, custom roles, mobile contract. Suspension
enforcement, audit, retention, export, dashboard, and RBAC
wiring are untouched.

---

## AU. PHASE 2C-26 IMPLEMENTATION RECORD — CROSS-COMPANY CUSTOMER IDENTITY & LOGIN DISAMBIGUATION

Phase 2C-26 status is COMPLETE: a CUSTOMER can hold an account in
Company A and independently another account with the same email in
Company B. `User.email` is unique per `(companyId, email)` — never
globally. Proven by 45 dedicated tests (17 unit + 28 integration)
within a 72-file / 764-test green suite. One forward migration,
DDL-only, no data rewrite. No frontend changes (contracts
unchanged; Host is browser-sent, company never client-selected).

### AU.1. Final identity model (and why)

* CUSTOMER uniqueness: `@@unique([companyId, email])` on `users`
  (normalized trim+lowercase at validation+service, as before) plus
  a plain `@@index([email])` for cross-company lookups. Same email
  in different companies coexists; same company never duplicates
  (DB-enforced, P2002 race backstop mapped to the existing 409s).
* Staff/platform rule: SUPER_ADMIN/ADMIN/HEAD/MEMBER emails stay
  globally unique by application invariant — `provisionCompanyAdmin`
  and `provisionEmployee` reject any email held by any user with
  409 `USER_EMAIL_EXISTS` (previously the global unique did this via
  P2002; the P2002 mapping stays as the race backstop, with the
  `admin_user_id` discrimination unchanged). At most one staff row
  ever carries an email, so staff login is deterministic.
* Within one company an email maps to at most one user of any role
  (compound unique), so domain-scoped resolution is unambiguous.
* Rejected alternatives: a separate customer-identity table (dual
  writes, profile-email divergence, OTP/audit retargeting — not the
  smallest change); `NULLS NOT DISTINCT`/partial indexes (MySQL and
  MariaDB cannot express them); a sentinel platform company for
  SUPER_ADMIN (distorts platform semantics: platform audit
  `companyId NULL`, platform context); keeping global `email`
  with synthesized customer values (corrupts display email, audit
  snapshots, OTP targets).

### AU.2. Domain-derived authentication (no JWT change, no client company)

* `resolvePublicCompanyContext` now also runs on `POST /auth/login`,
  `/forgot-password`, `/verify-reset-otp`, `/reset-password`
  (register/Google already had it). Deliberately NO
  `requireActiveCompany` there: suspension/inactive gating stays in
  the service AFTER credential verification, preserving exact
  password-first semantics. Controllers pass only the
  server-attached context (`companyIdOf`); request body/query/header
  `companyId` is stripped or ignored as before.
* Login candidates: scoped requests try the company row first
  (correct-domain session wins even for identical email+password
  elsewhere), then the global staff row (staff login works from any
  host, as before). Unscoped requests try the staff row, else the
  single non-staff row when exactly one exists (legacy behavior
  byte-identical), else fail closed with neutral 401. Password
  decides between coexisting rows; which rows existed is never
  revealed. JWT stays `{ sub, roles }` / `{ sub, jti }` — no
  companyId, no claim changes; refresh, rotation, concurrency,
  watermark, Argon2id, and rate limits untouched.
* Registration: scoped requests 409 only when (company, email) is
  taken (staff or customer — one company never holds two identities
  for one email); unscoped requests keep global 409 semantics.
  Unregistered hosts still create legacy null-company customers.
* Google: scoped requests link the (company, email) row (any role),
  else the global staff row, else create a CUSTOMER in the domain
  company. Unscoped keeps legacy link-or-create and fails closed
  with new neutral 409 `AUTH_GOOGLE_AMBIGUOUS_IDENTITY` (directs to
  the company storefront; the holder proved email ownership, so
  nothing new is revealed) when several non-staff rows share the
  email. No per-company Google client config exists (P.6 allowlist
  never implemented); the domain company is the only scoping
  signal, and Google `sub` is still not stored.
* Recovery: `resolveRecoveryTarget` mirrors login scoping
  (scoped row; unscoped staff-then-single, else no target with the
  identical uniform 200). OTP rows are keyed by userId, so a code
  issued for Company A can never verify against Company B. The
  authenticated change flow is untouched (session userId identity).
* Audit: snapshots resolve by userId (`resolveActorSnapshot`),
  so duplicate emails cannot blur actor identity; per-account
  actorIds verified for same-email resets. No projection change.

### AU.3. Migration and data strategy

* One migration,
  `20261004120000_phase2c26_customer_identity`: drops
  `users_email_key`, adds `users_company_id_email_key`
  (`company_id`, `email`) and `users_email_idx` (`email`).
  Pre-apply verification: 4827 users, zero duplicate
  (company_id, email) pairs — DDL-only, no UPDATEs, no backfill,
  no account changes. `migrate deploy` applied; `migrate status`
  reports 16 applied, in sync; schema↔DB diff shows zero drift on
  `users` (the single remaining diff item,
  `notifications_order_id_fkey`, predates this phase and comes
  from the September notifications migration — untouched).
* Existing Company #1 users (incl. the ADMIN link), staff
  accounts, legacy null-company accounts, and suspended-company
  gating all authenticate exactly as before (proven by the
  unchanged suites plus dedicated integrity tests: #1 intactness,
  no duplicate (company, email) pairs, no staff email shared by
  two staff rows).
* Dev-DB hygiene (not a migration): eleven leaked `company_domains`
  rows were removed (`localhost`, `127.0.0.1` → Company #1, plus
  nine `tstcdmus*` leftovers) — test-fixture residue with no
  creator in code, seed, or migrations, contradicting the
  documented R.5 zero-domain state. Ten existing suites asserted
  Company #1's storefront through ambient localhost resolution;
  they now register explicit RUN-unique test domains (hermetic,
  cleaned up), which is the documented fail-closed posture for
  unregistered hosts.

### AU.4. Security invariants (tested)

* Email alone is never the customer identity key (domain scope +
  password decide); `companyId` from body/query/header never
  overrides domain context (stripped/ignored, proven per flow).
* No cross-company login, reset, or enumeration: wrong-company
  credentials are neutral 401; unknown/ambiguous emails get the
  identical uniform 200 with no mail; A's OTP is invalid on B.
* Staff identity can never blur: global staff-email invariant plus
  staff-first candidate ordering; multi-role rows resolve as staff
  deterministically.
* Suspension still blocks session start/renewal/rotation for the
  scoped account; unscoped sole-account semantics preserved
  (correct-password suspended login is still 403, as before).

### AU.5. Verification

* New `tests/unit/customer-identity.test.js` (17): staff
  vocabulary, `isStaffUser`, scoped/unscoped candidate ordering
  (incl. same-password determinism, ambiguous fail-closed), JWT
  no-companyId lock.
* New `tests/integration/customer-identity.test.js` (identity,
  staff determinism, scoped registration, integrity) and
  `tests/integration/customer-identity-recovery.test.js`
  (scoped recovery incl. per-account watermark isolation and
  audit actor proof, scoped Google incl. ambiguous 409,
  suspension/session binding) — 28 together, each under the
  shared 30-request auth rate budget by design.
* Updated: `domain-resolution` (cross-company registration now
  201 + same-company 409), `customer-resources-isolation`
  (scoped twin registration; ADMIN list/search now prove
  twin-in-A scoping), ten storefront suites (explicit test
  domains), `findUnique({ email })` → `findFirst` everywhere.
* Full backend suite green (72 files / 764 tests); `migrate
  status` in sync; no reset/push/upgrade/commit/push; no manual
  browser testing; no frontend changes (admin/customer suites
  unaffected — contracts byte-identical except the additive
  Google 409, recorded in API_CONTRACT_MATRIX).

### AU.6. Deferred work (unchanged)

Login disambiguation UX beyond neutral codes (e.g. explicit
account choosers — requires a contract change, not smuggled in
here); per-company Google client allowlist (P.6); duplicate-email
login UX copy; OTP/email retention worker; billing/mobile. The
accepted residuals: a same-millisecond legacy null-company
double-registration race (app-checked, no DB guard possible for
NULL pairs on MySQL/MariaDB) and 15-minute access-token survival
after rotation (pre-existing).

---

## AV. PHASE 2C-27 IMPLEMENTATION RECORD — SUPER ADMIN COMPANY DOMAIN MANAGEMENT

Phase 2C-27 status is COMPLETE: SUPER_ADMIN manages the
`CompanyDomain` registry introduced in Phase 1 (§R.1) through four
endpoints under the existing companies module — no schema change,
no new resolution mechanism, no customer-URL change, no second
normalization. Proven by 30 dedicated integration tests within a
green full backend suite plus 33 new admin tests (service/store/
page), with all domain-resolution, customer-identity, suspension,
deletion, and audit suites still green.

### AV.1. Discovered model and behavior (no invention)

* `CompanyDomain`: `id` UUID; `companyId` FK → `companies.id`
  `onDelete: Cascade`; `domain VARCHAR(255)` `@unique` (one
  hostname belongs to at most one company, globally DB-enforced);
  `isPrimary` default false; `isActive` default true;
  `@@index([companyId])`. Multiple domains per company were
  already supported (Phase 2C-11 fixtures use two active plus one
  inactive for one company).
* Exactly-one-primary was declared as a future
  application-enforced invariant (§R.1: "MySQL has no partial
  unique index") and enforced NOWHERE before this phase — the
  runtime resolver ignores `isPrimary` entirely and matches only
  `{ domain, isActive: true }`. This phase implements the
  invariant in the management write path (AV.3); the resolver is
  byte-identical.
* Inactive domains remain registered rows (the `isActive` flag is
  the zero-downtime cutover mechanism); only ACTIVE domains
  resolve publicly. Suspension is orthogonal: the resolver exposes
  `company.status` and `requireActiveCompany` blocks — domain
  rows are never altered by suspend/restore. Permanent deletion
  cascades domains with the company row (§AO) — no second cleanup
  exists or was added.
* No seeding precedent: Company #1 holds zero domains by
  documented decision (§R.5/AU.3); a company with zero domains
  (or zero active domains) is therefore a legal state, not an
  error — the API never forces a minimum-domain rule.
* No domain CRUD existed under any module (verified by codebase
  search: only `findActiveDomainWithCompany` plus fixture writes).

### AV.2. Normalization (single implementation reused)

* The API canonicalizes through the Phase 2C-11
  `normalizeHostname` (`src/middleware/companyContext.js`),
  imported by `companies.service.js` — no second implementation.
  Verified behavior: trim + lowercase; one trailing dot
  stripped; numeric `:port` stripped; bracketed IPv6 with
  optional port accepted; rejects empty/whitespace-only,
  over-long (>253), multi-label-malformed, multi-colon,
  scheme/credential (`://`, `@`), path/query/fragment,
  whitespace-containing, non-numeric-port, label-violating, and
  company-UUID values. Protocol prefixes, paths, and full URLs
  are therefore rejected, never stored.
* Zod trims (and length-bounds) the raw input; the service maps a
  null canonical form to 422 `COMPANY_DOMAIN_INVALID`. Frontend
  trimming is UX only. Duplicate detection runs on the canonical
  form, so ` Shop-A.TEST. ` collides with `shop-a.test`.

### AV.3. Primary/active lifecycle (smallest consistent set)

* Create `{ domain }` only: first domain of a company becomes
  primary in the same transaction (count + insert share one
  `tx`); later domains are secondary. `companyId`, `isPrimary`,
  `isActive`, `userId`, status overrides, and force flags are
  rejected by strict schemas — ownership derives from the route
  company id plus the row's own `companyId` comparison.
* Promote via `PATCH { isPrimary: true }`: demote-siblings +
  promote-target commit in ONE transaction (concurrent promotions
  serialize to exactly one primary — last-writer-wins; a bounded
  P2034 deadlock-victim retry covers the MySQL 1213 loser path).
  Promoting the current primary is an idempotent no-op success.
* Demote via `PATCH { isPrimary: false }` on a primary is
  rejected (409 `COMPANY_DOMAIN_PRIMARY_REQUIRED` — promote a
  successor instead); on a non-primary it is a no-op success.
  Empty PATCH bodies are rejected (422 `VALIDATION_ERROR`).
* `isActive` is orthogonal to `isPrimary`: deactivation keeps
  the primary flag (reactivation restores routing with no
  promotion), stops public resolution per the unchanged resolver,
  and touches no company or operational data. Mutations are
  allowed on SUSPENDED companies (platform management, like
  suspend/restore/delete); `requireActiveCompany` stays the
  authoritative suspension gate, so a new active domain on a
  suspended company still resolves to a blocked storefront
  (proven: 403 `COMPANY_SUSPENDED` while suspended, 200 after
  restore).
* Delete: non-primary domains and the sole remaining domain may
  be removed (200 `{ deleted: { id, domain } }`); removing a
  primary while siblings exist is rejected (409
  `COMPANY_DOMAIN_IS_PRIMARY` — promote another first). Removal
  deletes only the registry row (audited); the company, users,
  and operational data are untouched (proven by counts).
* Cross-company: PATCH/DELETE of a foreign `domainId` under
  another company's route id returns neutral 404
  `COMPANY_DOMAIN_NOT_FOUND` (no existence oracle) with the
  target row byte-identical; re-registration of a taken hostname
  anywhere returns 409 `COMPANY_DOMAIN_EXISTS` (pre-check plus
  the global unique as the concurrent-registration race
  backstop) and never moves ownership.

### AV.4. API contracts

* All four routes share the companies platform chain
  (`authenticate → resolveCompanyContext →
  authorize("SUPER_ADMIN")`, deliberately no
  `requireActiveCompany`): `GET /api/v1/companies/:id/domains`
  → 200 `{ domains[] }`; `POST /api/v1/companies/:id/domains`
  `{ domain }` → 201 `{ domain }`; `PATCH
  /api/v1/companies/:id/domains/:domainId`
  `{ isActive?, isPrimary? }` (at least one) → 200 `{ domain }`;
  `DELETE /api/v1/companies/:id/domains/:domainId` → 200
  `{ deleted: { id, domain } }`. Success envelope unchanged
  (`{ success, data }`); Zod failures stay 422
  `VALIDATION_ERROR` via the shared handler.
* Domain shape: `{ id, domain, isPrimary, isActive, createdAt,
  updatedAt }` — no `companyId` echo, no company secrets, no
  operational data (consistent with the list/detail domain
  projections in §AJ).
* New error codes (all in the established `COMPANY_*` family;
  no existing code could represent them): 404
  `COMPANY_DOMAIN_NOT_FOUND`, 422 `COMPANY_DOMAIN_INVALID`,
  409 `COMPANY_DOMAIN_EXISTS`, 409 `COMPANY_DOMAIN_IS_PRIMARY`,
  409 `COMPANY_DOMAIN_PRIMARY_REQUIRED`. Reused unchanged:
  401/403 auth codes, 404 `COMPANY_NOT_FOUND`, 422
  `VALIDATION_ERROR`. Recorded in `API_CONTRACT_MATRIX.md`.
* Frontend surface (no route/nav change — the existing
  SUPER_ADMIN `/companies` branch): per-row `Domains` control →
  registry modal (domain `Table` with `Primary`/`Secondary`
  + `Active`/`Inactive` badges, add-domain form sending exactly
  `{ domain }`, `Make primary`/active toggles, inline
  remove-confirmation, primary-with-siblings trash disabled with
  reason, suspended-company note). Every mutation refetches the
  registry and the company list; `mutating`
  (`domain-create`/`domain-update`/`domain-delete`) disables
  controls against duplicate submits; backend conflicts surface
  as toasts with the modal staying open.

### AV.5. Audit and deletion interaction

* Successful create/update/delete emit `COMPANY_DOMAIN`
  `CREATED`/`UPDATED`/`DELETED` (the resource was already in the
  audit vocabulary, previously unemitted) with server-derived
  actor snapshot and `companyId` = owning company (company-scoped
  rows purge with the company per §AO; the platform company
  `DELETED` record stays `companyId NULL`). Details carry only
  `{ domain }` plus toggled flags — no secrets. The row commits
  inside the mutation transaction; failed mutations emit nothing
  (established mutation-wide policy preserved). Reads are not
  audited.
* Permanent deletion interaction: unchanged §AO cascade —
  verified by regression test that a deleted company's domains
  (active and inactive) are gone and resolve to nothing, with
  Company #1 untouched. No second cleanup mechanism added.

### AV.6. Verification

* New `tests/integration/company-domains.test.js` (30):
  role matrix on all four endpoints (SUPER_ADMIN allow;
  ADMIN/HEAD/MEMBER/CUSTOMER 403; anonymous 401), unknown-company
  404s, query/header/body companyId override attempts, exact
  create shape, canonicalization cases, same/cross-company
  duplicates, 12 malformed forms, first-primary/secondary
  assignment, atomic promotion, demote guards, empty-body and
  smuggled-field rejection, concurrent promotions (exactly one
  primary) and concurrent duplicate creates (one 201 + one
  409), deactivation-stops-resolution with sibling continuity,
  owner-only resolution, suspension override + mutation-while-
  suspended, domain-scoped customer registration, cross-company
  PATCH/DELETE neutrality, no-silent-reassignment, primary/solo/
  unknown deletion paths, deletion-without-data-loss,
  cascade-sweep on permanent deletion, audit shape/attribution/
  no-secret/no-failure-event proofs.
* Regression: domain-resolution (unit + integration),
  companies-lifecycle, company-deletion, suspension-enforcement,
  storefront-isolation, customer-identity (both), and audit
  (log/read/retention/instrumentation/export/summary) suites
  green; full backend suite green; full admin suite green
  (incl. 12 new CompaniesPage domain tests, 7 store, 6
  service); admin ESLint strict clean; `prisma migrate status`
  in sync with zero schema changes (no migration — existing
  `CompanyDomain` fields sufficed).
* One investigation note: concurrent promotions deadlocked on
  first implementation (MySQL 1213); fixed with the bounded
  P2034 retry above — not with lock-ordering tricks or raw SQL,
  so Prisma-managed `updatedAt` semantics are untouched.

### AV.7. Deferred work (unchanged)

Domain verification (DNS/TLS challenge flow — deployment
infrastructure per §P.5), bulk import, per-company domain
quotas, domain-scoped rate limiting, Company #1 seeded
production hostname (still needs the real hostname input per
§R.5), customer-facing domain UX. The accepted residual: a
delete-sole-primary racing a concurrent first-registration can
leave one non-primary domain (repairable by promoting it);
both operations remain individually correct.

## AW. Phase 2C-28 — Company/Domain lifecycle hardening & cross-tenant verification (COMPLETE)

Focused architectural audit + hardening pass over the
completed multi-company Company + CompanyDomain lifecycle
(2C-27 report unavailable — the current repository was
treated as the source of truth and inspected first; nothing
was rewritten). Only concrete gaps were fixed.

### AW.1. 2C-27 implementation discovered (inventory)

* Model: `CompanyDomain { id, companyId, domain @unique,
  isPrimary=false, isActive=true }`, `onDelete: Cascade`,
  `@@index([companyId])` (`prisma/schema.prisma`); created by
  migration `20261002075021_phase1_company_foundation`, schema
  ↔ migration in sync, no drift.
* One canonical normalizer: `normalizeHostname`
  (`src/middleware/companyContext.js`), imported by
  `companies.service.js` — no second implementation. Runtime
  resolver (`findActiveDomainWithCompany`: exact match +
  `isActive: true`) and management API agree on the canonical
  value (case/whitespace/trailing-dot/port canonicalization
  proven by tests; duplicates collide on the canonical form
  within and across companies).
* Endpoints (platform chain `authenticate →
  resolveCompanyContext → authorize("SUPER_ADMIN")`, no
  `requireActiveCompany` by design): `GET/POST
  /companies/:id/domains`, `PATCH/DELETE
  /companies/:id/domains/:domainId`; strict schemas reject any
  body `companyId`; ownership derives from the route id plus
  the row's own `companyId` (foreign ids → neutral 404).
* Semantics proven by existing tests: first domain primary,
  atomic promotion (concurrent-safe, P2034 retry), no demote-
  without-successor, `isActive` orthogonal to `isPrimary`,
  deactivation stops resolution without touching data,
  guarded deletion (primary-with-siblings blocked, sole
  domain removable), company cascade sweeps domains, scoped
  `COMPANY_DOMAIN` CREATED/UPDATED/DELETED audit with safe
  metadata, failures emit nothing.

### AW.2. Lifecycle invariants verified (no change needed)

* Cross-company routing isolation: A-domain → A context,
  B-domain → B context; query/body/header `companyId` and
  foreign path ids cannot override the resolved company
  (existing middleware, covered by company-domains,
  domain-resolution, tenant-hardening, isolation suites).
* Customer identity: same email coexists per company;
  A-domain + B credentials (and vice versa) fail; recovery
  OTPs are `userId`-keyed so A codes cannot reset B
  (customer-identity + recovery suites green).
* Suspension: public data, customer login/refresh/register,
  and staff auth blocked with `COMPANY_SUSPENDED`; domain
  does not bypass; SUPER_ADMIN platform routes unaffected
  (suspension-enforcement suite green). Raw static media
  stays servable by design — unchanged per the phase brief.
* Restore: active domains resolve again, auth works again,
  nothing recreated/duplicated, audit intact; restore does
  NOT reactivate independently-deactivated domains (proven
  by the new test below — previously the only untested
  combination).
* Primary: at most one per company, atomic change,
  last-writer-wins under concurrency; zero-primary allowed
  (sole-domain removal) per the existing design.
* Deletion: suspended-company cascade removes all
  CompanyDomain rows; no orphan resolver mapping; other
  companies untouched; platform `COMPANY/DELETED` survives
  per §AO.
* SUPER_ADMIN boundary: identity/lifecycle/domains/counts
  only — no operational rows in API or `/companies` UI.
* Frontend: SUPER_ADMIN-only nav/route, loop-free
  forbidden landing, exact mutation payloads, loading
  guards, refresh-after-mutation, inline delete confirm,
  toast/ErrorState conventions (133 focused admin tests
  green, no page redesign).

### AW.3. Concrete issues found and fixed

1. Misleading `COMPANY_DOMAIN_INVALID` message
   (`companies.service.js`): claimed rejection "without
   protocol, port, or path", but numeric `:port` is
   stripped and accepted (documented §AV.2 behavior,
   blessed by canonicalization tests). Fixed to
   "Domain must be a valid hostname without protocol or
   path". Code-only wording fix; status codes, contracts,
   and frontend behavior unchanged (no caller asserted
   the old text).
2. Uncovered invariant — restore vs independent
   deactivation: no test proved a domain deactivated
   while suspended stays inactive after restore. Added
   `tests/integration/company-domain-restore.test.js`
   (1 test): suspend with two active domains, deactivate
   one while suspended, restore, then assert routing
   follows domain state (active resolves, parked does
   not), exactly two rows with flags intact, live
   storefront reopened, and the 2 CREATED + 1 UPDATED
   audit events intact.

### AW.4. Verification

* New restore test: 1 passed. Focused suites green:
  company-domains (30), domain-resolution,
  companies-lifecycle, company-deletion,
  suspension-enforcement, customer-identity (both),
  company/domain context + tenant-hardening, all
  isolation suites (catalog/storefront/cart-order/
  customer-resources/order/cart-display/inventory/
  review-coupon/notification-broadcast/media-storage),
  audit (log/read/summary/export/retention/
  instrumentation/catalog/orders) + credential/user/
  password suites.
* Full backend suite: 74 files / 795 tests passed
  (one transient `audit-export` export-vs-list parity
  mismatch on the first full run — shared global
  `?companyId=null` scope raced with concurrent
  lifecycle writers; passed alone, with co-runners,
  and on full re-run; no production code implicated).
* Full admin suite: 52 files / 498 tests passed;
  admin ESLint strict clean; `prisma migrate status`:
  16 migrations, database up to date, no drift. No
  schema change, no migration, no new dependency.

### AW.5. Accepted residuals (explicit, unchanged by design)

* Static uploads bypass suspension (`express.static`
  before company middleware) — established static-media
  decision, not a regression.
* `POST /auth/google` gates suspension pre-token via
  `requireActiveCompany` while password login gates
  post-credential in-service (password-first 401 vs 403)
  — documented asymmetric design; register behaves like
  Google.
* `POST /auth/verify-reset-otp` validates code only;
  suspension/inactive enforced at completion — same
  possession-first shape as login.
* Company-scoped `COMPANY_DOMAIN` audit rows purge with
  the company (only platform `COMPANY/DELETED`
  survives) — §AO semantics.
* Unregistered/mis-forwarded `Host` keeps legacy
  behavior (`X-Forwarded-Host` deliberately ignored) —
  deployment requirement, not a code defect.
* Concurrent first-registrations of distinct domains on
  a domainless company could yield two primaries (count
  + insert race; promotions stay exactly-one) — narrow
  SUPER_ADMIN-only window, documented limitation.
* Pre-existing docs drift left untouched as out of
  scope: `API_CONTRACT_MATRIX.md` omits the eight
  non-domain company platform contracts;
  `DATABASE.md` omits Company/CompanyDomain/AuditLog
  tables and still declares superseded global uniques.
  (Superseded by §AX: reconciled in Phase 2C-30.)

## AX. Phase 2C-30 — Contract truth, documentation reconciliation & production cutover readiness

### AX.0. Basis (Phase 2C-29 audit)

The 2C-29 gap audit found no remaining security or tenant-isolation
defect and fixed the sole-ADMIN self-deactivation lockout
(`409 USER_SELF_DEACTIVATION` in `setUserActiveAdmin`, regression-tested).
It classified the load-bearing docs debt — stale phase statuses,
~20 missing `API_CONTRACT_MATRIX.md` contracts plus review/password
inaccuracies, and `DATABASE.md` omissions/superseded uniques — as the
highest-value next work, with Company #1 cutover guidance and one
narrow robustness fix (bulk-status P2034 retry). This phase executes
exactly that scope. No schema, migration, dependency, auth, suspension,
audit-semantic, or frontend-feature change.

### AX.1. API contract matrix reconciliation

`API_CONTRACT_MATRIX.md` now documents the live surface (each row
verified against its route/controller/validation; new/corrected rows
carry `impl:` source refs):
* 8 company platform contracts (`GET /companies`, `POST /companies`,
  `GET /companies/:id`, `POST /:id/suspend|restore`,
  `POST /:id/admin`, `POST /:id/admin/password`,
  `DELETE /:id`) alongside the existing 4 domain rows.
* Audit reads (`GET /audit-logs`), CSV export
  (`GET /audit-logs/export`), analytics (`GET /audit-logs/summary`),
  retention (`GET/PATCH /audit-retention`).
* Recovery/change (`POST /auth/forgot-password|verify-reset-otp|
  reset-password|change-password/otp|change-password`) with actual
  payloads and password-first error behavior.
* Returns (`POST|GET /orders/:orderId/returns`, `GET /returns`,
  `GET /returns/:id`), coupon history
  (`GET /coupons/:id/history`), bulk status
  (`PATCH /orders/admin/bulk-status`, atomic + P2034 retry),
  notification delete (`DELETE /notifications/:id`).
* Corrections: admin review surface is read-only
  (`GET /reviews/admin` only — no moderate/delete endpoints);
  public product-review listing exists
  (`GET /reviews/product/:productId`); ownership rule qualified
  with the documented `403` gates; `PATCH /users/:id` records
  `409 USER_SELF_DEACTIVATION`; §3/§4 payload/shape details added
  for every new row. No API behavior changed for documentation.

### AX.2. DATABASE.md reconciliation

* `users` gains `company_id` (nullable by design) +
  `password_changed_at` (credential watermark); the global-`email`
  unique is gone — `(company_id, email)` with staff-global by
  application invariant.
* `categories`/`products`/`product_variants`/`coupons` gain
  `company_id` (required); slugs/SKU documented company-scoped;
  `barcode` (manufacturer namespace), `coupons.code` (shared
  namespace), `company_domains.domain`, `orders.order_number`
  recorded as intentional globals.
* New sections: `coupon_usages` (§17.3), `coupon_histories`
  (§17.4), returns (§26E), password OTPs (§26F), companies +
  company domains (§26G), audit log + retention policy (§26H);
  ER overview (§18) extended; `returns`/`audit_logs` removed from
  the §26 must-not-add list; §28 scope lists the later additions;
  §19/§20 uniques/indexes match the composite reality. No schema
  or migration change.

### AX.3. Status reconciliation (this document)

Phase table: Phase 1 → COMPLETE, Phase 2 → COMPLETE (all slices
2A—2C-30), Phase 3 → PARTIAL (HEAD/MEMBER update/delete HTTP
endpoints missing), Phase 4/5/6 → COMPLETE (COD-only payments,
read-only returns, global retention by accepted scope),
Phase 7 → PARTIAL (OTP/credentials/domain runtime done; Google
allowlist + mobile contract deferred); 2C-29/2C-30 rows added.
§P: P.1—P.5/P.7 → IMPLEMENTED, P.8/P.9 → ADOPTED policy,
P.6 (Google allowlist) stays NOT IMPLEMENTED. §Q/§R-intro/§R.8
and the 2B-2 footer now state COMPLETE/current truth. Per-slice
"Overall Phase 2 stays NOT STARTED" footers converted to the
historical form ("was NOT STARTED at this point … now COMPLETE")
— history preserved, current state accurate. `ADMIN_ARCHITECTURE.md`:
category `?status` scopes, `parentId: null` promotion allowed,
and static-media serving corrected to match implementation.

### AX.4. Company #1 production cutover runbook (OPERATIONAL, not a migration)

No production call was executed and no hostname is invented here —
the operator substitutes the real production hostname at deploy time.

1. Register Company #1's real production hostname through the
   existing management API as a SUPER_ADMIN:
   `POST /api/v1/companies/35b5a215-0cf3-42db-ba42-6fac6656a708/domains`
   `{ "domain": "<prod-host>" }` (canonicalized server-side; first
   domain becomes primary). This is runtime data/configuration —
   never a Prisma migration.
2. The deployment/proxy must forward the actual intended `Host` to
   the backend. TLS terminates at the deployment's reverse
   proxy/ingress per the platform architecture; the backend stays
   plain HTTP behind it.
3. The backend intentionally does NOT trust `X-Forwarded-Host`
   (no trusted-proxy configuration in `src/app.js`): a proxy that
   rewrites `Host` breaks tenant resolution by design.
4. Unknown/unregistered hosts resolve to no company (legacy
   behavior preserved) and must not expose tenant storefront data —
   verify post-deploy with an unregistered `Host` (fail-closed read
   path, no existence oracle).
5. Suspension posture is unchanged by cutover: registered domains of
   a SUSPENDED company resolve to the `403 COMPANY_SUSPENDED` gate;
   direct static bytes under `storage/uploads` remain servable by
   design (accepted residual).

### AX.5. Bulk order-status P2034 robustness

`bulkUpdateOrderStatusAdmin` (`src/modules/orders/orders.service.js`)
now executes its single all-or-nothing transaction inside
`withTransactionRetry`: P2034-only, max 4 attempts, `10ms × attempt`
backoff — mirroring the CompanyDomain `withWriteRetry` pattern
without importing it (no new cross-module coupling, no generic
framework). Safe because the victim transaction rolls back fully
and the re-execution re-reads + re-validates every order in-tx
(conditional `updateMany` converts genuine races to 409, never
double-applies). Boundaries, scoping, transition validation,
atomicity, one-history/one-notification/one-audit-per-order, and
response contracts are unchanged; non-P2034 errors never retry.
Regression: `tests/unit/transaction-retry.test.js` (4: first-try,
P2034-then-success, non-P2034 passthrough, 4-attempt cap) and
`tests/integration/order-bulk-status-retry.test.js` (overlapping
concurrent bulks settle to one 200 + one 409 with exactly-once
effects per order; illegal bulks still fail atomically with no
writes).

### AX.6. Verification (Phase 2C-30)

* New tests: unit 4/4, retry integration 2/2 (plus 3× repeat
  stability runs).
* Focused: order-bulk-status, audit-instrumentation-orders,
  admin-users-reviews, company-domains suites green.
* Full backend suite: 76 files / 802 tests passed.
* Full admin suite: 52 files / 498 tests passed (unchanged surface).
* Admin ESLint strict clean. `prisma migrate status`: 16
  migrations, up to date, no drift — no migration created.
* Docs spot-check: every added matrix row maps to a mounted route
  (verified in §§AX.1—AX.2); no documented endpoint is
  nonexistent; no live endpoint in scope is undocumented; no
  FUTURE/DEFERRED item marked complete (Phase 3 PARTIAL, Phase 7
  PARTIAL, P.6 NOT IMPLEMENTED all explicit).

## AY. Phase 2C-31 — HEAD/MEMBER user-management HTTP API (COMPLETE)

Exposes the 2B-1 staff primitives over HTTP with hierarchy guards.
No schema change, no migration, no new dependency, no RBAC redesign,
no custom roles.

### AY.1. Gap (as found)

`provisionEmployee` (HEAD/MEMBER creation with `canManageRole`,
global staff-email invariant, hashing, in-transaction audit) had no
route. `setUserActiveAdmin` / `listUsersAdmin` / `getUserAdmin` were
ADMIN-only routes. Manager-driven profile update had no primitive
(self `updateProfile` only). MEMBER had — and keeps — no management
surface.

### AY.2. Endpoints (`src/modules/users/users.routes.js`)

Same chain throughout
(`authenticate → resolveCompanyContext → requireActiveCompany →
authorize(ADMIN, HEAD)`), company always from server context,
strict schemas reject `companyId`:
* `POST /users { email, password, firstName, lastName?, phone?,
  role: HEAD|MEMBER }` → 201 — delegates to `provisionEmployee`;
  ADMIN → HEAD/MEMBER, HEAD → MEMBER (`403` otherwise);
  unknown roles → `422`; staff-email collisions → `409`.
* `PATCH /users/:id { isActive }` → 200 — existing ADMIN behavior
  preserved byte-for-byte; HEAD callers resolve MEMBER targets only.
* `PATCH /users/:id/profile { firstName?, lastName?, phone? }` →
  200 — new MEMBER-only primitive for ADMIN + HEAD (no email /
  password / role / company / status fields accepted).
* `GET /users`, `GET /users/:id` → 200 — ADMIN unchanged; HEAD
  sees/resolves own-company MEMBERs only.
* Target rule (service `assertMemberOnlyTarget`): non-ADMIN callers
  get exactly-`["MEMBER"]` targets; HEAD/ADMIN/SUPER_ADMIN/CUSTOMER,
  multi-role, roleless, and foreign rows all read as neutral `404
  USER_NOT_FOUND` (response identical to unknown ids — no oracle).
  Self-deactivation stays `409 USER_SELF_DEACTIVATION` for every
  role (checked before the target gate, no read needed).

### AY.3. Audit and validation

* Create: existing in-transaction `CREATED/USER` (email, role, via).
* Profile update: new post-commit `UPDATED/USER` with field NAMES
  as a sorted CSV string (the writer rejects arrays) — never values
  or credentials. Lifecycle: existing `DEACTIVATED/REACTIVATED`.
  Failures (403/404/422/409) emit nothing, per policy.
* Reused codes only: `USER_NOT_FOUND`, `USER_EMAIL_EXISTS`,
  `USER_PROVISION_INVALID`, `USER_UPDATE_INVALID`,
  `USER_SELF_DEACTIVATION`, `AUTH_FORBIDDEN`. No new taxonomy.

### AY.4. Verification

* New `tests/integration/head-member-management.test.js` (20):
  HEAD create (shape/company/role/hash/login), escalation rejections
  (422 unknown roles, 403 HEAD→HEAD), companyId smuggling immunity
  (strict 422 + query/header ignored), ADMIN HEAD/MEMBER parity,
  role denials (MEMBER/CUSTOMER/SUPER_ADMIN 403, anon 401),
  profile update + identity-field rejections, deactivate/login-block/
  reactivate/login cycle, HEAD self-deactivation 409, five
  boundary targets neutral-404 with byte-identical bodies and
  untouched rows, foreign-vs-unknown indistinguishability,
  MEMBER/CUSTOMER 403s, MEMBER-scoped list/detail, audit shape +
  no-secret + no-failure-event proofs.
* Regression: admin-users-reviews, user-provisioning, audit and
  isolation suites green; full backend + admin suites green;
  ESLint clean; `prisma migrate status` up to date, no drift.
* Docs: `API_CONTRACT_MATRIX.md` users rows + §3/§5/§6 updated
  with `impl:` refs; `admin customer.service.js` header comment
  corrected (HEAD-served endpoints noted; Customers UI stays
  ADMIN-gated). No `ADMIN_ARCHITECTURE.md` change required (no
  staff-management contract section exists there; UI gating
  unchanged). No customer-frontend change.

## AZ. Phase 3-1 — First operational RBAC slice: categories (COMPLETE)

First controlled wiring of the `permissions.js` TARGET grants to
operational routes. Categories chosen per the brief's candidate
order: smallest coherent domain whose service is role-agnostic
(company predicates + actor snapshots only, no ADMIN assumptions).

### AZ.1. Audit mapping (ROLE × RESOURCE × ACTION × ROUTE)

Grants used verbatim from `permissions.js` (no matrix change needed):
HEAD `category:CREATE/READ/UPDATE/DEACTIVATE`, MEMBER
`category:CREATE/READ/UPDATE`. Reads stay public; `?status=
inactive|all` stays ADMIN-only (`requireAdminForInactiveScope`
untouched); SUPER_ADMIN/CUSTOMER excluded everywhere (403/401).
* `POST /categories` → ADMIN/HEAD/MEMBER (`categories.routes.js`).
  MEMBER submitting `isActive:false` → `403` (creating an inactive
  row is an active-state write, not plain CREATE).
* `PATCH /categories/:id` → ADMIN/HEAD/MEMBER. Any explicit
  `isActive` (flip or re-affirmation) → ADMIN/HEAD only, MEMBER
  `403` (`assertMayWriteActiveState` in `categories.service.js`;
  controller now passes `roles` through the actor object).
* `DELETE /categories/:id` (soft-deactivate, never a hard delete)
  → ADMIN/HEAD only (MEMBER `403` at `authorize`, no service
  check needed).
* `POST|DELETE /categories/:id/image` → ADMIN/HEAD/MEMBER as the
  category UPDATE action (field write under the managed prefix;
  removal idempotent). No new deletion behavior created.
* Not wired (stay ADMIN-only): products, variants, product images,
  inventory, orders/status/payment/bulk, returns, coupons, marketing,
  announcements, company/audit/retention governance, user
  provisioning paths. No `authorize("ADMIN")` was broadened beyond
  the five category routes above.

### AZ.2. Authorization/isolation/audit behavior

Chain preserved on every touched route (`authenticate →
resolveCompanyContext → requireActiveCompany → authorize(...)`);
company from server context only (strict schemas reject body
`companyId`, query/header ignored — tested); suspension gate
unchanged (tested on a SUSPENDED company); cross-company ids read
as neutral `404 CATEGORY_NOT_FOUND` (tested, rows byte-identical).
Mutations keep their existing `CATEGORY`
`CREATED/UPDATED/DEACTIVATED/REACTIVATED` events with HEAD/MEMBER
actor snapshots and safe `{ name }` details; refused mutations
emit nothing (tested). No secret fields surface (safe projection
unchanged, scanned in tests).

### AZ.3. Frontend

No change. Catalog pages/routes/nav stay ADMIN-gated
(`router.jsx` operational branch, `AdminLayout` `ADMIN_ONLY`);
HEAD deep-links meet the pre-existing redirect — no new breakage,
no new pages. HEAD catalog UI remains explicit follow-up work.

### AZ.4. Verification

* New `tests/integration/catalog-rbac.test.js` (14): per-role
  create/update/deactivate matrices, MEMBER `isActive` refusals
  (create + both flip directions, rows/audit untouched),
  CUSTOMER/SUPER_ADMIN/anonymous refusals, smuggling immunity,
  suspension block, cross-company neutrality, image upload/remove
  by HEAD/MEMBER + CUSTOMER refusal, audit role/metadata/secret
  proofs, no-failure-event proof.
* Regression: catalog-isolation, tenant-hardening,
  audit-instrumentation-catalog, suspension-enforcement,
  storefront-isolation, permissions unit suites green; full
  backend + admin suites green; ESLint clean; `prisma migrate
  status` up to date, no drift, no migration.
* Docs: `API_CONTRACT_MATRIX.md` category rows + §5 updated;
  no `ADMIN_ARCHITECTURE.md` change required (catalog UI
  contracts unchanged); no customer-frontend change.

## BA. Phase 3-2 — Second operational RBAC slice: products (COMPLETE)

Wires the `permissions.js` product grants (HEAD
`product:CREATE/READ/UPDATE/DEACTIVATE`, MEMBER
`product:CREATE/READ/UPDATE`) to the product + product-image
routes, following the Phase 3-1 pattern. No matrix change, no
schema/migration change, no new taxonomy.

### BA.1. Route/action mapping (verified against code + matrix)

* `POST /products` → ADMIN/HEAD/MEMBER. MEMBER submitting
  `isActive:false` on the product or on any nested creation
  variant → `403` (creating inactive rows is an active-state
  write, not plain CREATE); the omitted-default (active) is
  unaffected. Nested variants inherit the company atomically as
  before (part of product CREATE, not the standalone variant
  endpoints).
* `PATCH /products/:id` → ADMIN/HEAD/MEMBER. Any explicit
  `isActive` (flip or re-affirmation) → ADMIN/HEAD only, MEMBER
  `403` (`assertMayWriteProductActiveState`; controller passes
  `roles` through the actor object). Guarded-deactivation path
  (`PRODUCT_HAS_ACTIVE_ORDERS`), reactivation, slug/category
  gates, and audit classification unchanged.
* `DELETE /products/:id` (delete-confirm on inactive rows — the
  hard DELETE action) → ADMIN only. HEAD/MEMBER hold no
  `product:DELETE` grant and are refused by the role gate before
  any lifecycle logic runs.
* Variant `POST|PATCH|DELETE` → ADMIN only (later slice, untouched).
* Product image `POST /` + `PATCH /:imageId` → ADMIN/HEAD/MEMBER
  as the product UPDATE action (company-scoped product gate,
  primary-image invariants, transactions, and cleanup unchanged).
  Image `DELETE` (hard file + row delete) → ADMIN only.
* Reads stay public; inactive/all scopes stay ADMIN-only;
  SUPER_ADMIN/CUSTOMER excluded everywhere.

### BA.2. Authorization/isolation/suspension/audit

Chain preserved on every touched route; company from server
context only (strict schemas reject body `companyId`,
query/header ignored — tested); suspension gate unchanged
(SUSPENDED → `403 COMPANY_SUSPENDED` — tested); cross-company
and unknown product/image ids read as the neutral pre-existing
404s with rows byte-identical (tested). Mutations keep their
`PRODUCT` `CREATED/UPDATED/DEACTIVATED/REACTIVATED/DELETED`
events (images: `UPDATED` with `imageOperation`) with HEAD/MEMBER
actor snapshots and safe metadata; refused mutations emit
nothing (tested); no secrets surface.

### BA.3. Frontend

No change (same posture as 3-1): catalog/product pages, routes,
and nav stay ADMIN-gated; no new pages; no customer-frontend
change. HEAD product UI remains follow-up work.

### BA.4. Verification

* New `tests/integration/product-rbac.test.js` (17): per-role
  create (incl. flags/variants/company stamp), MEMBER
  active-state refusals (product + nested variant + both PATCH
  directions, nothing stored/changed), CUSTOMER/SUPER_ADMIN/
  anonymous refusals, smuggling immunity (strict 422 + ignored
  query + foreign-category 404), guarded deactivate/reactivate
  by HEAD, ADMIN lifecycle parity (409 active, 200 confirm),
  delete-confirm + variant endpoints + image delete ADMIN-only,
  suspension block, cross-company neutrality (incl. role-gate-
  before-scope on ADMIN-only routes), image upload/metadata by
  HEAD/MEMBER + CUSTOMER refusal + foreign-image neutrality,
  audit role/metadata/secret/no-event proofs.
* Regression: product-lifecycle/stock/primary-image,
  catalog-isolation, audit-catalog, media-storage-isolation,
  variant-media-orders, suspension suites green; full backend +
  admin suites green; ESLint clean; `prisma migrate status` up
  to date, no drift, no migration.
* Docs: `API_CONTRACT_MATRIX.md` product/media rows + §5
  updated; no `ADMIN_ARCHITECTURE.md` change required (product
  UI contracts unchanged).

## BB. Phase 3-3 — Third operational RBAC slice: variants (COMPLETE)

### BB.1. Grant basis (no matrix change)

`permissions.js` contains no separate variant namespace — a
deliberate modeling choice, not an omission: variants are
product-sub-resource operations (P.3 denormalized `companyId`,
creation inside the product CREATE transaction, no standalone
reads). The product grants therefore cover the three standalone
endpoints, consistent with the Phase 3-2 nested-variant allowance
(MEMBER creates active nested variants under `product:CREATE`
while `isActive:false` is refused): HEAD
`product:CREATE/READ/UPDATE/DEACTIVATE`, MEMBER
`product:CREATE/READ/UPDATE`. No grant invented, none added.

### BB.2. Route/action mapping

* `POST /products/:productId/variants` → ADMIN/HEAD/MEMBER.
  MEMBER `isActive:false` → `403`; company inherited from the
  verified product.
* `PATCH /products/:productId/variants/:variantId` →
  ADMIN/HEAD/MEMBER. Any explicit `isActive` → ADMIN/HEAD only,
  MEMBER `403` (`assertMayWriteVariantActiveState`; controller
  passes `roles` through the actor object).
* `DELETE …/variants/:variantId` (soft-deactivate) →
  ADMIN/HEAD only (MEMBER holds no DEACTIVATE grant; refused by
  the role gate).
* Reads: variants surface nested in products (unchanged);
  SUPER_ADMIN/CUSTOMER excluded everywhere.

### BB.3. Nested-variant bypass analysis

Product PATCH accepts no `variants` field (strict schema → `422`),
so no update bypass exists. Product CREATE nests variants only
inside an allowed CREATE, with the 3-2 `isActive:false` refusal
intact for MEMBER (tested both paths). Standalone and nested
rules agree: active-state writes need DEACTIVATE, held by
ADMIN/HEAD only.

### BB.4. Isolation/suspension/audit

Chain preserved; company from server context (strict `companyId`
rejection, query/header ignored — tested); suspension gate
unchanged (`403 COMPANY_SUSPENDED` — tested); cross-company and
unknown variant ids read as neutral `404
PRODUCT_VARIANT_NOT_FOUND` with rows byte-identical (tested).
Mutations keep `PRODUCT_VARIANT`
`CREATED/UPDATED/DEACTIVATED/REACTIVATED` events with HEAD/MEMBER
snapshots, company scope, safe `{ sku }` details; refusals emit
nothing (tested); global-barcode `409`s keep pre-existing
semantics. No secrets surface.

### BB.5. Verification

* New `tests/integration/variant-rbac.test.js` (16): per-role
  create/update/deactivate matrices, MEMBER active-state
  refusals (standalone create, nested create, both PATCH
  directions, nothing stored/changed), CUSTOMER/SUPER_ADMIN/
  anonymous refusals, smuggling immunity, suspension block,
  cross-company + unknown neutrality (incl. role-gate layering),
  nested-bypass proofs (strict-422 PATCH, refused inactive
  nested create), audit role/metadata/secret/no-event proofs.
* One 3-2 test updated to the evolved contract (variant POST
  now 201 for HEAD/MEMBER instead of 403); no assertion
  weakened — coverage moved to the variant suite.
* Regression: product/catalog/variant/media/order/inventory/
  suspension/audit suites green; full backend + admin suites
  green; ESLint clean; `prisma migrate status` up to date, no
  drift, no migration.
* Docs: `API_CONTRACT_MATRIX.md` variant rows + §5 updated; no
  `ADMIN_ARCHITECTURE.md` change required; no frontend work.

## BC. Phase 3-4 — Fourth operational RBAC slice: inventory (COMPLETE)

Unlike 3-1–3-3, inventory carries an explicit namespace in
`permissions.js` — ADMIN + HEAD hold
`inventory:CREATE/READ/UPDATE/DEACTIVATE`, MEMBER holds
`inventory:CREATE/READ/UPDATE` — used verbatim, no matrix change.

### BC.1. Route/action mapping

* `POST …/inventory` (initialize = CREATE) → ADMIN/HEAD/MEMBER.
* `PATCH …/inventory` (adjust ±delta = UPDATE) → ADMIN/HEAD/MEMBER.
  Negative deltas included: insufficient stock stays business
  `409 INSUFFICIENT_STOCK`, invalid quantity stays `422` — auth
  and business validation never merge.
* `GET …/inventory`, `GET …/transactions`, `GET /inventory`
  (READ) → ADMIN/HEAD/MEMBER, all company-scoped as before.
* No inventory endpoint performs deactivation or deletion, so the
  DEACTIVATE grant wires nothing; no service guard was needed
  (the service is role-agnostic: variant-company gate + actor
  snapshots only). No endpoint created, none removed.
* Reads stay company-scoped; SUPER_ADMIN/CUSTOMER excluded
  everywhere; dashboard inventory routes untouched (separate
  module, still ADMIN-only).

### BC.2. Architecture preserved

Variant→inventory ownership chain (`companyContext → product/
variant → inventory`, denormalized `companyId`, write-once),
guarded-decrement transactions, ledger-first audit commits
(`CREATED` on init, `UPDATED` on adjust, in-transaction),
`INITIAL_STOCK`/adjustment ledger types, arithmetic, and
overflow/duplicate/conflict codes all byte-identical. Chain
order, suspension gate, strict schemas, and error taxonomy
unchanged.

### BC.3. Verification

* New `tests/integration/inventory-rbac.test.js` (13): per-role
  init/adjust/reads, MEMBER ±delta with quantity + ledger
  proofs, overdraw-409/zero-422/fraction-422 with state
  untouched, CUSTOMER/SUPER_ADMIN/anonymous refusals with
  nothing stored, suspension block with state untouched,
  foreign/unknown neutrality (incl. exact-body equality),
  body-422 + query/header-ignored smuggling, audit
  role/company/action/resource/metadata/secret/no-event proofs.
* Regression: inventory-isolation, dashboard-inventory (+guards),
  product/variant/catalog RBAC, suspension, audit-catalog suites
  green; full backend + admin suites green; ESLint clean;
  `prisma migrate status` up to date, no drift, no migration.
* Docs: `API_CONTRACT_MATRIX.md` inventory rows + §5 updated; no
  `ADMIN_ARCHITECTURE.md` change required; no frontend work.

## BD. Phase 3-5 — Fifth operational RBAC slice: orders + payments + bulk (COMPLETE)

### BD.1. Grant basis (no matrix change)

`permissions.js` grants a single `order:MANAGE` action to
ADMIN/HEAD/MEMBER (CUSTOMER keeps `order:CREATE/READ` on the
customer checkout/history routes). There is no payment namespace —
payment mutation (`PATCH /orders/admin/:id/payment`) is an order
lifecycle operation under `order:MANAGE`. The matrix draws no finer
distinction, so all five company order routes share one
authorization; lifecycle, payment, bulk, retry, and audit semantics
stay role-agnostic in the service.

### BD.2. Route/action mapping

* `GET /orders/admin`, `GET /orders/admin/:id` (scoped reads) →
  ADMIN/HEAD/MEMBER.
* `PATCH /orders/admin/:id/status` → ADMIN/HEAD/MEMBER. Lifecycle
  validation (`ORDER_INVALID_STATUS_TRANSITION`,
  `ORDER_STATUS_UNCHANGED`, `ORDER_CONCURRENT_UPDATE`) unchanged.
* `PATCH /orders/admin/:id/payment` → ADMIN/HEAD/MEMBER. Payment
  state machine unchanged.
* `PATCH /orders/admin/bulk-status` → ADMIN/HEAD/MEMBER. Atomic
  all-or-nothing + P2034-only bounded retry + re-read/revalidate
  untouched (2C-30 helper not modified or generalized).
* Customer checkout/history/cancel routes unchanged (no authorize).
  SUPER_ADMIN/CUSTOMER excluded from `/orders/admin*` everywhere.

### BD.3. Isolation/suspension/audit

Chain preserved; company from server context (strict schemas
reject body `companyId`, query/header ignored — tested);
suspension gate unchanged (`403 COMPANY_SUSPENDED` — tested with
suspend/restore around the assertions); foreign/unknown orders
read as neutral `404 ORDER_NOT_FOUND` with identical bodies and
untouched rows (tested); foreign bulk targets fail the whole bulk
(`409 ORDER_BULK_VALIDATION_FAILED`, nothing applied — tested).
Mutations keep `ORDER` `UPDATED` events with HEAD/MEMBER snapshots
and safe metadata; 403/409 paths emit nothing (tested); no
secrets surface.

### BD.4. Verification

* New `tests/integration/orders-rbac.test.js` (14): per-role
  reads/status/payment/bulk matrices, lifecycle + payment
  business-error parity, CUSTOMER/SUPER_ADMIN/anonymous
  exclusions with state proofs, foreign/unknown neutrality
  (incl. exact-body equality), smuggling immunity, suspension
  with restore, audit role/metadata/secret/no-event proofs.
* Regression: order isolation/lifecycle/bulk (+retry),
  cart-order, audit-orders, suspension suites green; full backend
  + admin suites green; ESLint clean; `prisma migrate status` up
  to date, no drift, no migration.
* Docs: `API_CONTRACT_MATRIX.md` order rows + §5 cells updated;
  no `ADMIN_ARCHITECTURE.md` change required (order UI contracts
  unchanged); no frontend work. Known residual drift (not in
  scope): `API.md:181` and `FRONTEND_INTEGRATION.md` still
  describe `/orders/admin*` as ADMIN-only.

## BE. Phase 3-6 — Sixth operational RBAC slice: returns + coupons (COMPLETE)

### BE.1. Grant basis

Coupons carry an explicit namespace — ADMIN holds
`coupon:CREATE/READ/UPDATE/DEACTIVATE/DELETE`, HEAD holds
`CREATE/READ/UPDATE/DEACTIVATE`, MEMBER holds `READ` — used
verbatim, no matrix change. Returns carry NO namespace in
`permissions.js` and the admin surface is read-only by design
(`GET /returns`, `GET /returns/:id`; no status-mutation endpoint
exists), so per the brief's stop-and-report rule NO return route
changed: the ADMIN-only posture is preserved and locked by tests
rather than widened by invention. Customer return routes
(`POST|GET /orders/:orderId/returns`) are untouched.

### BE.2. Route/action mapping (coupons)

* `GET /coupons`, `GET /coupons/:id`, `GET /coupons/:id/history`
  (READ) → ADMIN/HEAD/MEMBER.
* `POST /coupons` (CREATE), `PATCH /coupons/:id` (UPDATE incl.
  `isActive` toggles — HEAD holds DEACTIVATE) → ADMIN/HEAD.
* `DELETE /coupons/:id` (hard delete) → ADMIN only
  (HEAD/MEMBER hold no DELETE; `COUPON_IN_USE` guard unchanged).
* `POST /coupons/validate` (customer quote) unchanged — any
  authenticated caller, own cart only.
* Global code uniqueness, company stamping, one-time usage via
  `CouponUsage`, history/audit vocabulary, guards — all
  byte-identical.

### BE.3. Isolation/suspension/business/audit

Chain preserved; company from server context (strict `companyId`
rejection, query/header ignored — tested); suspension gate
unchanged (`403 COMPANY_SUSPENDED` — tested for both domains with
restore); foreign/unknown coupons and returns read as the neutral
pre-existing 404s with identical bodies and untouched rows
(tested); customer flow (create/read/duplicate-409) untouched
(tested). Business errors (`COUPON_IN_USE`,
`RETURN_ALREADY_REQUESTED`, validation) stay business errors.
Mutations keep `COUPON` audit + `CouponHistory` lifecycle events
with HEAD snapshots and safe metadata; refusals emit neither
(tested); no secrets surface.

### BE.4. Verification

* New `tests/integration/returns-coupons-rbac.test.js` (15):
  returns ADMIN-reads + HEAD/MEMBER/CUSTOMER/SUPER_ADMIN/anon
  exclusions, customer-flow parity, returns suspension;
  coupon per-role create/update/delete matrices, reads/history
  for HEAD/MEMBER, CUSTOMER validate parity, usage-backed
  delete-guard proof, foreign/unknown neutrality (incl.
  exact-body equality), smuggling immunity, suspension with
  restore, history/audit role/metadata/secret/no-event proofs.
* Regression: returns, coupons (routes/checkout/history/usage),
  review-coupon isolation, audit-catalog/orders, suspension, and
  prior RBAC suites green; full backend + admin suites green;
  ESLint clean; `prisma migrate status` up to date, no drift,
  no migration.
* Docs: `API_CONTRACT_MATRIX.md` returns-posture note + coupon
  rows + §5 cell updated; no `ADMIN_ARCHITECTURE.md` change
  required; no frontend work.

## BF. Phase 3-7 — Marketing + announcements RBAC audit (COMPLETE, verification-only)

### BF.1. Matrix findings (verbatim)

`permissions.js` grants HEAD/MEMBER nothing here: ADMIN alone
holds `notification:MANAGE` + `announcement:MANAGE`, and no
marketing namespace exists at all. All ten management endpoints
(`GET|POST /marketing/notifications/admin[/:id]`,
`PATCH|DELETE` both, and the five `/announcements/admin[/:id]`
equivalents) are `authorize("ADMIN")` with full
`authenticate → resolveCompanyContext → requireActiveCompany`
chains — implementation already matches the matrix, so per the
stop-and-report rule ZERO production files changed.

### BF.2. Posture locked by tests

New `tests/integration/marketing-announcements-rbac.test.js`
(19): ADMIN full lifecycles intact; HEAD/MEMBER 403 on all ten
management routes with rows byte-identical; CUSTOMER/
SUPER_ADMIN/anonymous refused; suspended HEAD stopped with
`COMPANY_SUSPENDED` and nothing stored; customer `/active`
reads and public `/current` fail-closed behavior intact;
refusals emit no mutation audit. Supplements (not duplicating)
the existing HEAD/SUPER_ADMIN broadcast and announcement
isolation assertions.

### BF.3. Verification

Focused suite 19/19; neighbors (broadcast-isolation,
audit-catalog, suspension, storefront, mounted-context,
order-lifecycle) green; full backend + admin suites green;
ESLint clean; `prisma migrate status` up to date, no drift, no
migration. Docs: matrix ADMIN-only posture notes + this record;
no `ADMIN_ARCHITECTURE.md` change; no frontend work.

## BG. Phase 3-8 — Inactive-scope reads + final contract audit (COMPLETE, verification-only)

### BG.1. Decision (no production change)

Inactive-record visibility is a separate governance dimension
from mutation permission, and no matrix grant models it — so per
the brief's discipline the pre-SaaS `requireAdminForInactiveScope`
posture stands (its rationale is storefront-leakage prevention,
satisfied by ADMIN-only; HEAD/MEMBER active workflows are
complete without it, and HEAD can always reactivate by id with
ids discoverable through its granted audit visibility):
* Categories/products `?status=inactive|all` → ADMIN only
  (HEAD/MEMBER 403, CUSTOMER 403, SUPER_ADMIN 403, anon 401;
  default scope stays public active-only via Host).
* Variants: no standalone reads (unmounted paths 404
  `ROUTE_NOT_FOUND`); nested variants follow the product scope.
* Coupons: `?status=` lives on ADMIN/HEAD/MEMBER routes — HEAD/
  MEMBER inactive reads already open (locked, not widened here).
* Inventory/orders: no inactive concept (statuses ≠ scope).
* Returns/marketing/announcements/users: ADMIN-only routes or
  2C-31 scoping, unchanged.

### BG.2. Final 12-domain audit (all verified, see slice records)

Categories (AZ), Products (BA), Variants (BB), Inventory (BC),
Orders/Payments/Bulk (BD), Returns + Coupons (BE), Marketing +
Announcements (BF), Inactive-scope (BG): ADMIN full per domain;
HEAD/MEMBER exactly per matrix grants with lifecycle guards
(member `isActive`, variant/product active-state, coupon DELETE,
order machines); CUSTOMER excluded from staff routes; SUPER_ADMIN
platform-only; neutral 404s; suspension gates; scoped audits
without secrets. No genuine backend gap remains.

### BG.3. Verification

* New `tests/integration/inactive-scope-rbac.test.js` (12):
  ADMIN inactive/all reads, HEAD/MEMBER 403s + active-scope
  continuity via storefront host, no-variant-route 404,
  coupon inactive parity, non-expansion spot checks, foreign
  non-enumeration, suspension-first gating, CUSTOMER/
  SUPER_ADMIN/anon refusals, read audit silence.
* Neighbors (all RBAC suites, isolation, suspension,
  audit-catalog) green; full backend + admin suites green;
  `prisma migrate status` up to date, no drift, no migration.
* Docs: matrix inactive-scope notes + this record.
* Residuals (future, non-backend-RBAC): HEAD operational UI,
  per-company retention/Google allowlist/billing/mobile.

## BH. Phase 4-2 — Dashboard contract audit (COMPLETE, verification-only)

### BH.1. Architecture findings

One endpoint: `GET /dashboard/summary` (`dashboard.routes.js`,
`authorize("ADMIN")`, full chain). Response: company-scoped
aggregates only — order status counts, recognized revenue
(DELIVERED/COMPLETED + PAID), period aggregates, zero-filled
buckets, inventory snapshot (tracked/outOfStock/uninitialized
counts). No order/customer rows, no PII. All queries carry bound
`companyId` predicates (Prisma relation filters + raw SQL joins);
no cross-company leakage path. Distinct from audit analytics
(`GET /audit-logs/summary`, Phase 2C-24, HEAD served under
separate visibility rules — untouched).

### BH.2. Decision: intentionally ADMIN-only (no production behavior change)

`company_statistics:READ` is granted to SUPER_ADMIN + ADMIN
only — HEAD/MEMBER hold no grant while holding many others, so
the matrix deliberately withholds financial/aggregate summaries.
Wiring HEAD would contradict the matrix; hierarchy alone is not
evidence. SUPER_ADMIN holds the grant yet is route-refused, so
platform context never becomes company scope. Metric review found
nothing HEAD-safe to carve out (revenue + company-wide counts
are a distinct sensitivity class with no HEAD grant).

### BH.3. Comment-only correction

Two stale comments claimed the inventory snapshot "stays global
by design" while the query has always been scoped
(`v.company_id = ?`). Corrected to match behavior; no logic,
query, or response changed.

### BH.4. Verification

* New `tests/integration/dashboard-rbac.test.js` (7): ADMIN
  aggregate shape without PII, HEAD/MEMBER/CUSTOMER 403 with no
  data, SUPER_ADMIN 403, anon 401, invalid range 422,
  companyId query/header ignored, suspended-company 403 before
  any query, read/refusal audit silence, audit-analytics
  separation intact for HEAD.
* Neighbors (dashboard-inventory ×2, audit-summary,
  suspension, catalog/orders RBAC) green; full backend suite
  green; `prisma migrate status` up to date, no drift, no
  migration.
* Docs: matrix dashboard posture note + this record. No
  `ADMIN_ARCHITECTURE.md` change (dashboard UI stays ADMIN).
  No frontend follow-up from this phase (HEAD has no dashboard
  surface by matrix decision).

## BI. Phase 4-3 — Per-company audit retention: decision gap (NO IMPLEMENTATION)

### BI.1. Pre-change architecture (verified)

Singleton `audit_retention_policy` row (`id "global"`,
`NEVER|30_DAYS|1_YEAR`, default NEVER), SUPER_ADMIN-only
`GET|PATCH /audit-retention` (no suspension gate, strict
`{policy}` body), cutoff `createdAt` strictly older than
now − N days, bounded 1000-row batches, no per-row queries,
writes no audit rows itself, NEVER deletes nothing, 24h
in-process scheduler + one-shot script, policy changes audited
(`AUDIT_RETENTION/UPDATED`, `companyId NULL`), company deletion
purges company rows (platform `NULL` rows survive). Existing
suites: `audit-retention`, `audit-log`, `company-deletion`.

### BI.2. The gap: no precedence decision exists

The docs list per-company retention only as deferred future
work (phase table, §§AN.6/AP.6/AR.5/AQ.5/AS.6, residual lists).
No statement anywhere establishes whether a company override
would (A) replace the global default, (B) be bounded by it, or
(C) combine with it — nor who may set it, nor how platform
(`companyId NULL`) rows are governed under overrides. Choosing
among A/B/C by intuition risks data-loss liability (a shorter
override could destroy evidence the platform must keep; a
longer one could retain what must expire), so per the phase
brief NO schema, API, cleanup, or test change was made.

### BI.3. Product decisions required before implementation

1. Override vs bound semantics (A, B, or C) with compliance
   rationale.
2. Whether a company override may be shorter, longer, or only
   equal-or-longer than the global policy.
3. Governance of platform/companyless rows under overrides.
4. Who sets company policy (default assumption: SUPER_ADMIN
   only — company staff must not be assumed).
5. Orphan/edge semantics: suspended-company management (expect
   platform rules to apply), deletion atomicity expectations,
   restore behavior.
6. Whether cleanup stays single-pass global or becomes
   per-company scheduled work.

### BI.4. Verification

Existing retention/audit/deletion suites re-run green (global
contract unchanged); `prisma migrate status` up to date, no
drift, no migration. Matrix/DATABASE untouched (no new
contract exists to document).

## BJ. Phase 4-4 — Company-scoped Google sign-in allowlist (COMPLETE)

### BJ.1. Model (not P.6)

`Company.googleSignInEnabled` (`BOOLEAN NOT NULL DEFAULT true`,
migration `20261005152059_phase4_4_company_google_signin`):
membership of the company in Google-permitted traffic. Default
true = conservative rollout (no existing company loses an auth
method). This answers "is Google sign-in permitted for this
company" — it is NOT the P.6 `googleClientIds` mobile-audience
union, which stays deferred (shared platform `GOOGLE_CLIENT_ID`
verification unchanged; no `googleId` column exists — identity
remains email-based).

### BJ.2. Management (SUPER_ADMIN-only)

`PATCH /companies/:id/google-signin { enabled }` (strict) → 200
safe company (flag included in list/detail projections).
Platform chain, no suspension gate (suspended manageable);
ownership from the route id only; unknown → 404, malformed →
422, ADMIN/HEAD/MEMBER/CUSTOMER → 403, anon → 401. Audit:
company-scoped `COMPANY/UPDATED` with
`{ googleSignInEnabled, previousValue }` (no secrets); failures
emit nothing. ADMIN company-config authority was deliberately
NOT invented (no such precedent exists). Company deletion needs
nothing new (plain column, cascades with the row).

### BJ.3. Flow gate (fail-closed, uniform)

Scoped requests check the flag BEFORE token verification,
linking, creation, and suspension checks: disabled (or dangling)
company → `403 AUTH_GOOGLE_NOT_ALLOWED`, creating nobody and
touching nobody. Applies to customer and staff rows alike — the
flow never distinguished them, and bifurcating would punch a
hole. Unscoped legacy flow untouched. Suspension
(`requireActiveCompany` first, then `assertCompanyActive`),
inactivity, ambiguity, P2002 race, password/refresh/logout
paths all unchanged. No JWT/host/resolution changes.

### BJ.4. Verification

* New `tests/integration/google-allowlist.test.js` (12):
  management authz/matrix, 404/422 paths, smuggling rejection,
  scoped audit shape + silence on failure, enabled Customer
  create + same-id relink (no duplicates), disabled denial
  without creation or side effects, cross-company same-email
  isolation, staff uniform gating, unscoped legacy parity,
  suspension precedence, deactivated-domain legacy fallback,
  password-login parity.
* `companies-lifecycle` exact-shape assertions extended with
  the additive field (documented, not weakened).
* Focused: allowlist 12/12; neighbors (auth-google,
  companies-lifecycle/domains, customer-identity ×2,
  suspension, audit-log) green.
* Full backend suite green; `prisma migrate status` up to date,
  no drift — one forward migration, history untouched.
* Docs: matrix Google + company rows/shape, DATABASE §26G
  column + rule, this record. No admin UI (backend contract
  only); no customer-frontend change.

---

## BK. PHASE 2C-32 IMPLEMENTATION RECORD — SUPER_ADMIN PLATFORM COMPANY-MANAGEMENT COMPLETION

Phase 2C-32 status is COMPLETE: the SUPER_ADMIN platform
experience is now closed-loop (metadata contract, aggregate
summary, dedicated dashboard landing, company detail UI) with
the multi-company security model fully preserved.

### BK.1. Gap audit outcome

Audited against §C (AGREED SUPER_ADMIN capabilities) and the
2C-15/2C-20/2C-25/2C-27 implementation:

- COMPLETE already: hierarchy, platform scope (companyId null),
  ACTIVE↔SUSPENDED lifecycle, SUSPENDED + exact-name deletion,
  Company #1 UUID protection, name-only creation with
  generated ADMIN, domain registry, googleSignInEnabled
  setting, one-ADMIN provisioning/reset, aggregate-only
  detail/list visibility, audit conventions.
- MISSING (implemented here): rename-only `PATCH
  /companies/:id`, aggregate-only `GET /companies/summary`,
  `/platform` dashboard landing + page, `/companies/:id`
  detail page + edit, Details action, Admin Status column
  removal.
- DEFERRED BY PRODUCT DECISION: logo/favicon/company
  email/contact/address/social/website/theme columns (§C
  lists the categories as AGREED but defines no field-level
  shapes, types, or constraints anywhere in docs or schema;
  inventing them would be speculative schema). No migration
  was created for them. The rename contract covers the one
  established mutable metadata field (`Company.name`).

### BK.2. Backend contracts

- `PATCH /companies/:id { name }` (SUPER_ADMIN platform
  chain, no suspension gate so suspended companies stay
  manageable): strict validation rejects status/adminUserId/
  domains/settings/companyId; same-name writes are no-op
  success without audit; genuine renames write in-transaction
  with a company-scoped COMPANY/UPDATED audit carrying
  `{ name, previousValue }` and return the full safe detail
  shape. Protected fields provably untouched (repository
  writes `name` only).
- `GET /companies/summary` (declared before `/:id`;
  SUPER_ADMIN platform chain): `{ totalCompanies,
  activeCompanies, suspendedCompanies, totals,
  companies[] }` where each company entry is the lean
  dashboard row (`id/name/status/primaryDomain` +
  `aggregates{totalUsers,totalProducts,totalOrders}`; totals
  keep the full six-metric breakdown, summed exactly from
  the grouped counts). Bounded cost — one lean metadata
  query (identity + minimal domain fields, no profile/
  timestamp width) plus grouped counts (`company`/`user`/
  `product` groupBy plus one parameter-free order join; no
  per-company fan-out, no user input in SQL). Counts only,
  never operational rows, never secrets. Payload scales
  with company count alone (measured ~49% smaller than the
  full-shape projection at 2.2k companies); the dashboard
  table paginates client-side (20/page) so rendered DOM
  stays bounded.
- `/dashboard/summary` stays ADMIN-only and identity-scoped
  (SUPER_ADMIN receives 403 there by design — verified in
  regression tests); the platform dashboard consumes only
  the new summary contract.

### BK.3. Admin frontend

- `landingFor`: SUPER_ADMIN → `/platform`; ADMIN redirect
  behavior and HEAD/MEMBER `/audit-logs` landing unchanged.
- `/platform` (`PlatformDashboardPage`, SUPER_ADMIN-only
  route + System nav item): platform totals, status
  aggregates, per-company aggregate table with Details
  links. Visually and contractually distinct from the
  company operational `DashboardPage`.
- `/companies/:id` (`CompanyDetailPage`, SUPER_ADMIN-only):
  metadata card (status, admin presence, timestamps,
  googleSignInEnabled) + Edit rename modal (PATCH contract,
  list + detail refresh on success, 401/403/404/422
  handling) + aggregate counts + read-only domain registry
  (management stays on the Companies list modal).
- Companies list: Admin Status column removed (exactly one
  ADMIN per company by invariant); Details action added;
  domain/suspend-or-restore/admin/delete actions unchanged.

### BK.4. Verification

- New `company-platform` integration suite (12 tests):
  rename shape/validation/protection/no-op/audit-safety/
  authz; summary aggregates/separation/row-and-secret
  absence/authz/operational-endpoint denial; lifecycle
  guards unchanged.
- Admin: `LoginPage` landing (SUPER_ADMIN → platform),
  `CompaniesPage` (no Admin Status, Details action),
  new `CompanyDetailPage` + `PlatformDashboardPage`
  suites.
- Full backend suite green; `prisma migrate status` up to
  date with no drift and no new migration (no schema
  change); admin + storefront suites as reported in the
  task handoff.

---

## BL. PHASE 2C-33 IMPLEMENTATION RECORD — COMPANY BUSINESS-PROFILE CONTRACT

Phase 2C-33 status is COMPLETE: the ten approved nullable
profile columns are live behind the SUPER_ADMIN platform
boundary with normalize/clear semantics, HTTPS-only website
gating, exact changedFields/previousValues audit payloads,
dedicated raster-pipeline logo upload/removal, and
aggregate-only visibility preserved end to end.

### BL.1. Schema and migration

One additive forward migration,
`20261008063329_phase2c33_company_profile`: ten nullable
columns on `companies` (`contact_email`, `contact_phone`,
`address_line1/2`, `city`, `state`, `postal_code`,
`country`, `website`, `logo_path`), no backfill (existing
rows read NULL), no indexes or unique constraints,
dedicated columns (never JSON). DATABASE.md §26G updated.
No favicon/social/theme/billing columns by product
decision.

### BL.2. PATCH contract

Extended `PATCH /companies/:id` (same SUPER_ADMIN chain,
no suspension gate): strict schema, at-least-one-field
refine, `{}` and unknown/protected keys (including
`logoPath`, status, adminUserId, domains, settings)
rejected; name keeps its required/non-empty rule when
supplied; profile fields trim (email lowercased, empty
string → NULL/clear); website HTTPS enforced
service-side (`COMPANY_INVALID_WEBSITE`, mirroring
`COMPANY_DOMAIN_INVALID` beside `normalizeHostname`);
unchanged submissions succeed with no update and no audit
row; genuine changes write transactionally with a
company-scoped COMPANY/UPDATED audit carrying exactly
`{ changedFields, previousValues }`. Supporting change:
`assertSafeMetadata` now accepts scalar lists (bearer/JWT
value scanning preserved, nested objects still rejected)
so the allowlisted `changedFields` array is expressible.

### BL.3. Logo lifecycle

`POST /companies/:id/logo` (multipart via the shared
`uploadSingleImage` gate) and `DELETE /companies/:id/logo`
under the SUPER_ADMIN chain: `assertRasterImage` format
allowlist (SVG/vectors rejected even when Sharp could
rasterize them) + shared `processToWebp`; server-generated
filenames under `companies/<companyId>/branding/`; previous
file removed only after the new file persists and the DB
update commits; removal clears the column transactionally
(idempotent) with post-commit warn-only file cleanup;
`findCompanyMediaPaths` includes `logoPath` so permanent
deletion cannot orphan branding files. No favicon.

### BL.4. Visibility

Detail responses carry the ten profile fields (NULL by
default); list and per-company summary rows stay lean
(counts-only). No public company-info endpoint;
ADMIN/CUSTOMER exposure unchanged.

### BL.5. Admin UI and verification

`CompanyDetailPage` gains a business-profile section
("Not provided" fallbacks, website link, logo
thumbnail/placeholder), a single name+profile edit form
(per-field client validation mirroring backend limits,
empty clears, in-dialog 422 surfacing, detail+list
refresh), and logo upload/replace/remove with inline
confirmation and failure alerts. `company.service` gains
`updateCompany` (full profile body, `logoPath` never
sent), `uploadCompanyLogo`/`deleteCompanyLogo`, and
`resolveCompanyLogoUrl`. Regression coverage: new
`company-profile` backend suite (profile shape/lean-list,
normalize/clear, email/website/length/unknown-field
rejections, no-op/audit-payload/secret-freedom,
authz/suspended, logo upload/replace/SVG/remove/cascade)
plus `CompanyDetailPage` and `company.service` admin
suites; lifecycle/platform/isolation neighbors green.

---

## BM. PHASE 2C-34 IMPLEMENTATION RECORD - PERSISTENT ONE-TIME REFRESH-TOKEN ROTATION

Phase 2C-34 status is COMPLETE: every refresh token carries a MySQL-backed session row keyed by SHA-256 of its jti; rotation consumes the presented row atomically before minting a successor, so a jti succeeds exactly once even under concurrent use; logout revokes instead of only clearing the cookie.

### BM.1. Schema and migration

20261008090706_phase2c34_refresh_sessions: new refresh_sessions table (id UUID PK; userId FK Cascade; jti_hash CHAR(64) unique; expiresAt; nullable revokedAt; createdAt; indexes on userId and expiresAt) plus the User.refreshSessions back-relation. No raw tokens stored anywhere, only the hash plus ownership and lifetime metadata. No existing migration touched.

### BM.2. Lifecycle

- Issue (login, Google sign-in, refresh, password change; single async choke point): mint the pair, persist the session, prune the user's expired rows in the same transaction.
- Refresh: verify the JWT (sub and jti required), then the live-user gates (active 401, suspended 403, password watermark 401, order and codes unchanged), then one conditional UPDATE matching jti hash, owner, unrevoked, and unexpired. Losers get neutral 401 AUTH_REFRESH_TOKEN_INVALID. The winner mints the successor pair (rotated HttpOnly cookie, same contract).
- Logout: revoke the presented jti idempotently, then clear the cookie; missing or invalid tokens still answer 200.
- Cleanup: per-user expired-row prune at issuance (bounded, indexed); global expired sweep on the existing retention tick (single indexed range delete, error-tolerant). Revoked rows die by expiry; replay of a purged row answers 401 identically.
- Claims, lifetimes, cookie flags, rate limiters, tenancy, and RBAC are byte-identical; access-token behavior untouched.

### BM.3. Verification

- New auth-refresh-rotation suite (persist shape with no raw token, rotate and replay, per-user isolation, logout revoke, expiry, deactivation, 10-way exactly-once race, suspension gate).
- Updated auth-refresh-concurrency (same-cookie race now asserts exactly one win), refresh-rate-limit (follows rotation; 30 successes then 429 preserved), suspension-enforcement (sessionless tokens fail closed with legacy gating order).
- Full backend suite green; prisma migrate status up to date with no drift; no frontend changes (cookie contract unchanged).

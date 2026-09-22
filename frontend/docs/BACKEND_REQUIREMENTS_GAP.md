# Tech Pulse — Backend Requirements Gap Report (BACKEND_REQUIREMENTS_GAP)

Verified gaps ONLY, checked against `backend/prisma/schema.prisma`,
`backend/src/routes/index.js`, module routes/services, `backend/docs/API.md`,
`backend/docs/API_CONTRACT_MATRIX.md`, `backend/docs/FRONTEND_INTEGRATION.md`,
`backend/docs/SECURITY.md`, and `backend/docs/DATABASE.md`. Existing modules:
auth, users, addresses, categories, products, inventory, media, cart,
wishlist, orders, payments, reviews, coupons. The backend was NOT modified
for this task; no endpoints are invented below.

Non-gaps (manager terms already satisfiable — see API_INTEGRATION.md §16):
ProductMaster → `Product`+`ProductVariant` (id, sku as ProductCode, name,
description/shortDescription, categoryId, `compareAtPrice` as MRP, `price`
as DiscountedRate, createdAt/updatedAt); CategoryMaster → `Category`
(id, name, description, parentId, isActive, plus slug/sortOrder); 
ProductImageMaster → `ProductImage` (superset: variantId, altText,
sortOrder, isPrimary, WebP pipeline). New-arrival sorting works via
`createdAt`; discount derivation works via variant `price`/`compareAtPrice`.
Admin CRUD for categories/products/variants/inventory/media already exists
behind the ADMIN role.

---

## GAP-01 — Company / support / contact information (+ map config)

- **Requirement**: `/support` page needs company address, contact info, and
  Google Map, stored in MySQL through the Node backend (manager-mandated;
  must not be hardcoded as database-backed content in React).
- **Current backend status**: NOT SUPPORTED. No company/settings/contact
  model, module, migration, route, or validation exists.
- **Existing related module/API**: none. Closest analogue is the
  `Category.image` reference pattern (metadata string, not binary).
- **Exact missing capability**: a `company_infos`-style entity (single active
  row or keyed rows): companyName, supportPhone, supportEmail, salesEmail,
  addressLine1/2, city, state, postalCode, country, whatsappNumber,
  googleMapsEmbedUrl (stored embed URL/place ID — never a raw API key),
  workingHours (nullable text), isActive, createdAt/updatedAt; public
  `GET /api/v1/company-info` (active row only); ADMIN `GET/PUT` management
  API; Zod validation mirroring address limits; `isActive` gating (inactive
  → `404`, frontend falls back to placeholders).
- **Whether frontend can work without it**: YES, temporarily — `/support`
  ships config-driven with clearly-marked placeholders and a map-config
  missing state (PAGES.md §19), swapping to the GET API without redesign.
- **Recommended future backend change**: new `company` module following the
  standard route→controller→validation→service→repository→Prisma flow,
  migration, and matrix/docs updates. Include `whatsappNumber` here so the
  floating action becomes database-driven, and keep `VITE_WHATSAPP_LINK` /
  `VITE_GOOGLE_MAPS_EMBED_URL` as fallback config only.

## GAP-02 — Notifications for authenticated users

- **Requirement**: header notification bell for logged-in customers.
- **Current backend status**: NOT SUPPORTED. No notification module, table,
  route, or event plumbing exists.
- **Existing related module/API**: none (`orders` status changes are the
  natural future trigger source, but no event/hook system exists for them).
- **Exact missing capability**: `notifications` entity (id, userId, type,
  title, body, referenceType/referenceId, isRead, createdAt) + owner-scoped
  `GET /api/v1/notifications`, `PATCH …/read`, unread-count; order-status
  transitions as the first producer; ADMIN broadcast/management if required.
- **Whether frontend can work without it**: YES — bell renders entry point +
  honest empty state; `notifications.service.js` / `useNotificationsStore`
  ship as seams (FRONTEND_ARCHITECTURE.md §13). No fabricated data.
- **Recommended future backend change**: new `notifications` module
  (ownership-scoped like reviews/addresses; cross-owner → `404`), wired to
  order-status writes, with pagination from day one.

## GAP-03 — True popularity signal ("Popular Products")

- **Requirement**: a "Popular Products" rail backed by a real signal.
- **Current backend status**: NOT SUPPORTED. No sales-count, view-count,
  order-aggregate, or rating-aggregate endpoint exists (reviews have no
  public listing/aggregate by design).
- **Existing related module/API**: `Product.isFeatured` (boolean
  merchandising flag, readable on public product payloads) — the only
  supported curation signal.
- **Exact missing capability**: a server-computed popularity metric (e.g.
  order-item aggregates) exposed as a field or sort option.
- **Whether frontend can work without it**: YES — rail uses `isFeatured`
  with honest labeling ("Featured"/"Handpicked"), never fake ranks or
  "Most Popular" claims (FRONTEND_SPEC.md §5).
- **Recommended future backend change**: aggregate endpoint or `popularity`
  field maintained from order data; until then the client-side derivation
  stands.

## GAP-04 — Catalog query API (production scale)

- **Requirement**: manager rails/search/filter stay correct as the catalog
  grows beyond the current 13 seeded products.
- **Current backend status**: NOT SUPPORTED. `GET /products` and
  `GET /categories` return bare active-only arrays with no documented
  pagination/filter/sort/search parameters.
- **Existing related module/API**: public product/category reads (full
  payload incl. `createdAt`, variants, `isFeatured`).
- **Exact missing capability**: documented `page/limit`, `categoryId`,
  text search, and sort keys (`newest`, `discount`, `price`) on catalog reads.
- **Whether frontend can work without it**: YES at current scale — all
  merchandising derives client-side over the cached arrays (FRONTEND_SPEC
  §5). This degrades with catalog growth (payload size, first-load cost).
- **Recommended future backend change**: additive query support on the two
  public reads (never arbitrary query→DB passthrough, per API.md §9), with
  matrix/docs updates; frontend selectors already isolate the derivation.

## GAP-05 — Product discount specification text

- **Requirement**: manager's ProductMaster `DiscountSpec` (e.g. "Festive
  offer", "Clearance").
- **Current backend status**: NOT SUPPORTED as a field. Discount is derived
  from variant `compareAtPrice` vs `price`; deal context has nowhere to live.
- **Existing related module/API**: `ProductVariant.compareAtPrice`
  (nullable MRP equivalent) + `PriceBlock` derivation.
- **Exact missing capability**: nullable `discountSpec`/`offerLabel`
  (≤100 chars) on product or variant, readable on public payloads.
- **Whether frontend can work without it**: YES — `% off` badges derive from
  prices; no deal-label UI is promised.
- **Recommended future backend change**: additive nullable column +
  validation + mapper exposure; backfill null for existing rows.

## GAP-06 — Catalog creator / modifier audit (CreatedBy / ModifiedBy)

- **Requirement**: manager's ProductMaster `CreateUserId` / `ModifiedUserID`.
- **Current backend status**: NOT SUPPORTED. `Product`/`Category` carry
  `createdAt`/`updatedAt` but no user FKs; no audit-log table exists
  (DATABASE.md §26 lists `audit_logs` as a deliberate future extension).
- **Existing related module/API**: timestamps on all catalog models; ADMIN
  role gating on writes (who is *authorized*, not who *acted*).
- **Exact missing capability**: `createdBy`/`updatedBy` FKs (or an audit
  trail) surfaced to the future Admin Panel.
- **Whether frontend can work without it**: YES — the customer storefront
  never displays audit data; only the future Admin Panel needs it.
- **Recommended future backend change**: additive nullable FKs (or the
  planned `audit_logs` entity) when the Admin Panel is scoped; no storefront
  impact.

## GAP-07 — Product image file delivery (known, unchanged)

- **Requirement**: product galleries must render real images.
- **Current backend status**: PARTIALLY SUPPORTED. Metadata model, Sharp/WebP
  pipeline, admin upload APIs, and public reads exist; but no static-serving
  route exists AND the seed contains zero media rows/files.
- **Existing related module/API**: `media` module
  (`GET /products/:productId/images[/:imageId]` public; ADMIN writes).
- **Exact missing capability**: (a) served delivery of `storagePath`
  (static route or CDN base) and (b) actual image assets for seeded products.
- **Whether frontend can work without it**: YES, degraded — `ProductImage`
  component uses `VITE_MEDIA_BASE_URL` + placeholder fallback.
- **Recommended future backend change**: deployment serving decision first,
  then a media-seeding/attachment pass for the 13 products; no schema change
  needed.

---

## Gap priority for the Admin Panel + storefront roadmap

1. GAP-01 (company info) — blocks honest `/support` + database-driven WhatsApp.
2. GAP-07 (image delivery) — blocks visual fidelity most visibly.
3. GAP-02 (notifications) — bell is a dead-end entry point until this lands.
4. GAP-04 (catalog queries) — needed as soon as the catalog outgrows ~dozens.
5. GAP-03 (popularity) — only affects "Popular" labeling honesty at scale.
6. GAP-05 / GAP-06 — admin-panel niceties; zero storefront impact.

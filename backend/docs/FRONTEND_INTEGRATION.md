# Tech Pulse Backend — Frontend Integration Guide

Handoff for a future frontend developer. Everything below reflects the
current backend implementation; nothing here invents endpoints, fields, or
providers. No secrets are included.

## 1. Backend connection

- Local base URL: `http://localhost:3000` (default `PORT`).
- Every endpoint is prefixed: `http://localhost:3000/api/v1`.
- JSON API. Send `Content-Type: application/json` on write requests.
- Media upload is the only exception: it requires `multipart/form-data`
  (see section 9).
- CORS is server-configured from `CORS_ORIGIN`. In production the frontend
  origin must be allowlisted or browsers will block calls.
- Credential expectations: the access token travels in the
  `Authorization: Bearer <token>` header; the refresh token travels in an
  `HttpOnly` cookie the browser stores automatically. Frontend code must
  send credentials (cookies) on refresh/logout calls and must never try to
  read the refresh cookie from JavaScript.

## 2. Authentication

- Register: `POST /api/v1/auth/register` with `email`, `password` (8–128
  chars), optional `firstName`, `lastName`, `phone`. Returns `201`. Every
  new account gets the `CUSTOMER` role; there is no self-serve admin signup.
- Login: `POST /api/v1/auth/login` with `email`, `password`. Returns `200`
  with `data.accessToken` and sets the `refresh_token` cookie. Store the
  access token in memory (not localStorage, by recommendation) and attach
  it as the bearer header.
- Access authentication: short-lived JWT (default 15 minutes). When calls
  start returning `401`, the token has expired — use refresh, not re-login.
- Refresh: `POST /api/v1/auth/refresh` with no body; the cookie is sent
  automatically. Returns a new access token and rotates the cookie.
- Logout: `POST /api/v1/auth/logout` clears the refresh cookie.
- Me: `GET /api/v1/auth/me` with the bearer token returns the current user.
- Handling `401`: redirect to login or attempt one silent refresh, then
  retry once; a second `401` means re-authentication is required.
- Inactive accounts receive `403 AUTH_ACCOUNT_INACTIVE` at login and
  cannot refresh; surface this as "account disabled, contact support".
- Refresh-cookie behavior: `HttpOnly` (invisible to JS), `Secure` in
  production, `SameSite` configurable. Cross-site deployments must align
  frontend origin, CORS, and SameSite settings or refresh/logout break.

## 3. Frontend data flow

Practical dependency order:

1. Auth → keep `accessToken` in memory; rely on the cookie for refresh.
2. Profile/address → `GET /users/me`; create an address; keep its `id`.
3. Catalog → `GET /categories`, `GET /products`; keep `categoryId`.
4. Product detail → `GET /products/:id`; keep `variantId` (purchasing and
   cart/wishlist operate on variants and products respectively).
5. Cart/wishlist → lazy-created on first `GET`; mutate with returned ids.
6. Checkout/orders → `POST /orders` with the address id; keep `orderId`
   and order `items[].id`.
7. Reviews → `POST /reviews` with an order `items[].id` from the user's
   own order.

Every id above comes from a previous response; the frontend never invents
UUIDs.

## 4. Catalog integration

- Categories: public `GET /categories` and `GET /categories/:id` (active
  only). Writes are admin-only.
- Products: public `GET /products` and `GET /products/:id` (active only,
  each with embedded `category` brief and `variants[]`).
- Variants are the purchasable units: each has `id`, `sku`, `name`,
  `price`, `compareAtPrice`, `isActive`. Cart operations and inventory use
  `variantId`; wishlist and reviews use `productId`.
- Slugs vs UUIDs: products and categories expose human-readable `slug`
  fields, but all write/nested routes address resources by UUID (`:id`,
  `:productId`, `:variantId`). Use UUIDs for API calls; slugs are display
  metadata.
- Active/inactive: deactivated products/variants disappear from public
  reads and cannot be added to carts; existing orders, reviews, and
  wishlist entries referencing them remain accessible.
- Pricing: all money arrives as decimal strings (`"49.99"`). Never parse
  with floats for arithmetic the backend must redo — the backend always
  recalculates. Display formatting only on the client.
- Media: product images are metadata (`filename`, `storagePath`,
  `imageType`, `altText`, `sortOrder`, `isPrimary`, plus `productId` and
  nullable `variantId`). Images with a `variantId` belong to one variant
  of the same product (multiple per variant allowed); `null` means
  product-level. Clients filter the single `GET
  /products/:productId/images` list client-side (already `sortOrder`
  ordered): variant gallery = its images, else the product-level ones.
  Uploaded files under `storage/uploads` are served statically by the API
  server, so clients resolve browser URLs as
  `{MEDIA_BASE_URL}{storagePath}` (e.g.
  `http://localhost:3000/products/<id>/<uuid>.webp`). `storage/`
  persistence (backup/restore alongside MySQL) remains a deployment
  concern.

## 5. Cart integration

- `GET /cart` returns the cart, creating it lazily; an emptied cart
  persists as an empty cart.
- `POST /cart/items` (`{ variantId, quantity }`) uses increment semantics:
  re-adding a variant increases its quantity; one row per variant.
- `PATCH /cart/items/:itemId` (`{ quantity }`) sets the absolute quantity.
- `DELETE /cart/items/:itemId` removes the line; repeating returns `404`.
- There is no clear-cart endpoint; delete lines individually.
- Stock behavior: adding beyond available stock returns `409`, but the
  cart never reserves inventory — availability can change before checkout.
- Pricing behavior: `unitPrice`, `lineTotal`, and `subtotal` always come
  from current variant records. Never send price fields; they are rejected.
- Display image: each cart line carries server-resolved `image`
  (`{ storagePath, altText }` or `null`) — variant primary → variant
  first → product primary → product first. Render it directly; only
  guest/legacy lines without it fall back to variant-aware media reads.

## 6. Wishlist integration

- Product-level wishlist (no variants, no quantities): `GET /wishlist`,
  `POST /wishlist/items` with `{ productId }`, `DELETE` by item id.
- Duplicate add returns `409 WISHLIST_ITEM_EXISTS`; the item is not
  duplicated.
- Adding a product whose record is inactive returns `422`; items already
  saved stay visible.

## 7. Checkout/orders

- Requires a shipping address id owned by the user (`shippingAddressId`);
  an optional second owned address (`billingAddressId`) adds a `BILLING`
  snapshot, otherwise only a `SHIPPING` snapshot is stored.
- Checkout consumes the user's own cart: `POST /orders` reads cart lines,
  validates variants and stock, totals server-side, creates the order with
  item and address snapshots plus a `CASH_ON_DELIVERY` / `PENDING` payment,
  decrements inventory with ledger entries, and clears the cart — atomically.
- Optional coupon: `POST /coupons/validate { code }` quotes the caller's
  cart (`{ coupon, discountAmount, eligibleSubtotal, orderSubtotal }`);
  `POST /orders` accepts `couponCode?` and re-validates fresh at order
  time — the resulting `discountTotal` snapshot lowers `grandTotal` and
  the payment amount, and usage is consumed inside the same transaction
  (failed orders never consume). Coupon edits/deactivation never rewrite
  existing orders.
- Order response: `orderNumber` (`ORD-YYYY-NNNNNN`), `status`,
  string totals, `items[]` snapshots, `addresses[]` snapshots,
  `payments[]`, plus `statusHistory[]` oldest-first
  (`{ id, status, previousStatus, note, createdAt }`; `[]` for
  pre-milestone orders — fall back to `status`/`createdAt`/`updatedAt`,
  never invent rows). Save `orderId` for history and `items[].id` for reviews.
- Lifecycle (ADMIN-only `/orders/admin/:id/status { status, note? }`;
  forward-only machine `PENDING → CONFIRMED → PROCESSING → DISPATCHED →
  IN_TRANSIT → ARRIVED_IN_CITY → OUT_FOR_DELIVERY → DELIVERED →
  COMPLETED`, `CANCELLED` from `PENDING|CONFIRMED|PROCESSING` only;
  `SHIPPED` is legacy display-only). Each admin transition appends one
  history row and one customer notification atomically. Timelines render
  backend history only.
- Snapshots are immutable: later renames, repricing, deactivation, or
  address edits never change the stored order.
- Inventory effects: successful checkout decrements variant quantities;
  failed checkout changes nothing.
- Cart clearing: items are removed only on success.
- Order ownership: users see only their own orders (`GET /orders`,
  `GET /orders/:id`); other users' ids return `404`.
- NOT available on the customer surface: cancellation, status changes,
  payment mutation or capture, partial checkout, or
  choosing prices/totals — any such fields are rejected. (Admin order
  operations live under `ADMIN`-only `/orders/admin*`; see the contract
  matrix.)

## 8. Reviews

- Purchase requirement: `POST /reviews` needs an `orderItemId` from one of
  the caller's own orders; anyone else's (or a nonexistent) id returns
  `404`. The product is derived from that item; do not send `productId`.
- Validation: `rating` integer 1–5 (required); `title` 1–255 chars;
  `comment` 1–5000 chars; both text fields optional/nullable.
- Duplicate behavior: one review per order item and per user/product;
  repeats return `409`.
- Ownership: users can read, update (rating/title/comment subset), and
  hard-delete only their own reviews; other ids return `404`.
- Delete behavior: permanent; re-delete returns `404`.
- Admin moderation (ADMIN-only `/reviews/admin*`; see the contract
  matrix): `GET /reviews/admin` lists every review with a customer brief
  (`?page,limit,isApproved,rating,productId,userId,search,sortBy,sortOrder`,
  `meta` pagination); `PATCH /reviews/admin/:id { isApproved }`
  approves (`true`) or rejects (`false` — rejected rows stay stored and
  remain listed under `isApproved=false`); `DELETE /reviews/admin/:id`
  hard-deletes without touching order records.
- No public product-review listing or aggregate (average/count)
  endpoints exist: moderation state is authoritative but not yet consumed
  by any customer surface.

## 9. Admin dashboard and inventory (admin UI only)

Both surfaces are `ADMIN`-only. Customer sessions receive `403` on every
endpoint below; anonymous calls receive `401`. There is no public
inventory/stock endpoint and no realtime/polling behavior — the admin UI
issues one request per range/mount/refresh and renders server values.

### 9.1 Dashboard analytics

- `GET /api/v1/dashboard/summary?range=today|week|month|year`
  (default `today`). Unknown ranges return `422 VALIDATION_ERROR`;
  unknown query params are stripped, not rejected.
- The admin sends only the range enum. All boundaries are computed
  server-side in UTC: `today` = current UTC day with 24 hourly buckets;
  `week` = Monday–Sunday (UTC) with 7 daily buckets; `month` = calendar
  month (UTC) with one daily bucket per day; `year` = calendar year
  (UTC) with 12 monthly buckets.
- Recognized revenue = `SUM(grandTotal)` over `DELIVERED` **or
  `COMPLETED`** orders whose
  latest payment is `PAID`. Cancelled, in-flight (`PENDING`/`CONFIRMED`/
  `PROCESSING`/`DISPATCHED`/`IN_TRANSIT`/`ARRIVED_IN_CITY`/
  `OUT_FOR_DELIVERY`/legacy `SHIPPED`), unpaid, failed, and refunded orders are
  excluded. Revenue is attributed to order creation time (UTC). Never
  compute revenue from frontend order rows.
- Response: `200 { success: true, data: { summary } }` (no `meta`) with
  `range`, `periodStart`/`periodEnd`/`generatedAt` (ISO UTC),
  `granularity` (`hour`/`day`/`month`), all-time `orders` status counts
  (`total`, `pending`, `confirmed`, `processing`, `dispatched` — includes
  legacy `SHIPPED` rows — `inTransit`, `arrivedInCity`,
  `outForDelivery`, `delivered`, `completed`,
  `cancelled`), all-time recognized `revenue.total`, selected-period
  `period { orders, revenue }`, zero-filled `buckets[]`
  (`{ bucketStart, orders, revenue }` — bucket sums equal the period
  aggregates; zeros are measured absence), and the `inventory` snapshot
  (`tracked`, `outOfStock`, `uninitialized` over active variants of
  active products). All money arrives as `"xx.xx"` decimal strings.
- UI rules: render the authoritative aggregates directly (counts from
  `orders.*`, never from page length); render `buckets` exactly with no
  interpolation; a failed request must surface an error with retry and
  must never render as zero (keep the last good values on background
  refresh where applicable).

### 9.2 Admin inventory

- Cross-variant list: `GET /api/v1/inventory`
  (`?page,limit,search,stock=in|out,active=true|false,
  sortBy=sku|createdAt|updatedAt,sortOrder=asc|desc`). Invalid values
  return `422 VALIDATION_ERROR`; unknown params are stripped.
  `search` matches SKU, variant name, or product name. `stock=out`
  matches available stock (`quantity - reservedQuantity`) ≤ 0 **or** a
  missing stock record. `active` filters the variant flag.
- List response: `200 { success: true, data: { items[] }, meta }` with
  `meta { page, limit, total, totalPages }`. Each row carries
  `product { id, name, slug, isActive }`, `variant { id, productId, sku,
  name, price, isActive, createdAt }`, and `inventory | null`. A `null`
  inventory means "Not initialized" — never render it as zero. There is
  no low-stock threshold in the backend; do not invent one.
- Per-variant stock (variant must belong to the product):
  `GET /products/:productId/variants/:variantId/inventory` → `200
  { inventory }` (`quantity`, `reservedQuantity`, computed
  `availableQuantity`); no record → `404 INVENTORY_NOT_FOUND`.
  Initialize once: `POST` same path with `{ quantity: int 0–2147483647,
  note? }` → `201`; repeat → `409 INVENTORY_ALREADY_EXISTS`. Adjust:
  `PATCH` same path with `{ quantity: <non-zero int delta>,
  note? }` (the field carries the signed delta, not the new total) →
  `200`; overdraw → `409 INSUFFICIENT_STOCK`; overflow → `422`; missing
  record → `404`. Optional `note` is a ≤ 1000-character ledger note.
- Ledger history: `GET
  /products/:productId/variants/:variantId/inventory/transactions`
  (`?page,limit`, newest first) → `200 { success: true,
  data: { transactions[] }, meta }`. Rows carry the signed `quantity`
  delta, `type`, `referenceType` (`ADMIN`|`ORDER`), `referenceId`, and
  `note`. Unknown variants → `404 PRODUCT_VARIANT_NOT_FOUND`.
- Envelope rule: the list and ledger return pagination in top-level
  `meta`, so paginated clients must use the `meta`-preserving helper
  (plain data-only `GET` drops it and totals silently default).
- UI rules: filtering/sorting/pagination are server-driven (refetch on
  each change); reconcile mutations from the authoritative server
  response; manual adjustments write ledger rows only — they never
  create orders or rewrite order snapshots/totals. No stock state in
  `localStorage`, no page reloads.

## 10. Media uploads

- Admin only. `POST /products/:productId/images` as `multipart/form-data`
  with the file in field `image`; optional text fields `variantId`,
  `altText`, `sortOrder`, `isPrimary`.
- Accepted content: JPEG, PNG, WebP (verified by content, not just MIME),
  maximum 5MB, maximum 8000px per side. Oversized/spoofed files return
  `400`/`413`.
- Response returns the image record (`201`), including the WebP
  `storagePath` reference, served statically per section 4.
- Metadata update (`PATCH`) and delete (`DELETE`) are admin-only; delete
  removes the file and the row.
- Category images: `POST /categories/:id/image` (multipart `image`, same
  validation/processing, stored under `categories/<id>/`, sets the
  category `image` reference) and idempotent
  `DELETE /categories/:id/image` (removes the managed file, nulls `image`).
- Catalog reads accept `?status=active|inactive|all` (lists) and
  `?status=active|all` (details); non-active scopes require ADMIN.
  Reactivation is `PATCH { isActive: true }` (no dedicated endpoint).
  `PATCH` accepts `parentId: null` to promote a subcategory to top-level
  (self-parent and cycles still rejected).

## 11. Error handling

| HTTP | Meaning (implemented) | Frontend handling |
| ---- | --------------------- | ----------------- |
| 400 | Malformed request (e.g. bad JSON, bad upload) | Fix the request construction; do not retry as-is |
| 401 | Missing/invalid/expired auth | Silent refresh once, then login screen |
| 403 | Authenticated but not admin (or inactive account) | Hide admin UI; inactive → support message |
| 404 | Wrong route, wrong id, or another user's resource | Check ids/routes; the API intentionally returns the same 404 for missing and other users' resources |
| 409 | Duplicate or business conflict (email, SKU, wishlist, review, stock) | Show the specific message; refresh affected data |
| 422 | Strict validation failure; `error.details[]` names fields | Highlight fields from `details`; strip unknown fields |
| 429 | Rate limited | Back off until the window passes; slow down auth flows |
| 500 | Unexpected server error, no details exposed | Generic error message; report with timestamp and path |

Error shape is always `{ success: false, error: { code, message } }`
plus `details[]` on Zod validation failures. Never display raw internals —
none are sent.

## 12. UI/API synchronization rules

- Price is server-authoritative: always render cart/order totals returned
  by the API; never compute checkout amounts on the client.
- Inventory is server-authoritative: treat availability as advisory until
  checkout succeeds; expect `409` on races.
- Checkout is authoritative: only a `201` from `POST /orders` means an
  order exists.
- The cart does not reserve inventory.
- Order history renders snapshots, not live catalog data.
- User-owned resources are strictly isolated; never cache or guess another
  user's ids.
- Never send server-controlled fields (`userId`, prices, totals,
  statuses, stock counters, verification flags) — all are rejected.

## 13. What the frontend must NOT assume

Confirmed absent — do not build UI for these:

- Online payments, payment providers, or webhooks.
- Customer coupon MANAGEMENT UI (admin-only under `/coupons`). Checkout
  coupon use IS supported: `POST /coupons/validate { code }` quotes the
  caller's cart (server-computed discount), and `POST /orders` accepts an
  optional `couponCode` — the backend re-validates, discounts totals, and
  consumes usage atomically. Never send amounts; render server values.
- Customer-facing order cancellation or arbitrary status changes (admin
  operations are `ADMIN`-only under `/orders/admin*`).
- Customer-facing payment mutation of any kind.
- Review moderation, approval flows, or rating aggregates.
- A cart clear-all action (delete lines individually).
- A public inventory/stock endpoint.

## 14. Suggested frontend API client structure

Conceptual modules only (no code provided):

- `authClient`: register, login, refresh, logout, me.
- `usersClient`: profile get/update.
- `addressesClient`: full address CRUD.
- `categoriesClient`: public reads (+ admin writes if an admin UI exists).
- `productsClient`: public reads (+ admin product/variant writes).
- `inventoryAdminClient`: admin cross-variant list, stock read/initialize/adjust, ledger history.
- `dashboardAdminClient`: admin `GET /dashboard/summary?range=` (server aggregates only; see section 9.1).
- `mediaClient`: public reads, admin multipart upload/metadata/delete.
- `cartClient`: get, add (increment), update (absolute), delete.
- `wishlistClient`: get, add, delete.
- `ordersClient`: checkout, history list/detail (renders `statusHistory`
  timelines; never invents rows).
- `notificationsClient`: `GET /notifications`, `GET
  /notifications/unread-count` (authoritative badge), `PATCH
  /notifications/:id/read`, `POST /notifications/read-all`, plus `GET
  /marketing/notifications/active` (broadcasts; internal-destination
  mapping only) — customer bell merges both, read state is
  transactional-only.
- `announcementClient`: public `GET /announcements/current`
  (`{ announcement } | null`; null hides the bar, no hardcoded copy).
- `marketingAdminClient` / `announcementAdminClient`: admin CRUD under
  `/marketing/notifications/admin*` and `/announcements/admin*`.
- `reviewsClient`: create from order items, mine/get/update/delete.
- `couponsAdminClient`: admin list/detail/create/update/delete (no
  customer surface; validation service internal only).
- Shared: bearer injection, single-flight refresh, error-code mapping.

## 15. Integration checklist

- [ ] API base URL and `/api/v1` prefix configured.
- [ ] CORS allows the frontend origin with credentials.
- [ ] Cookie-based refresh works across the deployment (Secure/SameSite).
- [ ] Auth lifecycle (register → login → me → refresh → logout) verified.
- [ ] `401` triggers refresh-then-login handling.
- [ ] Protected routes gate on authentication state.
- [ ] Catalog renders from public reads; admin writes gated by role.
- [ ] Cart reflects increment/absolute semantics and server totals.
- [ ] Wishlist handles `409` duplicates gracefully.
- [ ] Checkout sends only address ids; success clears the cart.
- [ ] Order history renders snapshots, not live data.
- [ ] Reviews are created from the user's own order items only.
- [ ] Admin media/catalog/inventory screens check the admin role first.
- [ ] Admin dashboard renders `GET /dashboard/summary` aggregates directly (no frontend revenue math; failures never render as zero).
- [ ] Admin inventory list/adjust/ledger flows use the documented query params and `meta` pagination; manual adjustments never create orders.
- [ ] All error codes map to user-facing messages per section 11.

## 16. Source of truth

- `docs/API.md` — primary API contract.
- `docs/API_CONTRACT_MATRIX.md` — endpoint matrix.
- `docs/DATABASE.md` — database contract.
- `docs/SECURITY.md` — security contract.
- `AGENTS.md` — repository development rules.

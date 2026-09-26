# Tech Pulse Backend API Contract Matrix

Machine-readable-style reference for the current backend. The implementation
together with `docs/API.md` defines behavior; nothing below invents
endpoints, fields, status codes, or rules.

## 1. Global API rules

- Base path: `/api/v1` (local default `http://localhost:3000/api/v1`).
- JSON only. Write requests use `Content-Type: application/json`, except
  media upload which uses `multipart/form-data`.
- Success shape: `{ "success": true, "data": ... }`. Collection endpoints
  return either a bare array in `data` or an object wrapper; see section 4.
- Error shape: `{ "success": false, "error": { "code": "<CODE>",
  "message": "..." } }`. Zod validation failures add a `details` array of
  `{ "path", "message" }`.
- Authentication: `Authorization: Bearer <accessToken>` (short-lived JWT).
  Refresh uses the `HttpOnly refresh_token` cookie via
  `POST /auth/refresh`. No sessions, no API keys.
- Authorization: `ADMIN` role enforced by middleware on catalog, inventory,
  and media mutations. All other private resources are ownership-scoped to
  `req.user.id`; cross-owner access returns `404`, never `403`, to avoid
  leaking existence.
- Validation: strict Zod everywhere. Unknown, protected, or mistyped fields
  are rejected; validation failures return `422 VALIDATION_ERROR` (Zod) or
  a specific `422` application code.
- Common statuses: `200` ok, `201` created, `400` malformed request,
  `401` unauthenticated, `403` forbidden (admin-only), `404` not found,
  `409` conflict, `422` validation/business failure, `413` upload too
  large, `429` rate limited, `500` internal (no internals exposed).

## 2. Endpoint matrix

| Module | Method | Path | Auth | Role | Request | Success | Main Errors | Notes |
| ------ | ------ | ---- | ---- | ---- | ------- | ------- | ----------- | ----- |
| Health | GET | `/health` | no | — | — | 200 | — | Liveness probe |
| Auth | POST | `/auth/register` | no | — | email, password 8–128, firstName?, lastName?, phone? | 201 | 409 AUTH_EMAIL_ALREADY_EXISTS, 422, 429 | Always CUSTOMER role |
| Auth | POST | `/auth/login` | no | — | email, password | 200 | 401 AUTH_INVALID_CREDENTIALS, 403 AUTH_ACCOUNT_INACTIVE, 422, 429 | Sets refresh cookie |
| Auth | POST | `/auth/refresh` | cookie | — | refresh cookie only | 200 | 401 AUTH_REFRESH_TOKEN_INVALID, 429 | Rotates refresh token |
| Auth | POST | `/auth/logout` | no | — | — | 200 | — | Clears refresh cookie |
| Auth | GET | `/auth/me` | yes | — | — | 200 | 401 | Own identity |
| Users | GET | `/users/me` | yes | — | — | 200 | 401, 403 AUTH_ACCOUNT_INACTIVE | Own profile |
| Users | PATCH | `/users/me` | yes | — | firstName?, lastName?, phone? (nullable) | 200 | 401, 422 USER_UPDATE_INVALID/VALIDATION_ERROR | Non-empty body required |
| Users (admin) | GET | `/users` | yes | ADMIN | `?page,limit,search,isActive,sortBy,sortOrder` | 200 | 401, 403, 422 | All users, newest first; `meta` pagination; safe fields only |
| Users (admin) | GET | `/users/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 USER_NOT_FOUND | Safe fields only |
| Users (admin) | PATCH | `/users/:id` | yes | ADMIN | `{ isActive }` boolean | 200 | 401, 403, 404 USER_NOT_FOUND, 422 | Activate/deactivate; inactive users cannot log in |
| Addresses | GET | `/addresses` | yes | — | — | 200 | 401 | Own list, array |
| Addresses | POST | `/addresses` | yes | — | full address JSON | 201 | 401, 422 | isDefault optional |
| Addresses | GET | `/addresses/:id` | yes | — | UUID param | 200 | 401, 404 ADDRESS_NOT_FOUND | Owner-scoped |
| Addresses | PATCH | `/addresses/:id` | yes | — | partial fields | 200 | 401, 404, 422 ADDRESS_UPDATE_INVALID | Owner-scoped |
| Addresses | DELETE | `/addresses/:id` | yes | — | UUID param | 200 | 401, 404 | Owner-scoped |
| Categories | GET | `/categories` | no | — | `?status=active\|inactive\|all` (default active) | 200 | 422 on invalid status | Active only by default; `inactive`/`all` require ADMIN |
| Categories | GET | `/categories/:id` | no | — | id param, `?status=active\|all` (default active) | 200 | 404 CATEGORY_NOT_FOUND | Active only by default; `all` requires ADMIN |
| Categories | POST | `/categories` | yes | ADMIN | name + optional fields | 201 | 401, 403, 409 CATEGORY_SLUG_EXISTS, 404 CATEGORY_PARENT_NOT_FOUND, 422 | Slug auto-derived |
| Categories | PATCH | `/categories/:id` | yes | ADMIN | partial fields | 200 | 401, 403, 404, 409, 422 CATEGORY_UPDATE_INVALID/CYCLE/SELF_PARENT | — |
| Categories | DELETE | `/categories/:id` | yes | ADMIN | — | 200 | 401, 403, 404 | Soft-deactivates; reactivate via `PATCH {isActive:true}` |
| Categories | POST | `/categories/:id/image` | yes | ADMIN | multipart `image` (JPEG/PNG/WebP ≤ 5MB) | 200 | 400 MEDIA_INVALID_TYPE/UPLOAD_FAILED, 401, 403, 404, 413 MEDIA_FILE_TOO_LARGE | WebP stored under `categories/<id>/`, sets `image`; replaces previous managed file |
| Categories | DELETE | `/categories/:id/image` | yes | ADMIN | — | 200 | 401, 403, 404 | Idempotent; removes managed file + nulls `image` |
| Products | GET | `/products` | no | — | `?status=active\|inactive\|all` (default active) | 200 | 422 on invalid status | Active only by default; `inactive`/`all` require ADMIN |
| Products | GET | `/products/:id` | no | — | id param, `?status=active\|all` (default active) | 200 | 404 PRODUCT_NOT_FOUND | Active only by default; `all` requires ADMIN |
| Products | POST | `/products` | yes | ADMIN | product + variants? | 201 | 401, 403, 404 CATEGORY_NOT_FOUND, 409 PRODUCT_SLUG_EXISTS/SKU/BARCODE, 422 | Prices are decimal strings |
| Products | PATCH | `/products/:id` | yes | ADMIN | partial fields | 200 | 401, 403, 404, 409, 422 PRODUCT_UPDATE_INVALID | — |
| Products | DELETE | `/products/:id` | yes | ADMIN | — | 200 | 401, 403, 404 | Deactivates |
| Products | POST | `/products/:productId/variants` | yes | ADMIN | variant JSON | 201 | 401, 403, 404, 409 SKU/BARCODE, 422 | — |
| Products | PATCH | `/products/:productId/variants/:variantId` | yes | ADMIN | partial variant | 200 | 401, 403, 404, 422 PRODUCT_VARIANT_UPDATE_INVALID | Product-scoped |
| Products | DELETE | `/products/:productId/variants/:variantId` | yes | ADMIN | — | 200 | 401, 403, 404 | Deactivates |
| Inventory | GET | `/products/:productId/variants/:variantId/inventory` | yes | ADMIN | — | 200 | 401, 403, 404 PRODUCT_VARIANT_NOT_FOUND/INVENTORY_NOT_FOUND | quantity/reserved/available |
| Inventory | POST | same | yes | ADMIN | quantity ≥ 0, note? | 201 | 401, 403, 404, 409 INVENTORY_ALREADY_EXISTS, 422 | Initialize once |
| Inventory | PATCH | same | yes | ADMIN | non-zero delta, note? | 200 | 401, 403, 404, 409 INSUFFICIENT_STOCK, 422 | Atomic guarded decrement |
| Inventory (admin) | GET | `/inventory` | yes | ADMIN | `?page,limit,search,stock,active,sortBy,sortOrder` | 200 | 401, 403, 422 | All variants with product + stock (null = uninitialized); `meta` pagination |
| Inventory (admin) | GET | `/products/:productId/variants/:variantId/inventory/transactions` | yes | ADMIN | `?page,limit` | 200 | 401, 403, 404 PRODUCT_VARIANT_NOT_FOUND | Ledger newest-first; `meta` pagination |
| Dashboard (admin) | GET | `/dashboard/summary` | yes | ADMIN | `?range=today\|week\|month\|year` (default today) | 200 | 401, 403, 422 | Order counts + recognized revenue + buckets + stock snapshot; UTC ranges |
| Media | GET | `/products/:productId/images` | no | — | — | 200 | 404 PRODUCT_NOT_FOUND | Active product only |
| Media | GET | `/products/:productId/images/:imageId` | no | — | — | 200 | 404 MEDIA_NOT_FOUND | — |
| Media | POST | `/products/:productId/images` | yes | ADMIN | multipart `image` + metadata? | 201 | 400 MEDIA_INVALID_TYPE/UPLOAD_FAILED, 401, 403, 404, 413 MEDIA_FILE_TOO_LARGE | JPEG/PNG/WebP ≤ 5MB, WebP output |
| Media | PATCH | `/products/:productId/images/:imageId` | yes | ADMIN | metadata subset | 200 | 401, 403, 404, 422 MEDIA_UPDATE_INVALID | — |
| Media | DELETE | `/products/:productId/images/:imageId` | yes | ADMIN | — | 200 | 401, 403, 404 | Removes file + row |
| Cart | GET | `/cart` | yes | — | — | 200 | 401 | Lazy-created, kept when empty |
| Cart | POST | `/cart/items` | yes | — | variantId UUID, quantity int ≥ 1 | 200 | 401, 404 PRODUCT_VARIANT_NOT_FOUND/CART_ITEM_NOT_FOUND*, 409 INSUFFICIENT_STOCK, 422 PRODUCT_VARIANT_INACTIVE/VALIDATION_ERROR | Increment semantics |
| Cart | PATCH | `/cart/items/:itemId` | yes | — | quantity int ≥ 1 | 200 | 401, 404 CART_ITEM_NOT_FOUND, 409, 422 | Absolute value |
| Cart | DELETE | `/cart/items/:itemId` | yes | — | — | 200 | 401, 404 | Repeat → 404 |
| Wishlist | GET | `/wishlist` | yes | — | — | 200 | 401 | Lazy-created, product-level |
| Wishlist | POST | `/wishlist/items` | yes | — | productId UUID | 200 | 401, 404 PRODUCT_NOT_FOUND, 409 WISHLIST_ITEM_EXISTS, 422 PRODUCT_INACTIVE | No quantity, no variants |
| Wishlist | DELETE | `/wishlist/items/:itemId` | yes | — | — | 200 | 401, 404 | Repeat → 404 |
| Orders | POST | `/orders` | yes | — | shippingAddressId UUID, billingAddressId?, couponCode? | 201 | 401, 404 ORDER_ADDRESS_NOT_FOUND/COUPON_NOT_FOUND, 409 ORDER_INSUFFICIENT_STOCK/COUPON_USAGE_LIMIT_EXCEEDED, 422 ORDER_EMPTY_CART/ORDER_VARIANT_INACTIVE/coupon validity codes | Atomic checkout; optional coupon validated server-side, discount in totals, usage consumed in-tx |
| Orders | GET | `/orders` | yes | — | — | 200 | 401 | Own orders, newest first |
| Orders | GET | `/orders/:id` | yes | — | UUID param | 200 | 401, 404 ORDER_NOT_FOUND | Owner-scoped, snapshots |
| Orders (admin) | GET | `/orders/admin` | yes | ADMIN | `?page,limit,status,paymentStatus,search,from,to,sortBy,sortOrder` | 200 | 401, 403, 422 | All orders, newest first; `meta` pagination |
| Orders (admin) | GET | `/orders/admin/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 ORDER_NOT_FOUND | Any order + customer brief |
| Orders (admin) | PATCH | `/orders/admin/:id/status` | yes | ADMIN | `{ status, note? }` full-lifecycle transition | 200 | 401, 403, 404, 409 ORDER_INVALID_STATUS_TRANSITION/ORDER_STATUS_UNCHANGED/ORDER_CONCURRENT_UPDATE, 422 | CANCELLED restores inventory; appends history + customer notification atomically |
| Orders (admin) | PATCH | `/orders/admin/:id/payment` | yes | ADMIN | `{ status }` payment transition | 200 | 401, 403, 404, 409 PAYMENT_INVALID_STATUS_TRANSITION/ORDER_PAYMENT_MISSING, 422 | Status only; no gateway |
| Notifications | GET | `/notifications` | yes | — | `?limit` (1–50, default 20), `?unreadOnly=true\|false` | 200 | 401, 422 | Own notifications newest-first + `meta.unreadCount`; order rows carry `orderNumber` |
| Notifications | GET | `/notifications/unread-count` | yes | — | — | 200 | 401 | Authoritative `{ unreadCount }` for badges |
| Notifications | PATCH | `/notifications/:id/read` | yes | — | UUID param | 200 | 401, 404 NOTIFICATION_NOT_FOUND | Owner-scoped; returns `{ notification }` + `meta.unreadCount` |
| Notifications | POST | `/notifications/read-all` | yes | — | — | 200 | 401 | Marks own unread read; returns `{ updated }` + `meta.unreadCount` |
| Marketing (customer) | GET | `/marketing/notifications/active` | yes | — | — | 200 | 401 | Active in-window broadcasts newest-first (no per-user fan-out) |
| Marketing (admin) | GET | `/marketing/notifications/admin` | yes | ADMIN | — | 200 | 401, 403 | All broadcasts newest-first |
| Marketing (admin) | POST | `/marketing/notifications/admin` | yes | ADMIN | title*, message*, type?, isActive?, startsAt?, expiresAt?, linkType?+linkValue? | 201 | 401, 403, 422 | `linkValue` required with `linkType` |
| Marketing (admin) | GET | `/marketing/notifications/admin/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 MARKETING_NOT_FOUND | — |
| Marketing (admin) | PATCH | `/marketing/notifications/admin/:id` | yes | ADMIN | partial subset | 200 | 401, 403, 404, 422 | Non-empty body; date-range guarded |
| Marketing (admin) | DELETE | `/marketing/notifications/admin/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 MARKETING_NOT_FOUND | Deletable (no historical dependency) |
| Announcements | GET | `/announcements/current` | no | — | — | 200 | — | Public; `{ announcement: { message, linkLabel, linkTarget } \| null }`; null = hide the bar |
| Announcements (admin) | GET | `/announcements/admin` | yes | ADMIN | — | 200 | 401, 403 | All, priority-first |
| Announcements (admin) | POST | `/announcements/admin` | yes | ADMIN | message*, isActive?, startsAt?, expiresAt?, linkLabel?, linkTarget?, priority? | 201 | 401, 403, 422 | `linkTarget` internal-route only |
| Announcements (admin) | GET | `/announcements/admin/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 ANNOUNCEMENT_NOT_FOUND | — |
| Announcements (admin) | PATCH | `/announcements/admin/:id` | yes | ADMIN | partial subset | 200 | 401, 403, 404, 422 | Non-empty body; date-range guarded |
| Announcements (admin) | DELETE | `/announcements/admin/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 ANNOUNCEMENT_NOT_FOUND | Deletable |
| Reviews | POST | `/reviews` | yes | — | orderItemId UUID, rating 1–5 int, title?, comment? | 201 | 401, 404 REVIEW_ORDER_ITEM_NOT_FOUND, 409 REVIEW_ALREADY_EXISTS, 422 | productId derived server-side |
| Reviews | GET | `/reviews/me` | yes | — | — | 200 | 401 | Own reviews, newest first |
| Reviews | GET | `/reviews/:id` | yes | — | UUID param | 200 | 401, 404 REVIEW_NOT_FOUND | Owner-scoped |
| Reviews | PATCH | `/reviews/:id` | yes | — | rating?/title?/comment? | 200 | 401, 404, 422 REVIEW_UPDATE_INVALID | Owner-scoped |
| Reviews | DELETE | `/reviews/:id` | yes | — | UUID param | 200 | 401, 404 | Hard delete |
| Reviews (admin) | GET | `/reviews/admin` | yes | ADMIN | `?page,limit,isApproved,rating,productId,userId,search,sortBy,sortOrder` | 200 | 401, 403, 422 | All reviews + customer brief, newest first; `meta` pagination |
| Reviews (admin) | PATCH | `/reviews/admin/:id` | yes | ADMIN | `{ isApproved }` boolean | 200 | 401, 403, 404 REVIEW_NOT_FOUND, 422 | Approve (`true`)/reject (`false`); rejected stay listed |
| Reviews (admin) | DELETE | `/reviews/admin/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 REVIEW_NOT_FOUND | Hard delete; order records untouched |
| Coupons (admin) | GET | `/coupons` | yes | ADMIN | `?status=active\|inactive\|all` (default all), `?search=`, `?page=`, `?limit=` | 200 | 401, 403, 422 | All coupons, newest first; `meta` pagination |
| Coupons (admin) | GET | `/coupons/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 COUPON_NOT_FOUND | Full definition + usage |
| Coupons (admin) | POST | `/coupons` | yes | ADMIN | code*, discountType*, discountValue*, optional definition fields | 201 | 401, 403, 404 PRODUCT_NOT_FOUND, 409 COUPON_CODE_EXISTS, 422 | Code stored uppercased |
| Coupons (admin) | PATCH | `/coupons/:id` | yes | ADMIN | partial definition subset (`isActive` toggles availability) | 200 | 401, 403, 404, 409, 422 COUPON_UPDATE_INVALID | `usedCount` never writable |
| Coupons (admin) | DELETE | `/coupons/:id` | yes | ADMIN | — | 200 | 401, 403, 404, 409 COUPON_IN_USE | Refused once used; deactivate instead |
| Coupons | POST | `/coupons/validate` | yes | — | `{ code }` (lines read from caller's cart) | 200 | 401, 404 COUPON_NOT_FOUND, 409 COUPON_USAGE_LIMIT_EXCEEDED, 422 validation codes | Authoritative discount quote |

\* Cart add returns `CART_ITEM_NOT_FOUND` only for scoped-update paths;
unknown variants return `PRODUCT_VARIANT_NOT_FOUND`.

## 3. Request contract details

- Auth register: `email` (trimmed, lowercased, valid, ≤ 255),
  `password` (8–128 chars), `firstName`/`lastName` (≤ 100, optional),
  `phone` (≤ 30, optional). Login: `email`, `password` (≥ 1 char).
- Users update: `firstName`, `lastName`, `phone` (each nullable, trimmed,
  min 1 when present); empty object → `422`.
- Addresses: `fullName` (≤ 150), `phone` (≤ 30), `addressLine1` (≤ 255),
  `addressLine2` (≤ 255, optional), `city`/`state` (≤ 100),
  `postalCode` (≤ 20), `country` (≤ 100), `label` (≤ 50, optional),
  `isDefault` (boolean, optional). Create requires all but label/line2.
- Categories: `name` (1–150, required on create), `slug` (≤ 180,
  auto-derived when omitted), `description` (nullable), `image` (≤ 500,
  nullable), `parentId` (nullable), `isActive`, `sortOrder` (int ≥ 0).
- Products: `name` (1–255), `categoryId`, optional `slug` (≤ 280),
  `description`/`shortDescription`/`brand`, `isActive`, `isFeatured`,
  optional `variants[]`. Variant: `sku` (1–100, unique), `name` (1–150),
  `price` (non-negative decimal string/number, ≤ 2 decimals),
  `compareAtPrice`/`barcode`/`weight` (nullable), `isActive`.
- Inventory: all under `/products/:productId/variants/:variantId/`,
  variant must belong to product. Initialize: `quantity` int 0–2³¹−1.
  Adjust: `quantity` non-zero int delta within ±2³¹−1. Optional `note`
  (≤ 1000). `reservedQuantity` is never accepted. Admin list
  `GET /inventory` (`?page,limit,search,stock=in|out,active=true|false,
  sortBy=sku|createdAt|updatedAt,sortOrder`): every variant with its
  product brief and stock record (`null` = uninitialized, never zero);
  `stock=out` matches available ≤ 0 or a missing record. Ledger history
  `GET .../inventory/transactions` (`?page,limit`, newest first).
- Dashboard (admin): `GET /dashboard/summary?range=today|week|month|year`
  (default `today`). Boundaries are UTC day edges computed server-side
  (week starts Monday; no timestamps cross the wire). Recognized revenue
  = SUM(`grandTotal`) over DELIVERED **or COMPLETED** orders whose
  latest payment is PAID (COMPLETED is entered only from DELIVERED, so
  both prove handover); cancelled, in-flight, unpaid, failed, and
  refunded orders excluded,
  attributed to order creation time. Status counts now expose
  `pending/confirmed/processing/dispatched (incl. legacy SHIPPED)/
  inTransit/arrivedInCity/outForDelivery/delivered/completed/
  cancelled` (no `shipped` key). Buckets (hourly/daily/monthly per
  range) are zero-filled across the full frame; bucket sums equal period
  aggregates. Also returns all-time status counts and the actionable
  stock snapshot (active variants of active products).
- Media: `multipart/form-data` with the file in field `image`; optional
  text fields `variantId`, `altText` (≤ 255), `sortOrder` (int ≥ 0),
  `isPrimary` (boolean or `"true"`/`"false"`). `variantId` scopes the
  image to one variant of the same product (validated product-scoped;
  multiple images per variant allowed); omitted/`null` means
  product-level. Variant deletion nulls its images' `variantId`
  (records survive as product-level); image deletion removes file + row.
- Cart: add `{ variantId, quantity }`; update `{ quantity }`; quantity is
  a JSON number, integer, 1–2147483647. Never accepted: `userId`, `price`,
  `productId`, stock fields, unknown fields.
- Wishlist: add `{ productId }` only. No quantity, no variant, no price.
  Product-level persistence by design; briefs carry default-variant
  display data (see §4).
- Orders: `{ shippingAddressId, billingAddressId?, couponCode? }` (UUIDs
  of own addresses plus an optional coupon code). Never accepted:
  `userId`, `orderNumber`, `status`, `subtotal`/`grandTotal`/totals,
  prices, `paymentStatus`, `method`, unknown fields.
- Orders (admin): status `{ status, note? }` where `status` is any
  `OrderStatus` (`SHIPPED` accepted by validation but unreachable —
  no state transitions into it) and `note` is an optional ≤ 500-char
  operational note stored on the history row. Unknown/empty bodies →
  `422`.
- Reviews: create `{ orderItemId, rating, title?, comment? }`; rating is a
  JSON integer 1–5; `title` 1–255 chars; `comment` 1–5000 chars; both
  nullable/optional. Update accepts any non-empty subset of
  rating/title/comment. Never accepted: `userId`, `productId`,
  `orderItemId` (on update), `verified`, `isApproved`, `status`.
- Coupons (admin): `code` (trimmed, uppercased, 1–50, unique),
  `description` (≤ 500, nullable), `discountType`
  (`PERCENTAGE|FIXED`), `discountValue` (decimal string/number;
  percentage in (0, 100], fixed > 0), `minimumOrderAmount?` /
  `maximumDiscountAmount?` (nullable amounts), `usageLimit?` (nullable
  int ≥ 1; null = unlimited), `startsAt?`/`expiresAt?` (nullable
  ISO-8601 date-times; expiry after start), `isActive?` (default true),
  `productIds?` (UUID array, empty = all products). Update accepts any
  non-empty subset; `usedCount`, per-customer limits, category ids, and
  unknown fields are never accepted.
- All JSON bodies are strict: extra fields → `422`. Malformed JSON →
  `400`. Malformed UUIDs in bodies or params → `422`.

## 4. Response contract details

- Auth: `data.user` safe shape `{ id, email, firstName, lastName, phone,
  isActive, roles[], createdAt, updatedAt }` (no password hash, ever);
  login/refresh add `data.accessToken`; refresh sets the `HttpOnly`
  refresh cookie.
- Users: `data.user` same safe shape as auth.
- Addresses: list returns a bare array; single operations return
  `data.address`; delete returns `{ id, message }`.
- Categories: list returns a bare array; single operations return
  `data.category` with hierarchy fields.
- Products/variants: list returns a bare array; single returns
  `data.product` / `data.variant`. Money as `"xx.xx"` strings; variants
  carry `price`, `compareAtPrice`, `sku`, `isActive`.
- Inventory: `data.inventory` with `quantity`, `reservedQuantity`, and
  computed `availableQuantity`. Admin list returns `data.items[]` with
  `product`/`variant` briefs and nullable `inventory`, plus `meta`.
  Ledger returns `data.transactions[]` (signed `quantity`, `type`,
  `referenceType`, `referenceId`, `note`) plus `meta`.
- Dashboard: `data.summary` with `range`, `periodStart`/`periodEnd`/
  `generatedAt` (ISO UTC), `granularity`, all-time `orders` status
  counts, all-time recognized `revenue.total`, `period` orders/revenue,
  zero-filled `buckets[]` (`bucketStart`, `orders`, `revenue`), and the
  `inventory` snapshot. Money as `"xx.xx"` strings.
- Media: list returns a bare array; single returns `data.image` with
  `filename`, `storagePath` reference, `imageType: "webp"`, `altText`,
  `sortOrder`, `isPrimary`, plus `productId` and nullable `variantId`
  (ordered by `sortOrder`, then oldest first).
- Cart: `data.cart` with `items[]` (`unitPrice`, `lineTotal` strings plus
  variant/product briefs), `totalQuantity`, `itemCount`, `subtotal`.
  Each item carries `image` (`{ storagePath, altText }` resolved
  server-side: variant primary → variant first → product primary →
  product first) or `null` when the product has no media.
- Wishlist: `data.wishlist` with `items[]` (product briefs) and
  `itemCount`. Product briefs additionally carry `variants[]`
  (`{ id, name, sku, price, isActive }`) so clients can show the default
  purchasable variant without changing product-level persistence.
- Orders: `data.order(s)` with `orderNumber` (`ORD-YYYY-NNNNNN`), `status`,
  string money totals, `items[]` snapshots (`productName`, `variantName`,
  `sku`, `unitPrice`, `discount`, `quantity`, `lineTotal`,
  `imageStoragePath` — immutable variant-image snapshot taken at order
  time, `null` for pre-snapshot orders or imageless products),
  `addresses[]` (`SHIPPING` plus optional `BILLING` snapshots),
  `payments[]` (`CASH_ON_DELIVERY`, `PENDING`, amount = grand total,
  `INR`).
- Orders (admin): same shape plus `userId` and a `customer` brief
  (`id`, `email`, `firstName`, `lastName`, `phone` — never password
  hashes or tokens). Admin list returns `data.orders[]` with `meta`
  (`page`, `limit`, `total`, `totalPages`).
- Admin order status machine (full fulfilment, forward-only):
  `PENDING → CONFIRMED|CANCELLED`, `CONFIRMED → PROCESSING|CANCELLED`,
  `PROCESSING → DISPATCHED|CANCELLED`, `DISPATCHED → IN_TRANSIT`,
  `IN_TRANSIT → ARRIVED_IN_CITY`, `ARRIVED_IN_CITY → OUT_FOR_DELIVERY`,
  `OUT_FOR_DELIVERY → DELIVERED`, `DELIVERED → COMPLETED`,
  `COMPLETED|CANCELLED` terminal. `SHIPPED` is legacy (never produced;
  compat path `SHIPPED → IN_TRANSIT|DELIVERED`). Same-status writes →
  `409 ORDER_STATUS_UNCHANGED` (no duplicate history/notification).
  Every transition appends exactly one immutable
  `order_status_history` row (optional admin `note` ≤ 500 chars) and
  exactly one `ORDER_STATUS` customer notification in the same
  transaction. `CANCELLED` atomically restores checkout-decremented
  quantities with `ORDER_CANCELLED` ledger rows. Order payloads carry
  `statusHistory[]` oldest-first (`{ id, status, previousStatus, note,
  createdAt }`); pre-milestone orders carry `[]` (readers fall back to
  `status`/`createdAt`/`updatedAt`, never invent rows).
- Notifications: per-user transactional rows (`ORDER_STATUS` type)
  created server-side inside the order-status transaction
  (`{ id, type, title, message, orderId, orderNumber, isRead, createdAt,
  readAt }`). Unread counts are authoritative
  (`GET /notifications/unread-count`, `meta.unreadCount`). Marketing
  broadcasts are NOT fanned out here — they live in
  `marketing_notifications` and are read via
  `GET /marketing/notifications/active`
  (`{ id, title, message, type: DEAL|OFFER|ANNOUNCEMENT, linkType:
  SHOP|CATEGORY|PRODUCT|COUPON|null, linkValue, startsAt, expiresAt,
  createdAt }`; active + in-window, newest first). The public
  announcement (`GET /announcements/current`, no auth) returns the
  single deterministic current row
  (`{ message, linkLabel, linkTarget }`) or `{ announcement: null }` —
  safe fields only, never admin metadata.
- Admin payment machine (COD/manual, status only): `PENDING →
  PAID|FAILED`, `FAILED → PAID`, `PAID → REFUNDED`, `REFUNDED`
  terminal. `REFUNDED` records a manual refund; no gateway exists.
- Reviews: `data.review(s)` with `productId`, `orderItemId`, `rating`,
  `title`, `comment`, `isApproved`, and a product brief. No user or order
  data embedded.
- Coupons (admin): `data.coupon(s)` with `code`, `description`,
  `discountType`, `discountValue` (`"xx.xx"` string), nullable
  `minimumOrderAmount`/`maximumDiscountAmount` strings, `usageLimit`
  (nullable) + authoritative `usedCount`, nullable `startsAt`/`expiresAt`
  ISO strings, `isActive`, `products[]` (`{ productId }` links; empty =
  all products eligible). Admin list returns `data.coupons[]` with `meta`
  (`page`, `limit`, `total`, `totalPages`).

## 5. Authorization matrix

| Resource   | Public | Customer | Admin |
| ---------- | ------ | -------- | ----- |
| health     | YES    | YES      | YES   |
| auth       | YES    | YES      | YES   |
| users      | NO     | OWNED    | OWNED + ADMIN OVERRIDE (`GET /users`, `GET /users/:id`, `PATCH /users/:id`) |
| addresses  | NO     | OWNED    | NO*   |
| categories | YES (reads) | YES (reads) | ADMIN ONLY (writes) |
| products   | YES (reads) | YES (reads) | ADMIN ONLY (writes) |
| inventory  | NO     | NO       | ADMIN ONLY (per-variant + `/inventory` list + ledger) |
| dashboard  | NO     | NO       | ADMIN ONLY (`/dashboard/summary`) |
| notifications | NO  | OWNED    | NO*   |
| marketing  | NO     | READS (active broadcasts) | ADMIN ONLY (CRUD) |
| announcements | YES (current only) | YES (current) | ADMIN ONLY (CRUD) |
| media      | YES (reads) | YES (reads) | ADMIN ONLY (writes) |
| cart       | NO     | OWNED    | NO*   |
| wishlist   | NO     | OWNED    | NO*   |
| orders     | NO     | OWNED    | OWNED + ADMIN OVERRIDE (`/orders/admin*`) |
| payments   | NOT EXPOSED | NOT EXPOSED | NOT EXPOSED |
| reviews    | NO     | OWNED    | OWNED + ADMIN OVERRIDE (`/reviews/admin*`) |
| coupons    | NO     | NO       | ADMIN ONLY |

\* No admin override endpoints exist for these resources; admins use the
same ownership-scoped access as customers. Orders, users, and reviews
are the exceptions: customer history stays ownership-scoped while
`/orders/admin*` (list/detail/status/payment), `/users` + `/users/:id`
(list/detail/activate) and `/reviews/admin*` (list/moderate/delete)
provide the ADMIN-only operational surfaces. Customer addresses remain
owner-scoped with no admin override by design.

## 6. Ownership rules

- Users: `GET`/`PATCH /users/me` operate on `req.user.id` only;
  `GET /users`, `GET /users/:id`, `PATCH /users/:id { isActive }`
  (ADMIN-only) list/inspect/activate across accounts with safe fields.
- Addresses: every query predicates `(id, userId)` at the database layer.
- Cart: one row per user (`user_id` unique); items always resolved through
  the owner's cart id.
- Wishlist: one row per user; items resolved through the owner's wishlist.
- Orders: list/detail predicate `(id, userId)`; checkout consumes only the
  caller's cart and addresses. Order `statusHistory` is read-scoped the
  same way (embedded in the owned order payload).
- Notifications: every query predicates `(id, userId)` at the database
  layer; cross-user ids return `404 NOTIFICATION_NOT_FOUND`, never `403`.
- Marketing/announcements: customer `active`/`current` reads expose only
  safe published fields; all writes are ADMIN-only.
- Reviews: reads and mutations predicate `(id, userId)`; creation requires
  an order item from the caller's own orders, with `productId` derived
  from that item. `/reviews/admin*` (ADMIN-only) lists/moderates/deletes
  across owners; moderation writes only `isApproved` (boolean, no enum).
- Cross-owner access uniformly returns the resource `404` variant.

## 7. Intentional non-endpoints

Confirmed absent (all return `404 ROUTE_NOT_FOUND`):

- Checkout coupon support EXISTS (customer): `POST /coupons/validate`
  (owner-cart discount quote) + optional `couponCode` on `POST /orders`
  (re-validated server-side; `discountTotal`/`grandTotal`/payment derived
  in-transaction; usage consumed atomically with guarded increments).
  Still absent: bulk generation, CSV import/export, promotion providers.
- Online payment endpoints (capture, providers) and webhooks.
- Review public listing and aggregate endpoints (moderation state is
  authoritative via `/reviews/admin*`, but no public product-review
  listing or average/count endpoint consumes it yet).
- User deletion, password reset/change, and admin-side customer creation
  endpoints (account lifecycle is activate/deactivate only).
- Any other undocumented admin endpoints.
- A cart clear-all endpoint (delete items individually; empty carts persist).

## 8. API invariants

- Products, categories, and variants are deactivated, not deleted; public
  reads show active records only.
- Only the inventory module mutates stock; every mutation writes a ledger
  row; decrements are conditional and never drive stock negative.
- Cart adds increment one row per variant; updates set absolute values;
  prices are read live from variants; stock is never reserved.
- Checkout is one atomic transaction: order, item snapshots, address
  snapshots, COD/`PENDING` payment, conditional stock decrements, ledger
  entries, cart clearing — all or nothing, with unique order numbers.
- Order snapshots (items, addresses, payment amount) never change after
  creation.
- Reviews require a verified purchase via the caller's own order item; one
  review per order item and per user/product; inactive products keep
  existing reviews visible.
- Coupons are ADMIN-managed definitions (`/coupons`, full CRUD).
  Validation semantics: codes uppercase + unique; `PERCENTAGE` in (0,
  100] on the eligible subtotal (half-up rounding), `FIXED` capped at
  the eligible subtotal, optional `maximumDiscountAmount` cap,
  `minimumOrderAmount` tested against the full subtotal, product links
  restrict eligibility (empty = all), `startsAt`/`expiresAt` inclusive,
  `isActive=false` rejected, `usageLimit` null = unlimited. Customer
  checkout applies coupons end-to-end: `POST /coupons/validate` quotes
  against the caller's cart; `POST /orders { couponCode? }` re-validates
  fresh, writes the `discountTotal` snapshot, charges the discounted
  `grandTotal`, and consumes usage inside the order transaction
  (guarded increment — failed/exhausted orders never consume).
- Media uploads are verified by content (Sharp), capped (5MB, 8000px),
  converted to WebP under server-generated names inside a
  traversal-protected storage root.

## 9. Contract verification status

The API was locally smoke-tested: server startup, health, full
register→login→me→protected-resource→orders→reviews→logout flows, plus
negative, ownership, validation, conflict, concurrency, and regression
checks across all documented modules. No blockers were found.

Not claimed: production deployment, production migration execution, load
testing, penetration testing, or a permanent integration test suite.

## 10. Maintenance rule

- `docs/API.md` remains the primary human API contract.
- This matrix must be updated whenever an endpoint contract changes.
- Implementation must not silently introduce undocumented routes.
- Source code, API docs, and this matrix must remain consistent; on any
  conflict, stop and resolve the discrepancy before changing behavior.

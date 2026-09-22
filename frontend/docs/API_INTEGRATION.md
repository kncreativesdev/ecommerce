# Tech Pulse — Frontend ↔ Backend Integration Contract (API_INTEGRATION)

Authoritative backend sources: `backend/docs/API.md`,
`backend/docs/API_CONTRACT_MATRIX.md`, `backend/docs/FRONTEND_INTEGRATION.md`,
`backend/docs/SECURITY.md`, `backend/docs/DATABASE.md`. Route existence
verified in `backend/src/routes/index.js` and module route files
(products, orders, reviews, cart).

Conventions used below:

- Base: `{VITE_API_URL}` which MUST include `/api/v1`.
- Auth column: `PUBLIC` = no token; `BEARER` = `Authorization: Bearer
  <accessToken>`; `COOKIE` = HttpOnly `refresh_token` cookie (browser-sent,
  `credentials: "include"`, never read by JS).
- Success envelope: `{ "success": true, "data": ... }`. Collections from list
  endpoints used here return a **bare array in `data`** unless noted.
- Error envelope: `{ "success": false, "error": { "code", "message" } }`
  plus `details[]` (`{path, message}`) on Zod validation failures.
- All JSON bodies are strict: unknown/protected fields → `422`. Malformed
  JSON → `400`. Malformed UUIDs → `422`.
- Cross-owner access returns `404` (never `403`) to avoid leaking existence.
- Frontend MUST send only the documented fields.

Global status map: `200` ok · `201` created · `400` malformed ·
`401` unauthenticated · `403` forbidden/admin-only or inactive account ·
`404` not found (or another user's resource) · `409` conflict ·
`422` validation/business failure · `413` upload too large ·
`429` rate limited · `500` internal (no internals exposed).

---

## 1. Health

| Item | Value |
|------|-------|
| Method / endpoint | `GET /health` |
| Auth | PUBLIC |
| Response | `200 { success: true, data: { status: "healthy" } }` |
| Frontend usage | Readiness probe / status indicator only |

## 2. Auth

### 2.1 Register — `POST /auth/register` (PUBLIC) → `201`

Request (JSON, strict):

```json
{ "email": "user@example.com", "password": "8-128 chars",
  "firstName": "optional ≤100", "lastName": "optional ≤100",
  "phone": "optional ≤30" }
```

- Email is trimmed + lowercased server-side (mirror client-side).
- Every new account gets role `CUSTOMER`. No self-serve admin signup.
- Response: `data.user = { id, email, firstName, lastName, phone, isActive,
  roles[], createdAt, updatedAt }` (no token documented).
- Frontend usage: validate with Zod, then **auto-login** via `POST
  /auth/login` (register alone does not establish a session).
- Errors: `409 AUTH_EMAIL_ALREADY_EXISTS` → email field error; `422` →
  field errors from `details[]`; `429` → backoff.

### 2.2 Login — `POST /auth/login` (PUBLIC) → `200`

Request: `{ "email", "password" (≥1 char) }`.
Response: `data.user` (safe shape) + `data.accessToken`; sets HttpOnly
`refresh_token` cookie.
Frontend usage: keep `accessToken` in memory (Zustand, not localStorage);
attach as bearer; bootstrap `GET /auth/me`, cart, wishlist.
Errors: `401 AUTH_INVALID_CREDENTIALS` (form-level); `403
AUTH_ACCOUNT_INACTIVE` ("account disabled, contact support"); `422`; `429`.

### 2.3 Refresh — `POST /auth/refresh` (COOKIE) → `200`

Request: no body; cookie sent automatically (`credentials: "include"`).
Response: new `data.accessToken` + rotated cookie.
Frontend usage: single-flight silent refresh on `401`, retry original once;
second `401` → login. One silent refresh attempt on app boot.
Errors: `401 AUTH_REFRESH_TOKEN_INVALID` → re-authenticate; `429` → backoff.

### 2.4 Logout — `POST /auth/logout` → `200`

No body (send credentials so the cookie clears). Frontend usage: clear token,
user, cart/wishlist mirrors. Always succeeds locally even if the call fails.

### 2.5 Me — `GET /auth/me` (BEARER) → `200`

Response: `data.user` (safe shape). Frontend usage: session bootstrap /
auth-gate check. `401` → refresh-then-login flow.

## 3. Users (BEARER, self only)

### 3.1 Get profile — `GET /users/me` → `200`

Response: `data.user` (same safe shape as auth).

### 3.2 Update profile — `PATCH /users/me` → `200`

Request: non-empty subset of `{ firstName, lastName, phone }` (each
nullable, trimmed, min 1 when present). Empty object → `422`
(`USER_UPDATE_INVALID` / `VALIDATION_ERROR`).
Frontend usage: disable save when untouched; map `details[]` to fields.
`403 AUTH_ACCOUNT_INACTIVE` possible.

## 4. Addresses (BEARER, owner-scoped; cross-owner → `404 ADDRESS_NOT_FOUND`)

Address field contract — create requires all except `label`/`addressLine2`:

```json
{ "fullName": "≤150", "phone": "≤30", "addressLine1": "≤255",
  "addressLine2": "≤255 optional", "city": "≤100", "state": "≤100",
  "postalCode": "≤20", "country": "≤100",
  "label": "≤50 optional", "isDefault": "boolean optional" }
```

| Method / endpoint | Success | Frontend usage |
|-------------------|---------|----------------|
| `GET /addresses` | `200`, `data` = bare array | Address book, checkout picker (prefer `isDefault`) |
| `POST /addresses` | `201`, `data.address` | Add; `401`/`422` handling |
| `GET /addresses/:id` (UUID) | `200`, `data.address` | Edit prefill (or reuse cached row) |
| `PATCH /addresses/:id` (UUID) | `200`, `data.address` | Partial edit; empty/unknown fields → `422 ADDRESS_UPDATE_INVALID` |
| `DELETE /addresses/:id` (UUID) | `200 { id, message }` | Remove; repeat → `404` (treat idempotent) |

## 5. Categories (reads PUBLIC; writes ADMIN-only — storefront uses reads)

| Method / endpoint | Success | Frontend usage |
|-------------------|---------|----------------|
| `GET /categories` | `200`, `data` = bare array, active only | Nav, tiles, filters. Fields incl. `id, name, slug, description, image, parentId, sortOrder` |
| `GET /categories/:id` | `200`, `data.category` | Category page header; `404 CATEGORY_NOT_FOUND` → not-found |
| `POST /categories` | ADMIN only | NOT CALLED by storefront |
| `PATCH /categories/:id` | ADMIN only | NOT CALLED by storefront |
| `DELETE /categories/:id` | ADMIN only (soft-deactivate) | NOT CALLED by storefront |

## 6. Products (reads PUBLIC; writes ADMIN-only — storefront uses reads)

Product/variant read shape: `data` (list) = bare array, active only; single
= `data.product` with embedded `category` brief + `variants[]`. Money arrives
as decimal strings (`"49.99"`) — display formatting only. Variants carry
`id, sku, name, price, compareAtPrice, isActive`. Slugs are display metadata;
API calls use UUIDs. **No pagination/filter/sort query params are
documented** — the storefront fetches the arrays and filters client-side.

| Method / endpoint | Success | Frontend usage |
|-------------------|---------|----------------|
| `GET /products` | `200`, bare array | Catalog cache: home rails, shop, category, search |
| `GET /products/:id` | `200`, `data.product` | Detail page; `404 PRODUCT_NOT_FOUND` → not-found |
| `POST /products`, `PATCH /products/:id`, `DELETE /products/:id` | ADMIN only | NOT CALLED |
| `POST /products/:productId/variants`, `PATCH .../variants/:variantId`, `DELETE ...` | ADMIN only | NOT CALLED |

## 7. Inventory — ADMIN ONLY (no customer endpoint)

`GET/POST/PATCH /products/:productId/variants/:variantId/inventory` require
`ADMIN`. Response shape (`data.inventory`: `quantity`, `reservedQuantity`,
computed `availableQuantity`) is never consumed by the storefront. Customer
stock UX is limited to `409 INSUFFICIENT_STOCK` handling on cart/checkout.

## 8. Media / product images

| Method / endpoint | Auth | Success | Frontend usage |
|-------------------|------|---------|----------------|
| `GET /products/:productId/images` | PUBLIC | `200`, bare array | Gallery/list thumbnails. `404 PRODUCT_NOT_FOUND` if product missing/inactive |
| `GET /products/:productId/images/:imageId` | PUBLIC | `200`, `data.image` | Rarely needed directly |
| `POST /products/:productId/images` (`multipart/form-data`, field `image`, JPEG/PNG/WebP ≤5MB/8000px → WebP) | ADMIN | `201` | NOT CALLED |
| `PATCH .../images/:imageId`, `DELETE ...` | ADMIN | `200` | NOT CALLED |

Image record fields: `filename`, `storagePath` reference,
`imageType: "webp"`, `altText` (≤255), `sortOrder`, `isPrimary`.
**Deployment caveat**: no static file-serving route is documented, so
`storagePath` cannot be hotlinked until serving is resolved. Frontend image
URL = `{VITE_MEDIA_BASE_URL}{storagePath}` with placeholder fallback; see
FRONTEND_SPEC §16. Upload/admin paths are out of scope for the storefront.

## 9. Cart (BEARER, owner-scoped, lazy-created, persists when empty)

Cart shape: `data.cart = { items[] ({ id, variantId, quantity, unitPrice,
lineTotal } as strings + variant/product briefs), totalQuantity, itemCount,
subtotal }`. Prices always from current variant records. Never send
`userId`, `price`, `productId`, stock fields, or unknown fields.

| Method / endpoint | Body | Success | Semantics / errors |
|-------------------|------|---------|--------------------|
| `GET /cart` | — | `200` | Lazy-creates; frontend bootstrap after login |
| `POST /cart/items` | `{ variantId: UUID, quantity: int ≥1 }` | `200` updated cart | **Increment**: re-add grows the line. `404 PRODUCT_VARIANT_NOT_FOUND`, `409 INSUFFICIENT_STOCK`, `422 PRODUCT_VARIANT_INACTIVE` |
| `PATCH /cart/items/:itemId` | `{ quantity: int ≥1 }` | `200` updated cart | **Absolute** set. `404 CART_ITEM_NOT_FOUND`, `409` on stock race |
| `DELETE /cart/items/:itemId` | — | `200` | Repeat → `404` (treat as removed). No clear-all: iterate |

Frontend usage: render server totals only; refetch-or-apply returned cart on
every mutation; optimistic quantity steppers must reconcile with the response.

## 10. Wishlist (BEARER, owner-scoped, product-level, lazy-created)

Wishlist shape: `data.wishlist = { items[] (product briefs), itemCount }`.
No quantity, no variant, no price — send ONLY `{ productId }` on add.

| Method / endpoint | Success | Semantics / errors |
|-------------------|---------|--------------------|
| `GET /wishlist` | `200` | Bootstrap after login |
| `POST /wishlist/items` `{ productId: UUID }` | `200` | `409 WISHLIST_ITEM_EXISTS` → treat as saved; `404 PRODUCT_NOT_FOUND`; `422 PRODUCT_INACTIVE` ("no longer available") |
| `DELETE /wishlist/items/:itemId` | `200` | Repeat → `404` (treat as removed) |

## 11. Orders / checkout (BEARER, owner-scoped)

### 11.1 Checkout — `POST /orders` → `201`

Request (STRICT — only these fields):

```json
{ "shippingAddressId": "<own address UUID>",
  "billingAddressId": "<own address UUID, optional>" }
```

Server atomically: validates own cart + addresses + variant status/stock,
totals server-side, creates order + item snapshots + address snapshots +
`CASH_ON_DELIVERY`/`PENDING` payment, decrements inventory with ledger rows,
clears the cart, mints unique `orderNumber` (`ORD-YYYY-NNNNNN`).
Never accepted: `userId`, `orderNumber`, `status`, any totals/prices,
`paymentStatus`, `method`, coupon/discount fields, unknown fields.

Response: `data.order = { id (UUID), orderNumber, status: "PENDING",
subtotal/discountTotal/shippingTotal/taxTotal/grandTotal (strings), currency:
"INR", items[] snapshots ({ id, productName, variantName, sku, unitPrice,
discount, quantity, lineTotal }), addresses[] ({ SHIPPING } + optional
{ BILLING } snapshots), payments[] ({ method: "CASH_ON_DELIVERY", status:
"PENDING", amount = grand total, currency: "INR" }) }`.

Frontend usage: save `order.id` → confirmation route; save `items[].id` for
review entry points. Errors: `404 ORDER_ADDRESS_NOT_FOUND` (re-pick);
`409 ORDER_INSUFFICIENT_STOCK` (refresh cart, highlight); `422
ORDER_EMPTY_CART` / `ORDER_VARIANT_INACTIVE`; `401`.

### 11.2 History — `GET /orders` (BEARER) → `200`

Own orders, newest first (`data.orders` per matrix convention). Frontend:
order-history list; render snapshots only.

### 11.3 Detail — `GET /orders/:id` (BEARER, UUID) → `200`

Owner-scoped single order (`data.order`). Other users' ids → `404
ORDER_NOT_FOUND` → "order not found" UI.

## 12. Reviews (BEARER, owner-scoped; creation = verified purchase only)

Review shape: `data.review(s) = { id, productId, orderItemId, rating, title,
comment, isApproved, product brief }`. No user/order data embedded.

| Method / endpoint | Body | Success | Rules |
|-------------------|------|---------|-------|
| `POST /reviews` | `{ orderItemId: UUID, rating: int 1–5, title?: 1–255, comment?: 1–5000 }` (text optional/nullable; `productId` derived server-side — never send `userId/productId/verified/isApproved/status`) | `201` | order item must be caller's own (`404 REVIEW_ORDER_ITEM_NOT_FOUND`); one review per order item and per user/product (`409 REVIEW_ALREADY_EXISTS`) |
| `GET /reviews/me` | — | `200` | Own reviews, newest first → "My reviews" page + own-review lookup per product |
| `GET /reviews/:id` (UUID) | — | `200` | Owner-scoped; others → `404 REVIEW_NOT_FOUND` |
| `PATCH /reviews/:id` | non-empty subset of `{ rating, title, comment }` | `200` | `422 REVIEW_UPDATE_INVALID` on empty/unknown |
| `DELETE /reviews/:id` | — | `200` | Hard delete; repeat → `404` |

## 13. Payments / COD — NO customer HTTP surface

Payments are created server-side inside `POST /orders` (method
`CASH_ON_DELIVERY`, status `PENDING`, `INR`). No capture/refund/provider/
webhook endpoints exist. The storefront renders `payments[]` from the order
snapshot and offers no payment actions.

## 14. Error-case quick reference (frontend mapping)

| HTTP | Codes seen | UI |
|------|-----------|----|
| 400 | malformed JSON / `MEDIA_INVALID_TYPE`, `MEDIA_UPLOAD_FAILED` (admin paths) | Fix request construction; not retryable as-is |
| 401 | `AUTH_INVALID_CREDENTIALS`, `AUTH_REFRESH_TOKEN_INVALID`, generic | Silent refresh once → login |
| 403 | `AUTH_ACCOUNT_INACTIVE`, admin-only on catalog/inventory/media writes | Support message / hide admin UI (no admin UI in storefront) |
| 404 | `ADDRESS_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `PRODUCT_VARIANT_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `ORDER_NOT_FOUND`, `ORDER_ADDRESS_NOT_FOUND`, `REVIEW_NOT_FOUND`, `REVIEW_ORDER_ITEM_NOT_FOUND`, `MEDIA_NOT_FOUND`, `ROUTE_NOT_FOUND` | Not-found / already-removed messaging; never distinguish missing vs another user's |
| 409 | `AUTH_EMAIL_ALREADY_EXISTS`, `CATEGORY_SLUG_EXISTS`, `PRODUCT_SLUG_EXISTS`, `SKU`, `BARCODE`, `WISHLIST_ITEM_EXISTS`, `REVIEW_ALREADY_EXISTS`, `INSUFFICIENT_STOCK`, `ORDER_INSUFFICIENT_STOCK` | Specific message + refresh affected data |
| 422 | `VALIDATION_ERROR` + `details[]`, `USER_UPDATE_INVALID`, `ADDRESS_UPDATE_INVALID`, `PRODUCT_VARIANT_INACTIVE`, `PRODUCT_INACTIVE`, `ORDER_EMPTY_CART`, `ORDER_VARIANT_INACTIVE`, `REVIEW_UPDATE_INVALID`, `MEDIA_UPDATE_INVALID` | Field highlights; strip unknown fields |
| 429 | rate limited | Back off; slow down auth flows |
| 500 | internal | Generic message + timestamp + path |

---

## 15. DO NOT INVENT

Verified absent from the backend docs AND route table (undocumented paths
return `404 ROUTE_NOT_FOUND`). Do not design, call, or promise these:

1. **No public stock quantity** — inventory read/initialize/adjust are
   ADMIN-only. No "X left in stock" customer UI backed by an API.
2. **No clear-cart endpoint** — `DELETE /cart/items/:itemId` per line only;
   empty carts persist (never deleted server-side).
3. **No online payment provider** — no Razorpay/Stripe/UPI/card endpoints,
   no capture/refund, no webhooks, no payment mutation. COD only.
4. **No customer order-cancellation endpoint** — no status mutation of any
   kind. `CANCELLED` exists only as a data-model status value.
5. **No public review listing or aggregates** — no "reviews for product X",
   no rating averages/distributions, no moderation/approval endpoints.
   Only: create-from-own-order-item, `GET /reviews/me`, own `GET/PATCH/DELETE
   /reviews/:id`.
6. **No coupon API** — coupons exist only as an internal
   validation/discount service with no HTTP surface and no checkout
   integration. No coupon list/validate/apply UI.
7. **No catalog query API** — no documented pagination, search, filter, or
   sort parameters on `GET /products` / `GET /categories`. Client-side only
   until the backend adds them.
8. **No static image-serving route** — image metadata is readable but
   `storagePath` delivery is a deployment concern, not an API feature.
9. **No admin-override customer endpoints** — admins use the same
   ownership-scoped access for users/addresses/cart/wishlist/orders/reviews;
   no customer storefront screen needs an admin mode.
10. **No guest checkout** — cart, wishlist, and orders all require
    authentication. No anonymous cart merge endpoint.
11. **No password-reset / change-password / email-verification endpoints** —
    none documented; do not build those flows.
12. **No user avatar upload endpoint** — profile is `firstName/lastName/phone`
    only; `storage/uploads/users/` is a storage-layout note, not an API.
13. **No notifications API** — no module, table, or endpoint. Header bell is a
    future seam with an honest empty state; no fabricated notification data.
14. **No company/support/contact API** — no module, table, or endpoint.
    Support-page company data stays config-driven placeholders until the
    backend lands (see BACKEND_REQUIREMENTS_GAP.md §1); never present config
    content as database-backed.
15. **No popularity/newest/discount endpoints** — merchandising derives
    client-side from verified fields (`isFeatured`, `createdAt`, variant
    `price`/`compareAtPrice`). No sales/views/order-count signal exists.

## 16. Manager Master-data mappings (existing schema — no duplicate tables)

### 16.1 ProductMaster → `Product` + `ProductVariant`

| Manager term | Existing equivalent | Status |
|--------------|---------------------|--------|
| ProductID | `Product.id` (UUID) | EXISTS |
| ProductCode | `ProductVariant.sku` (unique) | EXISTS (per purchasable unit, not per product) |
| ProductName | `Product.name` | EXISTS |
| Description | `Product.description` + `shortDescription` | EXISTS |
| CategoryID | `Product.categoryId` → `Category.id` | EXISTS |
| MRPRate | `ProductVariant.compareAtPrice` (nullable) | EQUIVALENT — MRP lives on the variant; absent = no MRP claim |
| DiscountedRate | `ProductVariant.price` (selling price) | EXISTS |
| DiscountSpec | No text field; discount is DERIVED (`compareAtPrice` vs `price`) | GAP (minor) — see BACKEND_REQUIREMENTS_GAP.md §5 |
| CreateUserId | None — products carry no creator FK | GAP — see BACKEND_REQUIREMENTS_GAP.md §5 |
| CreatedDate | `Product.createdAt` (UTC) | EXISTS |
| ModifiedUserID | None — no modifier FK | GAP — see BACKEND_REQUIREMENTS_GAP.md §5 |
| ModifyDate | `Product.updatedAt` | EXISTS |

Notes: price/MRP intentionally sit on variants (the purchasable units), not
the product — this is deliberate relational modeling, not a missing feature.
`barcode` (unique, nullable) and `weight` exist additionally on variants.

### 16.2 ProductImageMaster → `ProductImage` (media module)

| Manager term | Existing equivalent | Status |
|--------------|---------------------|--------|
| ProductImageID | `ProductImage.id` (UUID) | EXISTS |
| ProductImage | `filename` + `storagePath` (local store) + `imageType: "webp"` | EXISTS (superset) |
| ProductId | `ProductImage.productId` (+ optional `variantId`) | EXISTS (superset) |

The existing model is a strict superset: `altText`, `sortOrder`,
`isPrimary`, timestamps, Sharp processing, admin upload/metadata/delete APIs
(`POST/PATCH/DELETE /products/:productId/images[/…]`, ADMIN-only) and public
reads (`GET /products/:productId/images[/:imageId]`). No duplicate table.
Known issue: seed contains no media files and no static-serving route exists
(deployment concern).

### 16.3 CategoryMaster → `Category`

| Manager term | Existing equivalent | Status |
|--------------|---------------------|--------|
| CategoryID | `Category.id` (UUID) | EXISTS |
| CategoryName | `Category.name` | EXISTS |
| CategoryDescription | `Category.description` (nullable) | EXISTS |
| ParentCategoryID | `Category.parentId` (self-FK, nullable; `SetNull` on delete) | EXISTS |
| ISActive | `Category.isActive` (soft-deactivation) | EXISTS |

Superset extras: unique `slug`, `image` reference, `sortOrder`, timestamps.
Admin APIs exist (`POST/PATCH/DELETE /categories[/:id]`, ADMIN-only; delete =
soft-deactivate). No duplicate table.

### 16.4 Admin-panel readiness

The future Admin Panel can already consume ADMIN-protected endpoints for
categories, products, variants, inventory (`quantity`/`reservedQuantity`/
`availableQuantity` + ledger), and media. Missing for full manager coverage:
company-info management API, notification management API, creator/modifier
audit on catalog, and media file delivery — all listed in
BACKEND_REQUIREMENTS_GAP.md. No admin UI is built in the storefront phase.

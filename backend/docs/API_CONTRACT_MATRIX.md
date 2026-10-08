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
  `POST /auth/refresh`. Refresh sessions persist server-side
  (`refresh_sessions` keyed by SHA-256 `jti`); rotation consumes
  each `jti` exactly once and logout revokes. No API keys.
- Authorization: `ADMIN` role enforced by middleware on catalog, inventory,
  and media mutations. All other private resources are ownership-scoped to
  `req.user.id`; cross-owner access returns the resource `404` variant
  (never `403`) to avoid leaking existence. Company/suspension/
  authorization gates additionally return `403` where documented:
  `COMPANY_SUSPENDED` (suspended-company context on any gated route),
  `AUTH_COMPANY_REQUIRED`/`AUTH_COMPANY_INVALID`/`AUTH_COMPANY_INCONSISTENT`
  (unusable company association), `AUTH_FORBIDDEN` (insufficient role),
  `AUTH_ACCOUNT_INACTIVE` (deactivated account).
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
| Auth | POST | `/auth/google` | no | — | `{ idToken }` (Google Identity Services ID token) | 200 | 401 AUTH_GOOGLE_INVALID_TOKEN, 403 AUTH_ACCOUNT_INACTIVE/AUTH_GOOGLE_NOT_ALLOWED, 409 AUTH_GOOGLE_AMBIGUOUS_IDENTITY, 422, 429, 503 AUTH_GOOGLE_NOT_CONFIGURED/AUTH_GOOGLE_UNAVAILABLE | Verifies with Google, links by verified email within the request's domain company (creates CUSTOMER if new; ambiguous unscoped emails fail closed), sets refresh cookie; denied fail-closed when the company's Google allowlist is off |
| Auth | POST | `/auth/refresh` | cookie | — | refresh cookie only | 200 | 401 AUTH_REFRESH_TOKEN_INVALID, 429 | One-time rotation: consumes the presented server-side session, then rotates; replays fail closed |
| Auth | POST | `/auth/logout` | no | — | — | 200 | — | Revokes the presented refresh session, then clears refresh cookie |
| Auth | GET | `/auth/me` | yes | — | — | 200 | 401 | Own identity |
| Auth | POST | `/auth/forgot-password` | no | — | `{ email }` | 200 | 422, 429 | Uniform `{ message }` (never reveals existence/eligibility); rate-limited (impl: `backend/src/modules/auth/auth.routes.js:42`, `forgotPassword` in `auth.controller.js`) |
| Auth | POST | `/auth/verify-reset-otp` | no | — | `{ email, otp }` (6-digit code) | 200 | 400 AUTH_OTP_INVALID, 422, 429 | Returns `{ verified: true }`; code-validity only — suspension/inactive enforced at completion (impl: `auth.routes.js:43`, `verifyResetOtp` in `auth.controller.js`) |
| Auth | POST | `/auth/reset-password` | no | — | `{ email, otp, newPassword 8–128 }` | 200 | 400 AUTH_OTP_INVALID, 403 AUTH_ACCOUNT_INACTIVE/COMPANY_SUSPENDED, 422, 429 | Rotates password + sets refresh watermark; code re-verified here (impl: `auth.routes.js:44`, `resetPassword` in `auth.controller.js`) |
| Auth | POST | `/auth/change-password/otp` | yes | — | — | 200 | 401, 403 AUTH_ACCOUNT_INACTIVE, 429 | Issues an OTP to the caller's own email (impl: `auth.routes.js:45-52`, `requestChangeOtp` in `auth.controller.js`) |
| Auth | POST | `/auth/change-password` | yes | — | `{ otp, newPassword 8–128 }` | 200 | 401, 400 AUTH_OTP_INVALID, 403 AUTH_ACCOUNT_INACTIVE, 422, 429 | Identity from session only (no userId accepted); mints a fresh token pair + cookie (impl: `auth.routes.js:53-60`, `changePassword` in `auth.controller.js`) |
| Users | GET | `/users/me` | yes | — | — | 200 | 401, 403 AUTH_ACCOUNT_INACTIVE | Own profile |
| Users | PATCH | `/users/me` | yes | — | firstName?, lastName?, phone? (nullable) | 200 | 401, 422 USER_UPDATE_INVALID/VALIDATION_ERROR | Non-empty body required |
| Users (admin) | GET | `/users` | yes | ADMIN, HEAD | `?page,limit,search,isActive,sortBy,sortOrder` | 200 | 401, 403, 422 | Company-scoped safe fields + `meta`; ADMIN sees the company, HEAD sees own-company MEMBERs only (impl: `backend/src/modules/users/users.routes.js:16`, `listAdmin` in `users.controller.js`, `listUsersAdmin` in `users.service.js`) |
| Users (admin) | GET | `/users/:id` | yes | ADMIN, HEAD | UUID param | 200 | 401, 403, 404 USER_NOT_FOUND | Safe fields only; HEAD resolves MEMBER targets only — HEAD/ADMIN/CUSTOMER/foreign ids read as missing (impl: `users.routes.js:18`, `getByIdAdmin` in `users.controller.js`, `getUserAdmin` in `users.service.js`) |
| Users (admin) | POST | `/users` | yes | ADMIN, HEAD | `{ email, password 8–128, firstName, lastName?, phone?, role: HEAD\|MEMBER }` | 201 | 401, 403, 409 USER_EMAIL_EXISTS, 422 USER_PROVISION_INVALID | Staff provisioning (`provisionEmployee`): company inherited from the creator's context (`companyId` rejected); ADMIN → HEAD/MEMBER, HEAD → MEMBER only; global staff-email invariant; in-transaction CREATED audit (impl: `users.routes.js:17`, `createEmployee` in `users.controller.js`, `provisionEmployee` in `users.service.js`) |
| Users (admin) | PATCH | `/users/:id` | yes | ADMIN, HEAD | `{ isActive }` boolean | 200 | 401, 403, 404 USER_NOT_FOUND, 409 USER_SELF_DEACTIVATION, 422 | Activate/deactivate; inactive users cannot log in; deactivating your own account is rejected; HEAD manages own-company MEMBERs only (impl: `users.routes.js:19`, `updateActiveAdmin` in `users.controller.js`, `setUserActiveAdmin` in `users.service.js`) |
| Users (admin) | PATCH | `/users/:id/profile` | yes | ADMIN, HEAD | `{ firstName?, lastName?, phone? }` (nullable, at least one) | 200 | 401, 403, 404 USER_NOT_FOUND, 422 USER_UPDATE_INVALID/VALIDATION_ERROR | Manager-driven MEMBER profile update; MEMBER targets only, same company; no email/password/role/company/status fields accepted; UPDATED audit with field names (impl: `users.routes.js:25`, `updateMemberProfile` in `users.controller.js`, `updateMemberProfileAdmin` in `users.service.js`) |
| Addresses | GET | `/addresses` | yes | — | — | 200 | 401 | Own list, array |
| Addresses | POST | `/addresses` | yes | — | full address JSON | 201 | 401, 422 | isDefault optional |
| Addresses | GET | `/addresses/:id` | yes | — | UUID param | 200 | 401, 404 ADDRESS_NOT_FOUND | Owner-scoped |
| Addresses | PATCH | `/addresses/:id` | yes | — | partial fields | 200 | 401, 404, 422 ADDRESS_UPDATE_INVALID | Owner-scoped |
| Addresses | DELETE | `/addresses/:id` | yes | — | UUID param | 200 | 401, 404 | Owner-scoped |
| Categories | GET | `/categories` | no | — | `?status=active\|inactive\|all` (default active) | 200 | 422 on invalid status | Active only by default; `inactive`/`all` require ADMIN (`requireAdminForInactiveScope` — HEAD/MEMBER 403 by intentional inactive-scope policy, verified in 3-8; public reads resolve company from Host) |
| Categories | GET | `/categories/:id` | no | — | id param, `?status=active\|all` (default active) | 200 | 404 CATEGORY_NOT_FOUND | Active only by default; `all` requires ADMIN |
| Categories | POST | `/categories` | yes | ADMIN, HEAD, MEMBER | name + optional fields | 201 | 401, 403, 409 CATEGORY_SLUG_EXISTS, 404 CATEGORY_PARENT_NOT_FOUND, 422 | Slug auto-derived; company stamped server-side; MEMBER cannot submit `isActive:false` (403) (impl: `backend/src/modules/categories/categories.routes.js`, `create` in `categories.controller.js`, `createCategory` in `categories.service.js`) |
| Categories | PATCH | `/categories/:id` | yes | ADMIN, HEAD, MEMBER | partial fields | 200 | 401, 403, 404, 409, 422 CATEGORY_UPDATE_INVALID/CYCLE/SELF_PARENT | Any explicit `isActive` is an active-state write (ADMIN/HEAD only, MEMBER 403); `isActive` flips audit as DEACTIVATED/REACTIVATED |
| Categories | DELETE | `/categories/:id` | yes | ADMIN, HEAD | — | 200 | 401, 403, 404 | Soft-deactivates (MEMBER forbidden); reactivate via `PATCH {isActive:true}` (ADMIN/HEAD) |
| Categories | POST | `/categories/:id/image` | yes | ADMIN, HEAD, MEMBER | multipart `image` (JPEG/PNG/WebP ≤ 5MB) | 200 | 400 MEDIA_INVALID_TYPE/UPLOAD_FAILED, 401, 403, 404, 413 MEDIA_FILE_TOO_LARGE | Category UPDATE writing the `image` field; WebP stored under company-prefixed `categories/<id>/`, replaces previous managed file |
| Categories | DELETE | `/categories/:id/image` | yes | ADMIN, HEAD, MEMBER | — | 200 | 401, 403, 404 | Idempotent; removes managed file + nulls `image` |
| Products | GET | `/products` | no | — | `?status=active\|inactive\|all` (default active) | 200 | 422 on invalid status | Active only by default; `inactive`/`all` require ADMIN (same intentional inactive-scope policy as categories, verified in 3-8) |
| Products | GET | `/products/:id` | no | — | id param, `?status=active\|all` (default active) | 200 | 404 PRODUCT_NOT_FOUND | Active only by default; `all` requires ADMIN |
| Products | POST | `/products` | yes | ADMIN, HEAD, MEMBER | product + variants? | 201 | 401, 403, 404 CATEGORY_NOT_FOUND, 409 PRODUCT_SLUG_EXISTS/SKU/BARCODE, 422 | Prices are decimal strings; company + nested variant companies stamped server-side; MEMBER cannot submit `isActive:false` on product or variants (403) (impl: `backend/src/modules/products/products.routes.js`, `create` in `products.controller.js`, `createProduct` in `products.service.js`) |
| Products | PATCH | `/products/:id` | yes | ADMIN, HEAD, MEMBER | partial fields | 200 | 401, 403, 404, 409, 422 PRODUCT_UPDATE_INVALID | Any explicit `isActive` is an active-state write (ADMIN/HEAD only, MEMBER 403); deactivation (`isActive: false` on an active product) is rejected with 409 PRODUCT_HAS_ACTIVE_ORDERS while an in-process order contains the product |
| Products | DELETE | `/products/:id` | yes | ADMIN | — | 200 | 401, 403, 404, 409 PRODUCT_ACTIVE_CANNOT_DELETE | Delete-confirm on inactive rows only (hard DELETE action — HEAD/MEMBER hold no grant); rejected while the product is active (deactivate first); deactivated rows confirm idempotently |
| Products | POST | `/products/:productId/variants` | yes | ADMIN, HEAD, MEMBER | variant JSON | 201 | 401, 403, 404, 409 SKU/BARCODE, 422 | Variant inherits the product's company server-side; MEMBER cannot submit `isActive:false` (403) (impl: `backend/src/modules/products/products.routes.js`, `createVariant` in `products.controller.js`, `createVariant` in `products.service.js`) |
| Products | PATCH | `/products/:productId/variants/:variantId` | yes | ADMIN, HEAD, MEMBER | partial variant | 200 | 401, 403, 404, 422 PRODUCT_VARIANT_UPDATE_INVALID | Product + company-scoped; any explicit `isActive` is ADMIN/HEAD-only (MEMBER 403) |
| Products | DELETE | `/products/:productId/variants/:variantId` | yes | ADMIN, HEAD | — | 200 | 401, 403, 404 | Soft-deactivates (MEMBER holds no DEACTIVATE grant) |
| Inventory | GET | `/products/:productId/variants/:variantId/inventory` | yes | ADMIN, HEAD, MEMBER | — | 200 | 401, 403, 404 PRODUCT_VARIANT_NOT_FOUND/INVENTORY_NOT_FOUND | quantity/reserved/available; company-scoped variant gate (impl: `backend/src/modules/inventory/inventory.routes.js`, `get` in `inventory.controller.js`, `getInventory` in `inventory.service.js`) |
| Inventory | POST | same | yes | ADMIN, HEAD, MEMBER | quantity ≥ 0, note? | 201 | 401, 403, 404, 409 INVENTORY_ALREADY_EXISTS, 422 | Initialize once (CREATE mapping) + INITIAL_STOCK ledger + CREATED audit |
| Inventory | PATCH | same | yes | ADMIN, HEAD, MEMBER | non-zero delta, note? | 200 | 401, 403, 404, 409 INSUFFICIENT_STOCK, 422 | Atomic guarded decrement (UPDATE mapping, ±delta); insufficient stock stays a business 409, never auth; +ledger + UPDATED audit |
| Inventory (admin) | GET | `/inventory` | yes | ADMIN, HEAD, MEMBER | `?page,limit,search,stock,active,sortBy,sortOrder` | 200 | 401, 403, 422 | Company-scoped cross-variant list (READ mapping); `meta` pagination |
| Inventory (admin) | GET | `/products/:productId/variants/:variantId/inventory/transactions` | yes | ADMIN, HEAD, MEMBER | `?page,limit` | 200 | 401, 403, 404 PRODUCT_VARIANT_NOT_FOUND | Ledger newest-first (READ mapping); `meta` pagination |
| Dashboard (admin) | GET | `/dashboard/summary` | yes | ADMIN | `?range=today\|week\|month\|year` (default today) | 200 | 401, 403, 422 | Company-scoped order/revenue/bucket/inventory aggregates, no row-level or PII data; intentionally ADMIN-only (HEAD/MEMBER hold no company_statistics grant — verified in 4-2; SUPER_ADMIN refused at the role gate so platform context never becomes company scope) |
| Media | GET | `/products/:productId/images` | no | — | — | 200 | 404 PRODUCT_NOT_FOUND | Active product only |
| Media | GET | `/products/:productId/images/:imageId` | no | — | — | 200 | 404 MEDIA_NOT_FOUND | — |
| Media | POST | `/products/:productId/images` | yes | ADMIN, HEAD, MEMBER | multipart `image` + metadata? | 201 | 400 MEDIA_INVALID_TYPE/UPLOAD_FAILED, 401, 403, 404, 413 MEDIA_FILE_TOO_LARGE | Product UPDATE mapping (JPEG/PNG/WebP ≤ 5MB, WebP output); product gate is company-scoped |
| Media | PATCH | `/products/:productId/images/:imageId` | yes | ADMIN, HEAD, MEMBER | metadata subset | 200 | 401, 403, 404, 422 MEDIA_UPDATE_INVALID | Product UPDATE mapping (variant scoping, primary promotion) |
| Media | DELETE | `/products/:productId/images/:imageId` | yes | ADMIN | — | 200 | 401, 403, 404 | Hard file + row delete (DELETE action — HEAD/MEMBER hold no grant); removes file + row |
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
| Orders | POST | `/orders/:id/cancel` | yes | — | UUID param, no body | 200 | 401, 404 ORDER_NOT_FOUND, 409 ORDER_INVALID_STATUS_TRANSITION/ORDER_STATUS_UNCHANGED/ORDER_CONCURRENT_UPDATE, 422 | Customer self-cancellation (PENDING/CONFIRMED/PROCESSING only); same atomic transaction as admin cancel (incl. payment cancellation) |
| Orders (admin) | GET | `/orders/admin` | yes | ADMIN, HEAD, MEMBER | `?page,limit,status,paymentStatus,search,from,to,sortBy,sortOrder` | 200 | 401, 403, 422 | Company-scoped (order:MANAGE reads); `meta` pagination; `search` covers order number, item SKU, item product name, customer email/name (impl: `backend/src/modules/orders/orders.routes.js`, `listAdmin` in `orders.controller.js`) |
| Orders (admin) | GET | `/orders/admin/:id` | yes | ADMIN, HEAD, MEMBER | UUID param | 200 | 401, 403, 404 ORDER_NOT_FOUND | Company-scoped order + customer brief (impl: `orders.routes.js`, `getByIdAdmin` in `orders.controller.js`) |
| Orders (admin) | PATCH | `/orders/admin/:id/status` | yes | ADMIN, HEAD, MEMBER | `{ status, note? }` full-lifecycle transition | 200 | 401, 403, 404, 409 ORDER_INVALID_STATUS_TRANSITION/ORDER_STATUS_UNCHANGED/ORDER_CONCURRENT_UPDATE, 422 | Lifecycle validation stays role-agnostic; CANCELLED restores inventory, moves payments to CANCELLED, appends history + customer notification atomically |
| Orders (admin) | PATCH | `/orders/admin/:id/payment` | yes | ADMIN, HEAD, MEMBER | `{ status }` payment transition | 200 | 401, 403, 404, 409 PAYMENT_INVALID_STATUS_TRANSITION/ORDER_PAYMENT_MISSING, 422 | Payment state machine unchanged (order:MANAGE op); status only, no gateway |
| Orders (admin) | PATCH | `/orders/admin/bulk-status` | yes | ADMIN, HEAD, MEMBER | `{ orderIds[1–100], status, note? ≤ 500 }` | 200 | 401, 403, 404 ORDER_NOT_FOUND, 409 ORDER_BULK_VALIDATION_FAILED/ORDER_CONCURRENT_UPDATE, 422 | Atomic all-or-nothing (order:MANAGE): one history + notification + audit row per order; transient P2034 deadlock victims retried (impl: `backend/src/modules/orders/orders.routes.js:16`, `bulkUpdateStatusAdmin` in `orders.controller.js`/`orders.service.js`) |
| Returns | POST | `/orders/:orderId/returns` | yes | — | `{ reason, details? }` (`details` required when `reason` is OTHER, ≤ 1000) | 201 | 401, 404 ORDER_NOT_FOUND, 409 RETURN_ALREADY_REQUESTED, 422 ORDER_RETURN_NOT_ELIGIBLE/VALIDATION_ERROR | Own DELIVERED orders only; one request per order; no status-mutation endpoint exists (impl: `backend/src/modules/returns/returns.routes.js:9`, `create` in `returns.controller.js`) |
| Returns | GET | `/orders/:orderId/returns` | yes | — | orderId param | 200 | 401, 404 | Own order's request (impl: `returns.routes.js:10`, `get` in `returns.controller.js`) |
| Returns (admin) | GET | `/returns` | yes | ADMIN | `?page,limit,status,search` | 200 | 401, 403, 422 | Read-only list + `meta`; no return grants exist in permissions.js so the admin surface stays ADMIN-only (HEAD/MEMBER 403); no write endpoints exist (impl: `backend/src/modules/returns/returns.admin.routes.js:15`, `listAdmin` in `returns.controller.js`) |
| Returns (admin) | GET | `/returns/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 RETURN_NOT_FOUND | Read-only detail; stays ADMIN-only (no matrix grant) (impl: `returns.admin.routes.js:16`, `getByIdAdmin` in `returns.controller.js`) |
| Notifications | GET | `/notifications` | yes | — | `?limit` (1–50, default 20), `?unreadOnly=true\|false` | 200 | 401, 422 | Own notifications newest-first + `meta.unreadCount`; order rows carry `orderNumber` |
| Notifications | GET | `/notifications/unread-count` | yes | — | — | 200 | 401 | Authoritative `{ unreadCount }` for badges |
| Notifications | PATCH | `/notifications/:id/read` | yes | — | UUID param | 200 | 401, 404 NOTIFICATION_NOT_FOUND | Owner-scoped; returns `{ notification }` + `meta.unreadCount` |
| Notifications | POST | `/notifications/read-all` | yes | — | — | 200 | 401 | Marks own unread read; returns `{ updated }` + `meta.unreadCount` |
| Notifications | DELETE | `/notifications/:id` | yes | — | UUID param | 200 | 401, 404 NOTIFICATION_NOT_FOUND | Owner-scoped; returns `{ id }` + `meta.unreadCount` (impl: `backend/src/modules/notifications/notifications.routes.js:13`, `clear` in `notifications.controller.js`) |
| Marketing (customer) | GET | `/marketing/notifications/active` | yes | — | — | 200 | 401 | Active in-window broadcasts newest-first (no per-user fan-out) |
| Marketing (admin) | GET | `/marketing/notifications/admin` | yes | ADMIN | — | 200 | 401, 403 | All broadcasts newest-first; ADMIN-only verified in 3-7 (HEAD/MEMBER hold no marketing grant in permissions.js) |
| Marketing (admin) | POST | `/marketing/notifications/admin` | yes | ADMIN | title*, message*, type?, isActive?, startsAt?, expiresAt?, linkType?+linkValue? | 201 | 401, 403, 422 | `linkValue` required with `linkType` |
| Marketing (admin) | GET | `/marketing/notifications/admin/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 MARKETING_NOT_FOUND | — |
| Marketing (admin) | PATCH | `/marketing/notifications/admin/:id` | yes | ADMIN | partial subset | 200 | 401, 403, 404, 422 | Non-empty body; date-range guarded |
| Marketing (admin) | DELETE | `/marketing/notifications/admin/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 MARKETING_NOT_FOUND | Deletable (no historical dependency) |
| Announcements | GET | `/announcements/current` | no | — | — | 200 | — | Public; `{ announcement: { message, linkLabel, linkTarget } \| null }`; null = hide the bar |
| Announcements (admin) | GET | `/announcements/admin` | yes | ADMIN | — | 200 | 401, 403 | All, priority-first; ADMIN-only verified in 3-7 (HEAD holds no announcement grant — only ADMIN has announcement:MANAGE) |
| Announcements (admin) | POST | `/announcements/admin` | yes | ADMIN | message*, isActive?, startsAt?, expiresAt?, linkLabel?, linkTarget?, priority? | 201 | 401, 403, 422 | `linkTarget` internal-route only |
| Announcements (admin) | GET | `/announcements/admin/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 ANNOUNCEMENT_NOT_FOUND | — |
| Announcements (admin) | PATCH | `/announcements/admin/:id` | yes | ADMIN | partial subset | 200 | 401, 403, 404, 422 | Non-empty body; date-range guarded |
| Announcements (admin) | DELETE | `/announcements/admin/:id` | yes | ADMIN | UUID param | 200 | 401, 403, 404 ANNOUNCEMENT_NOT_FOUND | Deletable |
| Reviews | POST | `/reviews` | yes | — | orderItemId UUID, rating 1–5 int, title?, comment? | 201 | 401, 404 REVIEW_ORDER_ITEM_NOT_FOUND, 409 REVIEW_ALREADY_EXISTS, 422 | productId derived server-side; created visible immediately (no approval step) |
| Reviews | GET | `/reviews/me` | yes | — | — | 200 | 401 | Own reviews, newest first |
| Reviews | GET | `/reviews/:id` | yes | — | UUID param | 200 | 401, 404 REVIEW_NOT_FOUND | Owner-scoped |
| Reviews | PATCH | `/reviews/:id` | yes | — | rating?/title?/comment? | 200 | 401, 404, 422 REVIEW_UPDATE_INVALID | Owner-scoped |
| Reviews | DELETE | `/reviews/:id` | yes | — | UUID param | 200 | 401, 404 | Hard delete |
| Reviews | GET | `/reviews/product/:productId` | no | — | productId UUID param | 200 | 404, 422 | Public product reviews, newest first; no approval gate, no private data |
| Reviews (admin) | GET | `/reviews/admin` | yes | ADMIN | `?page,limit,isApproved,rating,productId,userId,search,sortBy,sortOrder` | 200 | 401, 403, 422 | Read-only: all reviews + customer brief, newest first; `meta` pagination (no admin mutation endpoints exist) |
| Coupons (admin) | GET | `/coupons` | yes | ADMIN, HEAD, MEMBER | `?status=active\|inactive\|all` (default all), `?search=`, `?page=`, `?limit=` | 200 | 401, 403, 422 | Company-scoped (coupon:READ); newest first; `meta` pagination (impl: `backend/src/modules/coupons/coupons.routes.js`, `list` in `coupons.controller.js`) |
| Coupons (admin) | GET | `/coupons/:id` | yes | ADMIN, HEAD, MEMBER | UUID param | 200 | 401, 403, 404 COUPON_NOT_FOUND | Company-scoped full definition + usage (impl: `coupons.routes.js`, `getById` in `coupons.controller.js`) |
| Coupons (admin) | POST | `/coupons` | yes | ADMIN, HEAD | code*, discountType*, discountValue*, optional definition fields | 201 | 401, 403, 404 PRODUCT_NOT_FOUND, 409 COUPON_CODE_EXISTS, 422 | Code stored uppercased; company stamped server-side (MEMBER holds no CREATE) |
| Coupons (admin) | PATCH | `/coupons/:id` | yes | ADMIN, HEAD | partial definition subset (`isActive` toggles availability) | 200 | 401, 403, 404, 409, 422 COUPON_UPDATE_INVALID | `usedCount` never writable; HEAD holds DEACTIVATE so toggles included |
| Coupons (admin) | DELETE | `/coupons/:id` | yes | ADMIN | — | 200 | 401, 403, 404, 409 COUPON_IN_USE | Hard delete (HEAD/MEMBER hold no DELETE); refused once used; deactivate instead |
| Coupons | POST | `/coupons/validate` | yes | — | `{ code }` (lines read from caller's cart) | 200 | 401, 404 COUPON_NOT_FOUND, 409 COUPON_USAGE_LIMIT_EXCEEDED, 422 validation codes | Authoritative discount quote |
| Coupons (admin) | GET | `/coupons/:id/history` | yes | ADMIN, HEAD, MEMBER | UUID param + `?page,limit` | 200 | 401, 403, 404 COUPON_NOT_FOUND | Company-scoped append-only lifecycle ledger (CREATED/UPDATED/DEACTIVATED/REACTIVATED/DELETED) + `meta`; survives coupon deletion (impl: `backend/src/modules/coupons/coupons.routes.js`, `history` in `coupons.controller.js`) |
| Audit | GET | `/audit-logs` | yes | ADMIN, HEAD, MEMBER, SUPER_ADMIN | `?page,limit,actorId,resourceId,companyId,resource,action,outcome,role,from,to` (`companyId=null` = platform-only, SUPER_ADMIN) | 200 | 401, 403 AUDIT_FORBIDDEN/AUTH_COMPANY_REQUIRED, 404 COMPANY_NOT_FOUND, 422 | Server-forced visibility (MEMBER self, HEAD self+members, ADMIN company, SUPER_ADMIN all); company staff never see `actorRole` SUPER_ADMIN rows even for their own company; reads are unaudited; `meta` pagination (impl: `backend/src/modules/audit/audit.routes.js`, `list` in `audit.controller.js`) |
| Audit | GET | `/audit-logs/export` | yes | ADMIN, HEAD, MEMBER, SUPER_ADMIN | same filters minus pagination | 200 `text/csv` | 401, 403, 404, 422 AUDIT_EXPORT_TOO_LARGE (over 10000 rows, never truncated) | Same visibility as reads (incl. SUPER_ADMIN-snapshot exclusion for company staff); formula-safe quoting; read-only (impl: `audit.routes.js`, `exportLogs` in `audit.controller.js`) |
| Audit | GET | `/audit-logs/summary` | yes | ADMIN, HEAD, MEMBER, SUPER_ADMIN | same filters minus pagination; default trailing 30 days | 200 | 401, 403, 404, 422 (range over 366 days) | Aggregates never exceed list visibility (incl. SUPER_ADMIN-snapshot exclusion for company staff); `data.summary` (impl: `audit.routes.js`, `getSummary` in `audit.controller.js`) |
| Audit (platform) | GET | `/audit-retention` | yes | SUPER_ADMIN | — | 200 | 401, 403 | Global policy singleton; platform chain, no suspension gate (impl: `backend/src/modules/audit/retention.routes.js:21`, `getRetention` in `audit.controller.js`) |
| Audit (platform) | PATCH | `/audit-retention` | yes | SUPER_ADMIN | `{ policy: NEVER\|30_DAYS\|1_YEAR }` only | 200 | 401, 403, 422 | Real changes audited (AUDIT_RETENTION/UPDATED, companyId NULL); same-value idempotent (impl: `retention.routes.js:22`, `updateRetention` in `audit.controller.js`) |
| Companies (platform) | GET | `/companies` | yes | SUPER_ADMIN | `?page,limit,search,status=ACTIVE\|SUSPENDED` | 200 | 401, 403 | Platform chain (no suspension gate); identity/lifecycle/domains/counts only, never operational rows; `meta` pagination (impl: `backend/src/modules/companies/companies.routes.js:23`, `list` in `companies.controller.js`) |
| Companies (platform) | POST | `/companies` | yes | SUPER_ADMIN | `{ name }` 1–255 chars | 201 | 401, 403, 422 COMPANY_INVALID_NAME | Server-assigned UUID + ACTIVE status; exact-name duplicates allowed (impl: `companies.routes.js:24`, `create` in `companies.controller.js`) |
| Companies (platform) | GET | `/companies/:id` | yes | SUPER_ADMIN | UUID param | 200 | 401, 403, 404 COMPANY_NOT_FOUND | Metadata + domains + structural `aggregates` counts only (impl: `companies.routes.js`, `getById` in `companies.controller.js`) |
| Companies (platform) | GET | `/companies/summary` | yes | SUPER_ADMIN | — | 200 | 401, 403 | Platform aggregate summary (`totalCompanies/activeCompanies/suspendedCompanies`, summed `totals`, lean per-company rows `id/name/status/primaryDomain` + `aggregates{totalUsers,totalProducts,totalOrders}`); bounded grouped counts, lean projection (no profile/timestamp/domain-array width), never operational rows (impl: `companies.routes.js`, `summary` in `companies.controller.js`, `getPlatformSummary` in `companies.service.js`) |
| Companies (platform) | PATCH | `/companies/:id` | yes | SUPER_ADMIN | `{ name?, contactEmail?, contactPhone?, addressLine1?, addressLine2?, city?, state?, postalCode?, country?, website? }` (strict; at least one; empty optional string clears to NULL; `logoPath`/status/admin/domains/settings rejected) | 200 | 401, 403, 404 COMPANY_NOT_FOUND, 422 COMPANY_INVALID_NAME/COMPANY_INVALID_WEBSITE | Name + business-profile update; email lowercased, website HTTPS-only; no-change writes succeed without audit; genuine changes carry company-scoped COMPANY/UPDATED audit `{ changedFields, previousValues }` (impl: `companies.routes.js`, `update` in `companies.controller.js`, `updateCompany` in `companies.service.js`) |
| Companies (platform) | POST | `/companies/:id/logo` | yes | SUPER_ADMIN | multipart `image` (JPEG/PNG/WebP ≤5MB, raster-verified, WebP output) | 201 | 400 MEDIA_UPLOAD_FAILED/MEDIA_INVALID_TYPE, 401, 403, 404 COMPANY_NOT_FOUND, 413 MEDIA_FILE_TOO_LARGE, 500 MEDIA_STORAGE_FAILED | Server-stamped `logoPath` under `companies/<id>/branding/`; previous file removed only after DB commit; SVG rejected at filter + format allowlist (impl: `companies.routes.js`, `uploadLogo` in `companies.controller.js`, `setCompanyLogo` in `companies.service.js`) |
| Companies (platform) | DELETE | `/companies/:id/logo` | yes | SUPER_ADMIN | route id only | 200 | 401, 403, 404 COMPANY_NOT_FOUND | Clears `logoPath` transactionally with COMPANY/UPDATED audit (`logoOperation: removed`); file removed post-commit warn-only; idempotent (impl: `companies.routes.js`, `removeLogo` in `companies.controller.js`, `clearCompanyLogo` in `companies.service.js`) |
| Companies (platform) | POST | `/companies/:id/suspend` | yes | SUPER_ADMIN | — | 200 | 401, 403, 404 COMPANY_NOT_FOUND, 409 COMPANY_ALREADY_SUSPENDED | Guarded ACTIVE→SUSPENDED transition + platform audit; data preserved (impl: `companies.routes.js:26`, `suspend` in `companies.controller.js`) |
| Companies (platform) | POST | `/companies/:id/restore` | yes | SUPER_ADMIN | — | 200 | 401, 403, 404 COMPANY_NOT_FOUND, 409 COMPANY_ALREADY_ACTIVE | Guarded SUSPENDED→ACTIVE; domains and audit untouched (impl: `companies.routes.js:27`, `restore` in `companies.controller.js`) |
| Companies (platform) | POST | `/companies/:id/admin` | yes | SUPER_ADMIN | `{ email, password 8–128, firstName, lastName?, phone? }` | 201 | 401, 403, 404 COMPANY_NOT_FOUND, 409 COMPANY_ADMIN_EXISTS/USER_EMAIL_EXISTS, 422 | Exactly-one-ADMIN atomic provisioning + audit (impl: `companies.routes.js:28`, `provisionAdmin` in `companies.controller.js`) |
| Companies (platform) | POST | `/companies/:id/admin/password` | yes | SUPER_ADMIN | `{ password 8–128 }` | 200 | 401, 403, 404 COMPANY_NOT_FOUND/COMPANY_ADMIN_NOT_FOUND, 409 COMPANY_ADMIN_INCONSISTENT, 422, 429 | Password-only rotation of the designated ADMIN; refresh watermark kills pre-rotation sessions (impl: `companies.routes.js:36`, `resetAdminPassword` in `companies.controller.js`) |
| Companies (platform) | DELETE | `/companies/:id` | yes | SUPER_ADMIN | `{ confirmName }` exact current name | 200 | 401, 403 COMPANY_PROTECTED (Company #1), 404 COMPANY_NOT_FOUND, 409 COMPANY_NOT_SUSPENDED, 422 COMPANY_CONFIRMATION_MISMATCH | SUSPENDED-only permanent purge (full tenant graph) + surviving platform DELETED audit; media reclaimed warn-only (impl: `companies.routes.js:32`, `destroy` in `companies.controller.js`) |
| Companies (platform) | GET | `/companies/:id/domains` | yes | SUPER_ADMIN | route id only | 200 | 401, 403, 404 COMPANY_NOT_FOUND | Domain registry metadata only (`id/domain/isPrimary/isActive/createdAt/updatedAt`), primary-first; no operational data |
| Companies (platform) | POST | `/companies/:id/domains` | yes | SUPER_ADMIN | `{ domain }` hostname | 201 | 401, 403, 404 COMPANY_NOT_FOUND, 409 COMPANY_DOMAIN_EXISTS, 422 COMPANY_DOMAIN_INVALID | Server-canonicalized via `normalizeHostname`; first domain becomes primary; `companyId`/flags rejected |
| Companies (platform) | PATCH | `/companies/:id/domains/:domainId` | yes | SUPER_ADMIN | `{ isActive?, isPrimary? }` (at least one) | 200 | 401, 403, 404 COMPANY_NOT_FOUND/COMPANY_DOMAIN_NOT_FOUND, 409 COMPANY_DOMAIN_PRIMARY_REQUIRED, 422 | Promotion demotes siblings atomically; primary demotion without a successor rejected; no-op sets succeed |
| Companies (platform) | DELETE | `/companies/:id/domains/:domainId` | yes | SUPER_ADMIN | route ids only | 200 | 401, 403, 404 COMPANY_NOT_FOUND/COMPANY_DOMAIN_NOT_FOUND, 409 COMPANY_DOMAIN_IS_PRIMARY | Removes the registry row only (never company/operational data); primary with siblings rejected |
| Companies (platform) | PATCH | `/companies/:id/google-signin` | yes | SUPER_ADMIN | `{ enabled }` boolean (required, strict) | 200 | 401, 403, 404 COMPANY_NOT_FOUND, 422 | Company-scoped Google sign-in allowlist; ownership from the route id only; suspended companies manageable; COMPANY/UPDATED audit with transition details (impl: `backend/src/modules/companies/companies.routes.js`, `updateGoogleSignIn` in `companies.controller.js`, `setGoogleSignIn` in `companies.service.js`) |

\* Cart add returns `CART_ITEM_NOT_FOUND` only for scoped-update paths;
unknown variants return `PRODUCT_VARIANT_NOT_FOUND`.

## 3. Request contract details

- Auth register: `email` (trimmed, lowercased, valid, ≤ 255),
  `password` (8–128 chars), `firstName`/`lastName` (≤ 100, optional),
  `phone` (≤ 30, optional). Login: `email`, `password` (≥ 1 char).
- Users update: `firstName`, `lastName`, `phone` (each nullable, trimmed,
  min 1 when present); empty object → `422`.
- Staff provisioning (`POST /users`, ADMIN + HEAD): `email` (trimmed,
  lowercased, valid, ≤ 255), `password` (8–128, Argon2id-hashed
  server-side, never returned), `firstName` (1–100),
  `lastName`/`phone` (optional), `role: HEAD|MEMBER` (required;
  anything else → `422`). Company always inherited from the
  creator's server context; staff emails must be globally unused
  (`409 USER_EMAIL_EXISTS`); creator hierarchy enforced
  (`403` when HEAD requests HEAD).
- Managed MEMBER profile (`PATCH /users/:id/profile`, ADMIN + HEAD):
  non-empty subset of nullable `firstName`/`lastName`/`phone`;
  MEMBER targets in the caller's company only; email, password,
  role, company, and active-state fields rejected (`422`).
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
- Auth recovery/change: `forgot-password { email }` always answers the
  same 200 `{ message }`; `verify-reset-otp { email, otp }` (6-digit
  code) answers 200 `{ verified: true }` or `400 AUTH_OTP_INVALID`;
  `reset-password { email, otp, newPassword }` (8–128) answers 200
  `{ message }`; authenticated `change-password/otp` (no body) issues a
  code to the caller's own email, and `change-password { otp,
  newPassword }` answers 200 `{ user, accessToken }` plus a rotated
  refresh cookie. Recovery targets resolve through the request's domain
  company; strict schemas reject any client tenancy selector.
- Companies (platform): list `?page,limit,search,status`; create
  `{ name }`; suspend/restore take no body; provision ADMIN
  `{ email, password, firstName, lastName?, phone? }` (empty optionals
  dropped); reset ADMIN password `{ password }`; delete
  `{ confirmName }` (exact current name, case-sensitive). All routes
  share `authenticate → resolveCompanyContext →
  authorize("SUPER_ADMIN")` with no suspension gate; bodies never carry
  `companyId` (strict rejection).
- Audit reads: list `?page,limit,actorId,resourceId,companyId,resource,
  action,outcome,role,from,to` (`companyId` accepts a UUID or the
  literal `"null"` for SUPER_ADMIN platform scope; other roles'
  scopes are forced server-side); export/summary take the same
  filters minus pagination (summary defaults to the trailing 30 days,
  ranges over 366 days rejected). Retention: `GET` takes nothing;
  `PATCH { policy }` accepts only `NEVER|30_DAYS|1_YEAR`.
- Returns: create `{ reason, details? }` where `reason` is
  `WRONG_COLOR|WRONG_SIZE|DAMAGED|DEFECTIVE|WRONG_ITEM|
  NOT_AS_DESCRIBED|CHANGED_MIND|OTHER` (`details` ≤ 1000, required
  when `reason` is OTHER); admin list
  `?page,limit,status,search`. Bulk order status:
  `{ orderIds[1–100 UUIDs], status, note? ≤ 500 }`.
- Companies (platform) domains: `{ domain }` (trimmed, ≤ 255) is
  canonicalized server-side through `normalizeHostname`
  (case/trailing-dot/port handling shared with runtime
  resolution); URLs, paths, schemes, credentials, UUIDs, and
  over-long values are rejected (`422 COMPANY_DOMAIN_INVALID`).
  Update accepts any non-empty subset of `isActive`/`isPrimary`
  booleans; `companyId` and every other field are rejected.
  Promotion demotes siblings atomically (concurrent promotions
  leave exactly one primary); demoting or removing a primary
  while siblings exist is rejected (`409
  COMPANY_DOMAIN_PRIMARY_REQUIRED` / `COMPANY_DOMAIN_IS_PRIMARY`).
  Foreign `domainId`s under another company's route id return
  `404 COMPANY_DOMAIN_NOT_FOUND`.

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
  string money totals, `coupon` brief (`{ id, code, description,
  discountType, discountValue }`, `null` when no coupon was used — the
  effective amount stays snapshotted in `discountTotal`), `items[]`
  snapshots (`productName`, `variantName`, `sku`, `unitPrice`, `discount`,
  `quantity`, `lineTotal`, `imageStoragePath` — immutable variant-image
  snapshot taken at order time, `null` for pre-snapshot orders or
  imageless products), `addresses[]` (`SHIPPING` plus optional `BILLING`
  snapshots), `payments[]` (`CASH_ON_DELIVERY`, `PENDING`, amount = grand
  total, `INR`).
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
  terminal. `CANCELLED` is terminal and written only by the atomic
  order-cancellation transaction (order → CANCELLED moves its payments
  to CANCELLED in the same transaction). `REFUNDED` records a manual
  refund; no gateway exists.
- Reviews: `data.review(s)` with `productId`, `orderItemId`, `rating`,
  `title`, `comment`, `isApproved`, and a product brief. No user or order
  data embedded.
- Coupons (admin): `data.coupon(s)` with `code`, `description`,
  `discountType`, `discountValue` (`"xx.xx"` string), nullable
  `minimumOrderAmount`/`maximumDiscountAmount` strings, `usageLimit`
  (nullable) + authoritative `usedCount`, nullable `startsAt`/`expiresAt`
  ISO strings, `isActive`, `products[]` (`{ productId }` links; empty =
  all products eligible). Admin list returns `data.coupons[]` with `meta`
  (`page`, `limit`, `total`, `totalPages`). History returns
  `data.history[]` (append-only lifecycle entries) with `meta`.
- Companies (platform): list returns `data.companies[]` with `meta`;
  create/suspend/restore return `data.company`
  (`{ id, name, status, adminProvisioned, googleSignInEnabled,
  domains[], createdAt, updatedAt }`); detail adds structural `aggregates` counts only
  (`totalUsers/totalCustomers/totalHeads/totalMembers/totalProducts/
  totalOrders`) — never operational rows. Provision/reset return the
  safe `data.admin` shape (request-only passwords, never rendered or
  stored client-side). Delete returns `data.deleted: { id, name }`.
  Domain rows are
  `{ id, domain, isPrimary, isActive, createdAt, updatedAt }`.
- Audit: list returns `data.logs[]` with `meta`; export returns
  `text/csv` (11-field safe projection, formula-guarded, CRLF);
  summary returns `data.summary` (totals, by-outcome/action/resource,
  top actors, zero-filled daily buckets, period). Retention returns
  `data.retention: { policy, ... }`.
- Returns: create/detail return `data.returnRequest`
  (`{ id, orderId, status: REQUESTED, reason, details, createdAt,
  updatedAt }`); admin list returns `data.returns[]` with `meta`.
- Bulk order status returns `data.orders[]` (full admin order shapes,
  all transitioned); failures return `409
  ORDER_BULK_VALIDATION_FAILED` with per-order `details` and apply
  nothing.

## 5. Authorization matrix

| Resource   | Public | Customer | Admin |
| ---------- | ------ | -------- | ----- |
| health     | YES    | YES      | YES   |
| auth       | YES    | YES      | YES   |
| users      | NO     | OWNED    | OWNED + ADMIN OVERRIDE (`GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`, `PATCH /users/:id/profile`) + HEAD MEMBER-SCOPED (`POST /users` MEMBER-only, MEMBER-only reads/updates/deactivations) |
| addresses  | NO     | OWNED    | NO*   |
| categories | YES (reads) | YES (reads) | ADMIN FULL + HEAD/MEMBER SCOPED (HEAD: create/update/deactivate/images; MEMBER: create/update/images, no `isActive`, no delete — see §2) |
| products   | YES (reads) | YES (reads) | ADMIN FULL + HEAD/MEMBER SCOPED (HEAD: create/update/deactivate/images-metadata/variant create-update-deactivate; MEMBER: create/update/images-metadata/variant create-update, no `isActive`, no delete; product delete + image delete stay ADMIN-only — see §2) |
| inventory  | NO     | NO       | ADMIN FULL + HEAD/MEMBER SCOPED (HEAD: init/adjust/reads; MEMBER: init/adjust/reads — no deactivation endpoint exists, so the DEACTIVATE grant wires nothing; insufficient stock stays a business 409 — see §2) |
| dashboard  | NO     | NO       | ADMIN ONLY (`/dashboard/summary`) |
| notifications | NO  | OWNED    | NO*   |
| marketing  | NO     | READS (active broadcasts) | ADMIN ONLY (CRUD) |
| announcements | YES (current only) | YES (current) | ADMIN ONLY (CRUD) |
| media      | YES (reads) | YES (reads) | ADMIN ONLY (writes) |
| cart       | NO     | OWNED    | NO*   |
| wishlist   | NO     | OWNED    | NO*   |
| orders     | NO     | OWNED    | OWNED + ADMIN/HEAD/MEMBER SCOPED (`/orders/admin*` list/detail/status/payment/bulk-status under order:MANAGE; lifecycle + payment machines role-agnostic) |
| payments   | NOT EXPOSED | NOT EXPOSED | NOT EXPOSED |
| reviews    | NO     | OWNED    | OWNED + ADMIN READ-ONLY LIST (`GET /reviews/admin`) |
| coupons    | NO     | NO       | ADMIN FULL + HEAD/MEMBER SCOPED (HEAD: create/update incl. toggles + reads/history; MEMBER: reads/history only; delete stays ADMIN-only; customer quote via `POST /validate` unchanged — see §2) |

\* No admin override endpoints exist for these resources; admins use the
same ownership-scoped access as customers. Orders and users
are the exceptions: customer history stays ownership-scoped while
`/orders/admin*` (list/detail/status/payment/bulk-status), `/users` + `/users/:id`
(list/detail/activate/provision/profile) provide the ADMIN + HEAD (+ MEMBER
where granted) operational surfaces, and
`GET /reviews/admin` provides an ADMIN-only read-only list (no admin
review mutation endpoints exist). Customer addresses remain
owner-scoped with no admin override by design.

## 6. Ownership rules

- Users: `GET`/`PATCH /users/me` operate on `req.user.id` only;
  `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`,
  `PATCH /users/:id/profile` (ADMIN + HEAD) list/inspect/provision/
  activate/update across accounts with safe fields. ADMIN sees and
  manages the company (provisioning HEAD/MEMBER); HEAD is forced to
  MEMBER scope by the service — company inheritance from the
  creator's context, `companyId` rejected, unmanageable targets
  (HEAD/ADMIN/SUPER_ADMIN/CUSTOMER/foreign) read as `404
  USER_NOT_FOUND`, role escalation rejected (`422` unknown roles,
  `403` HEAD→HEAD).
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
  from that item. `GET /reviews/admin` (ADMIN-only) lists across owners
  (read-only — no approve/reject/edit/delete endpoints exist).
- Cross-owner access returns the resource `404` variant (never `403`),
  except the documented `403` company/authorization gates (suspended
  company, unusable company association, insufficient role, inactive
  account — see section 1).

## 7. Intentional non-endpoints

Confirmed absent (all return `404 ROUTE_NOT_FOUND`):

- Checkout coupon support EXISTS (customer): `POST /coupons/validate`
  (owner-cart discount quote) + optional `couponCode` on `POST /orders`
  (re-validated server-side; `discountTotal`/`grandTotal`/payment derived
  in-transaction; usage consumed atomically with guarded increments).
  Still absent: bulk generation, CSV import/export, promotion providers.
- Online payment endpoints (capture, providers) and webhooks.
- Review moderation endpoints (approve/reject/edit/delete) do not exist:
  the admin review surface is the read-only `GET /reviews/admin` list.
  The public product-review listing `GET /reviews/product/:productId`
  exists (approved reviews only, no auth, no private data).
- User deletion and admin-side customer creation endpoints do not exist
  (account lifecycle is activate/deactivate only; registration is the
  public `POST /auth/register`).
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

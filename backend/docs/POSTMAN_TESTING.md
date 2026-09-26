# Postman Manual Testing Guide — Tech Pulse Backend

This guide describes how to test the backend manually with Postman.
It is based strictly on the implemented API. No secrets are included.

## 1. Base URL

Start the backend from the `backend/` directory:

```text
npm start
```

Local base URL (default `PORT=3000`):

```text
http://localhost:3000
```

API prefix for every endpoint below:

```text
/api/v1
```

Example health check:

```text
GET http://localhost:3000/api/v1/health
```

Expected: `200`, `{ "success": true, "data": { "status": "healthy" } }`.

## 2. Postman environment (safe values only)

Create a Postman environment with these variables (fill values at runtime):

| Variable      | Value                          |
| ------------- | ------------------------------ |
| `baseUrl`     | `http://localhost:3000/api/v1` |
| `accessToken` | (paste from login response)    |
| `productId`   | (paste from product response)  |
| `variantId`   | (paste from product response)  |
| `addressId`   | (paste from address response)  |
| `orderId`     | (paste from order response)    |
| `reviewId`    | (paste from review response)   |

Use `{{baseUrl}}` and `{{accessToken}}` in requests.

NEVER put `DATABASE_URL`, `JWT_ACCESS_SECRET`, or `JWT_REFRESH_SECRET`
into Postman. Those live only in the backend `.env` file.

Authenticated requests need this header:

```text
Authorization: Bearer {{accessToken}}
```

The refresh token is a `HttpOnly` cookie set automatically on login.
Postman stores it if cookie handling is enabled; you never copy it manually.

## 3. Authentication flow

### 3.1 Register

```text
POST {{baseUrl}}/auth/register
Content-Type: application/json

{
  "email": "customer1@example.com",
  "password": "Password123!",
  "firstName": "Test",
  "lastName": "Customer"
}
```

Expected: `201`. New users always get the `CUSTOMER` role.

### 3.2 Login

```text
POST {{baseUrl}}/auth/login
Content-Type: application/json

{
  "email": "customer1@example.com",
  "password": "Password123!"
}
```

Expected: `200` with `data.accessToken` plus a `refresh_token`
`HttpOnly` cookie. Copy the access token into `{{accessToken}}`.

### 3.3 Me

```text
GET {{baseUrl}}/auth/me
Authorization: Bearer {{accessToken}}
```

Expected: `200` with the same user returned at login.

### 3.4 Refresh

```text
POST {{baseUrl}}/auth/refresh
```

Uses the `refresh_token` cookie (no body, no bearer token).
Expected: `200` with a new `data.accessToken`.

### 3.5 Logout

```text
POST {{baseUrl}}/auth/logout
```

Expected: `200`; the refresh cookie is cleared.

## 4. Endpoint-by-endpoint tests

All responses use `{ "success": true, "data": ... }` on success and
`{ "success": false, "error": { "code", "message" } }` on failure.

### Health (public)

| Method | Path      | Auth | Purpose       |
| ------ | --------- | ---- | ------------- |
| GET    | `/health` | no   | Liveness probe |

### Users (authenticated)

| Method | Path        | Body                                            | Success | Notes                      |
| ------ | ----------- | ----------------------------------------------- | ------- | -------------------------- |
| GET    | `/users/me` | —                                               | 200     | Own profile                |
| PATCH  | `/users/me` | `{ "firstName": "New" }` (also lastName, phone) | 200     | Empty body → 422           |

### Addresses (authenticated, owner-scoped)

| Method | Path             | Body | Success |
| ------ | ---------------- | ---- | ------- |
| GET    | `/addresses`     | —    | 200     |
| POST   | `/addresses`     | address JSON below | 201 |
| GET    | `/addresses/:id` | —    | 200     |
| PATCH  | `/addresses/:id` | partial fields     | 200 |
| DELETE | `/addresses/:id` | —    | 200     |

Create body:

```json
{
  "label": "home",
  "fullName": "Test Customer",
  "phone": "9999999999",
  "addressLine1": "123 Main St",
  "city": "Mumbai",
  "state": "MH",
  "postalCode": "400001",
  "country": "India",
  "isDefault": true
}
```

`label` and `addressLine2` are optional. Save the returned `id`
as `{{addressId}}`. Another user's id → `404`.

### Categories (public reads, ADMIN writes)

| Method | Path              | Auth  | Body                          | Success |
| ------ | ----------------- | ----- | ----------------------------- | ------- |
| GET    | `/categories`     | no    | —                             | 200     |
| GET    | `/categories/:id` | no    | —                             | 200     |
| POST   | `/categories`     | ADMIN | `{ "name": "Audio" }`         | 201     |
| PATCH  | `/categories/:id` | ADMIN | `{ "description": "..." }`    | 200     |
| DELETE | `/categories/:id` | ADMIN | — (soft-deactivates)          | 200     |

Customer writes → `403`. Optional fields: `slug`, `description`,
`image`, `parentId`, `isActive`, `sortOrder`.

### Products (public reads, ADMIN writes)

| Method | Path                                        | Auth  | Success |
| ------ | ------------------------------------------- | ----- | ------- |
| GET    | `/products`                                 | no    | 200     |
| GET    | `/products/:id`                             | no    | 200     |
| POST   | `/products`                                 | ADMIN | 201     |
| PATCH  | `/products/:id`                             | ADMIN | 200     |
| DELETE | `/products/:id`                             | ADMIN | 200 (deactivates) |
| POST   | `/products/:productId/variants`             | ADMIN | 201     |
| PATCH  | `/products/:productId/variants/:variantId`  | ADMIN | 200     |
| DELETE | `/products/:productId/variants/:variantId`  | ADMIN | 200 (deactivates) |

Create body:

```json
{
  "name": "Power Bank",
  "categoryId": "{{categoryId}}",
  "brand": "TechPulse",
  "variants": [{ "sku": "PB-10K", "name": "10000mAh", "price": "100.50" }]
}
```

Save product `id` → `{{productId}}`, variant `id` → `{{variantId}}`.
Prices are decimal strings (`"100.50"`), never floats.

### Inventory (ADMIN only)

Base: `/products/:productId/variants/:variantId/inventory`

| Method | Body                                        | Success | Notes                          |
| ------ | ------------------------------------------- | ------- | ------------------------------ |
| GET    | —                                           | 200     | quantity, reserved, available  |
| POST   | `{ "quantity": 20 }`                        | 201     | initialize; duplicate → 409    |
| PATCH  | `{ "quantity": 5 }` or `{ "quantity": -3 }` | 200     | delta; over-decrement → 409    |

Customers get `403` on all three.

### Media (public reads, ADMIN writes)

Base: `/products/:productId/images`

| Method | Auth  | Body                                     | Success |
| ------ | ----- | ---------------------------------------- | ------- |
| GET    | no    | — (`/` and `/:imageId`)                  | 200     |
| POST   | ADMIN | multipart: file field `image`            | 201     |
| PATCH  | ADMIN | `{ "altText": "..." }`                   | 200     |
| DELETE | ADMIN | —                                        | 200     |

Upload requirements: JPEG/PNG/WebP only, max 5MB, max 8000px per side,
single file in the `image` field. Optional text fields: `variantId`,
`altText`, `sortOrder`, `isPrimary`. Files are converted to WebP with
server-generated names.

### Cart (authenticated, owner-scoped)

| Method | Path                  | Body                                | Success | Notes              |
| ------ | --------------------- | ----------------------------------- | ------- | ------------------ |
| GET    | `/cart`               | —                                   | 200     | lazy-created, kept when empty |
| POST   | `/cart/items`         | `{ "variantId": "{{variantId}}", "quantity": 2 }` | 200 | adds/increments |
| PATCH  | `/cart/items/:itemId` | `{ "quantity": 4 }`                 | 200     | absolute value     |
| DELETE | `/cart/items/:itemId` | —                                   | 200     | repeat → 404       |

Quantity must be an integer ≥ 1. Re-adding the same variant increments
it (single row). Unknown fields (`price`, `userId`) → `422`.
Inactive variant → `422`. Beyond available stock → `409`.

### Wishlist (authenticated, owner-scoped, product-level)

| Method | Path                      | Body                      | Success | Notes          |
| ------ | ------------------------- | ------------------------- | ------- | -------------- |
| GET    | `/wishlist`               | —                         | 200     | lazy-created   |
| POST   | `/wishlist/items`         | `{ "productId": "{{productId}}" }` | 200 | duplicate → 409 |
| DELETE | `/wishlist/items/:itemId` | —                         | 200     | repeat → 404   |

### Orders (authenticated, owner-scoped)

| Method | Path          | Body                                                      | Success |
| ------ | ------------- | --------------------------------------------------------- | ------- |
| POST   | `/orders`     | `{ "shippingAddressId": "{{addressId}}" }`                | 201     |
| GET    | `/orders`     | —                                                         | 200     |
| GET    | `/orders/:id` | —                                                         | 200     |

Optional `billingAddressId` adds a second `BILLING` snapshot.
Empty cart → `422`. Totals, prices, payment, and order number are all
server-generated; sending them → `422`. Another user's order id → `404`.

### Reviews (authenticated, owner-scoped, verified purchase)

| Method | Path               | Body                                                        | Success |
| ------ | ------------------ | ----------------------------------------------------------- | ------- |
| POST   | `/reviews`         | `{ "orderItemId": "<id>", "rating": 5, "title": "Great" }`  | 201     |
| GET    | `/reviews/me`      | —                                                           | 200     |
| GET    | `/reviews/:id`     | —                                                           | 200     |
| PATCH  | `/reviews/:id`     | `{ "rating": 4 }`                                           | 200     |
| DELETE | `/reviews/:id`     | —                                                           | 200     |

`orderItemId` comes from `GET /orders/:id` → `items[].id` and must belong
to one of your own orders. Rating is an integer 1–5. `productId` is
derived server-side — do not send it. Duplicate → `409`.
Another user's review id → `404`.

## 5. Recommended testing order

1. Health → Auth (register, login, me).
2. Addresses (create one; save id) → Users (`/users/me`).
3. Categories (ADMIN) → Products (ADMIN, with variant; save ids).
4. Inventory (ADMIN initialize stock for the variant).
5. Media upload (ADMIN, optional).
6. Cart (add/update/delete) → Wishlist (add/delete).
7. Orders (checkout; save order id and `items[].id`).
8. Reviews (use the saved `orderItemId`).
9. Negative/ownership checks throughout with a second customer.

Admin calls need an `ADMIN` user: register a second account and grant it
the `ADMIN` role directly in the database, then login again to get an
admin bearer token.

## 6. Test data guidance

- Create in order: category → product+variant → inventory → address.
- Copy from responses: `categoryId`, `productId`, `variantId`,
  `addressId`, cart `itemId`, `orderId`, order `items[].id` (for reviews).
- Use unique values per run (emails, SKUs, slugs) to avoid `409` conflicts.
- Example generic values: email `customer1@example.com`, password
  `Password123!`, SKU `PB-10K`, price `"100.50"`.

## 7. Business rules to test manually

- Ownership isolation: second customer must get `404` (not `403`) for
  your address/cart-item/wishlist-item/order/review ids.
- Inactive resources: deactivated product/variant cannot be added to cart;
  wishlist/order/review creation rejects inactive products where enforced.
- Duplicates: same variant re-added increments (one row); same wishlist
  product → `409`; same order item reviewed twice → `409`.
- Stock: ordering more than available → `409 INSUFFICIENT_STOCK`;
  cart adds never change inventory quantities.
- Cart: add increments, update sets absolute, deleting the last item keeps
  an empty cart.
- Checkout: one atomic `POST /orders` creates order + items + address
  snapshot(s) + `CASH_ON_DELIVERY`/`PENDING` payment + ledger entries and
  clears the cart; any failure leaves everything unchanged.
- History: rename/reprice/deactivate a product or edit an address after
  ordering, then re-`GET` the order — snapshots must be unchanged.
- Reviews: only your own order items are accepted; `productId`, `userId`,
  `verified`, `isApproved` in the body → `422`.
- Coupons/payments: no public endpoints exist (see below); `POST /orders`
  rejects coupon/payment fields with `422`.

## 8. APIs that intentionally do NOT exist

Do not expect these; they return `404 ROUTE_NOT_FOUND`:

- No public coupon endpoints (`/coupons`, validate, apply).
- No public payment endpoints (`/payments`, capture, refund).
- No online payment provider or webhook API.
- No review moderation, approval, listing, or aggregate endpoints.
- No order cancellation, status-change, or payment-mutation endpoints.
- No other undocumented admin endpoints.

Coupon validation and the COD provider exist only as internal backend
modules for future use; they have no HTTP surface.

## 9. Troubleshooting

| Symptom | Likely cause / fix |
| ------- | ------------------ |
| Connection refused | Server not running — run `npm start` in `backend/` |
| `401 AUTH_UNAUTHORIZED` | Missing/expired `Authorization: Bearer` header — login again |
| `401` on refresh | Refresh cookie missing/expired — login again |
| `403 AUTH_FORBIDDEN` | Endpoint needs `ADMIN` — use an admin token |
| `404 ROUTE_NOT_FOUND` | Wrong path or method; check section 4 |
| `404` with resource code | Wrong id or another user's resource (by design) |
| `409` | Duplicate (email, SKU, slug, wishlist item, review) or insufficient stock |
| `422 VALIDATION_ERROR` | Body failed strict validation — check required fields, types, unknown fields |
| `429 RATE_LIMIT_EXCEEDED` | Too many requests — wait for the window (defaults: 100/15min global, 30/15min auth) |
| Media upload fails | Must be multipart with file field exactly `image`; JPEG/PNG/WebP ≤ 5MB |
| `500` | Unexpected server error — check the backend console logs |

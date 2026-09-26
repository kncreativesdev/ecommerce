# API Conventions

## 1. Base URL

All API endpoints use:

`/api/v1`

Example:

`GET /api/v1/products`

## 2. HTTP Methods

Use standard HTTP semantics:

* GET — retrieve resources
* POST — create resources/actions
* PATCH — partially update resources
* DELETE — remove/deactivate resources where appropriate

## 3. Resource Identifiers

Internal resource identifiers use UUIDs.

Products may additionally expose/use slugs for public catalog URLs.

Orders have:

* UUID internal `id`
* unique human-readable `order_number`

Example:

`ORD-2026-000001`

## 4. JSON Responses

Successful responses should use a consistent structure.

Example:

```json
{
  "success": true,
  "data": {}
}
```

Collections may additionally contain pagination metadata.

Example:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

## 5. Error Responses

Errors should use a consistent structure.

Example:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": {}
  }
}
```

Do not expose stack traces or internal errors to clients.

## 6. HTTP Status Codes

Use appropriate status codes:

* 200 — successful request
* 201 — resource created
* 204 — successful request with no response body
* 400 — invalid request
* 401 — unauthenticated
* 403 — authenticated but not authorized
* 404 — resource not found
* 409 — conflict
* 422 — validation/business input failure where appropriate
* 429 — rate limited
* 500 — unexpected server error

## 7. Validation

Request validation uses Zod.

Validation occurs before business logic.

Validation schemas belong with their relevant module.

## 8. Pagination

Collection endpoints should use consistent pagination parameters where applicable.

Default values should be defined centrally.

Typical parameters:

* `page`
* `limit`

Do not allow unreasonable client-controlled limits.

## 9. Filtering and Sorting

Filtering and sorting must be explicitly supported by each endpoint.

Never convert arbitrary query parameters directly into database queries.

Only allow documented fields.

## 10. Authentication

Protected endpoints require authentication middleware.

Authentication does not automatically imply authorization.

Authorization is checked according to the resource and operation.

## 11. Ownership

User-owned resources must verify ownership server-side.

Examples:

* addresses
* cart
* wishlist
* reviews
* applicable orders

A UUID supplied by a client does not prove ownership.

## 12. Products and Prices

Product prices used for purchases must come from the server/database.

Clients must not determine:

* unit price
* subtotal
* discount
* tax
* shipping
* grand total

## 13. Orders

Order creation must be transactional.

The server calculates order totals and verifies inventory.

Historical order item and address information must use database snapshots.

Order lifecycle is a forward-only state machine
(`PENDING → CONFIRMED → PROCESSING → DISPATCHED → IN_TRANSIT →
ARRIVED_IN_CITY → OUT_FOR_DELIVERY → DELIVERED → COMPLETED`;
`CANCELLED` from pre-dispatch states only; `SHIPPED` is a legacy
read-only state). Transitions are ADMIN-only, validated server-side,
and atomically append one immutable `order_status_history` row plus one
customer notification. Same-status writes are rejected (`409`).

## 14. Payments

Initial payment method:

`CASH_ON_DELIVERY`

Online gateway integration is not part of the initial API implementation.

Payment architecture must allow future providers.

## 15. Notifications

Transactional customer notifications are system-generated, never
client-written. Order-status notifications are created inside the
order-status transaction. Customers read only their own notifications;
unread counts are authoritative server values.

Marketing broadcasts and the site announcement are separate concepts:
admin-authored, time-bounded, and read from dedicated endpoints. The
public announcement endpoint exposes safe fields only.

## 16. API Evolution
Breaking API changes require explicit review.

Prefer additive changes when possible.

API documentation must be updated when endpoints or contracts change.

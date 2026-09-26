# Backend Architecture

## 1. Purpose

Tech Pulse backend is a modular monolith API for a single-brand gadget e-commerce platform.

The backend is client-agnostic. Web frontend, mobile applications, Postman, or future clients communicate only through the HTTP API.

The backend is responsible for authentication, users, addresses, catalog, media, inventory, cart, wishlist, orders, payments, reviews, and coupons.

## 2. Technology Stack

* Node.js
* Express.js
* JavaScript
* MySQL
* Prisma ORM 7.10.0
* Zod
* JWT
* Argon2id
* cookie-parser
* multer
* sharp
* Pino / pino-http
* Helmet
* CORS
* express-rate-limit
* Vitest
* Supertest
* npm

API prefix:

`/api/v1`

## 3. Architecture Style

The backend uses a modular monolith.

Each business domain is isolated inside `src/modules`.

Initial modules:

* auth
* users
* addresses
* categories
* products
* inventory
* media
* cart
* wishlist
* orders
* payments
* reviews
* coupons

There is no separate admin module initially. Administrative capabilities are controlled through roles and authorization middleware.

## 4. Request Flow

The standard request flow is:

HTTP Request
→ Route
→ Controller
→ Validation
→ Service
→ Repository
→ Prisma
→ MySQL

Responses travel back through the same application layers.

### Route

Routes define:

* HTTP method
* URL
* middleware
* controller handler

Routes must not contain business logic or Prisma queries.

### Controller

Controllers:

* read request data
* call the appropriate service
* return HTTP responses
* translate service results into API responses

Controllers must not directly access Prisma.

### Validation

Zod validates:

* request body
* query parameters
* route parameters
* relevant request data

Invalid input must be rejected before business logic executes.

### Service

Services contain:

* business rules
* orchestration
* authorization-sensitive business decisions
* transactions
* coordination between repositories/services

Services must not contain unnecessary HTTP-specific logic.

### Repository

Repositories contain database access through Prisma.

Repositories must not:

* handle HTTP requests
* return HTTP responses
* contain route logic
* know about Express

## 5. Project Structure

```text
backend/
├── docs/
├── src/
│   ├── config/
│   ├── constants/
│   ├── middleware/
│   ├── utils/
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── addresses/
│   │   ├── categories/
│   │   ├── products/
│   │   ├── inventory/
│   │   ├── media/
│   │   │   └── storage/
│   │   ├── cart/
│   │   ├── wishlist/
│   │   ├── orders/
│   │   ├── payments/
│   │   ├── reviews/
│   │   └── coupons/
│   ├── routes/
│   │   └── index.js
│   ├── app.js
│   └── server.js
├── prisma/
├── storage/
│   └── uploads/
├── tests/
├── .env
├── .env.example
├── package.json
└── README.md
```

Do not create internal files for every module before that module is implemented.

## 6. Module Boundaries

Business code belongs inside its relevant module.

Avoid generic root-level:

```text
controllers/
services/
repositories/
```

Instead:

```text
modules/products/
├── product.routes.js
├── product.controller.js
├── product.service.js
├── product.repository.js
└── product.validation.js
```

Exact internal filenames may be adapted to existing project conventions, but the layer boundaries must remain.

## 7. Database Access

Prisma is the only ORM/database access layer.

A single shared Prisma Client instance must be used by the application.

Repositories access the shared Prisma client.

Modules must not instantiate independent Prisma clients.

Database schema and migrations are governed by `docs/DATABASE.md`.

## 8. Transactions

Transactions are required for operations where multiple database changes must succeed or fail together.

Important transactional operations include:

* order creation
* inventory reservation/decrement
* order cancellation
* inventory release
* inventory adjustment

## 9. Dependency Rules

Allowed dependency direction:

```text
routes
  ↓
controllers
  ↓
services
  ↓
repositories
  ↓
Prisma
```

Additional service-to-service calls are allowed only when genuinely required.

Forbidden:

* repository → controller
* repository → route
* service → route
* controller → Prisma
* route → Prisma
* business module directly manipulating filesystem storage
* duplicated Prisma Client instances

Circular dependencies should be avoided.

## 10. API Design

All API endpoints use:

`/api/v1`

Responses should use a consistent JSON structure.

Errors are handled centrally rather than independently in every controller.

Authentication and authorization are middleware concerns plus service-level business authorization where required.

## 11. Authentication

Authentication uses:

* short-lived JWT access tokens
* refresh tokens
* secure HttpOnly refresh-token cookie
* Argon2id password hashing

Roles initially include:

* CUSTOMER
* ADMIN

Authorization is enforced through middleware.

## 12. Media

Uploaded images are stored on the server filesystem.

MySQL stores metadata only.

Business modules must use the Media Service rather than directly manipulating filesystem paths.

See `docs/MEDIA.md`.

## 13. Payments

Online payment gateway integration is intentionally excluded from the initial implementation.

The payment layer must remain provider-agnostic so a future provider can be added without redesigning orders.

Initial payment method:

`CASH_ON_DELIVERY`

## 14. Postman

Postman is only an API client/testing tool.

No backend logic may depend on Postman.

## 15. Frontend

Frontend implementation is out of scope for this backend architecture.

The API must remain independent of any frontend framework.

## 16. Architecture Change Policy

Do not redesign architecture during implementation.

If implementation reveals a genuine architectural problem:

1. Stop implementation of the affected change.
2. Explain the problem.
3. Propose the smallest necessary change.
4. Update the relevant documentation after approval.
5. Only then implement the change.

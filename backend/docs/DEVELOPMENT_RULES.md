# Development Rules

## 1. Architecture First

The architecture documented in:

* ARCHITECTURE.md
* DATABASE.md
* API.md
* SECURITY.md
* MEDIA.md

is authoritative.

Implementation must follow these documents.

## 2. Cursor's Role

Cursor is the implementation engineer.

Cursor must not independently redesign:

* architecture
* database schema
* module boundaries
* technology stack
* authentication strategy
* media architecture
* API conventions

## 3. Change Control

If implementation requires an architectural or database change:

STOP.

Explain:

1. what needs to change
2. why it is necessary
3. what files are affected
4. possible alternatives

Wait for approval before implementing it.

## 4. Database Rules

The initial database migration has already been applied.

Do not:

* run `prisma migrate reset`
* delete migrations
* recreate the database
* generate another initial migration
* change schema casually
* upgrade Prisma without approval

Current Prisma version:

`7.10.0`

Prisma 7 configuration must keep the datasource URL in `prisma7.config.ts`.

## 5. Prisma Rules

Use one shared Prisma Client instance.

Do not instantiate Prisma inside individual modules.

Repositories are responsible for Prisma queries.

## 6. Layer Rules

Routes:

* routing
* middleware configuration

Controllers:

* HTTP input/output
* call services

Validation:

* Zod schemas

Services:

* business logic
* orchestration
* transactions

Repositories:

* database access

Mappers:

* convert database entities to API-safe responses

## 7. Security Rules

Never expose:

* password hashes
* tokens
* secrets
* cookies
* internal errors

All externally supplied data must be validated.

Server-side values are authoritative.

## 8. File Rules

Do not store image binaries in MySQL.

Do not allow business modules to manipulate filesystem paths directly.

Use the Media Service.

## 9. Business Rules

Prices, discounts, inventory, order totals, payment states, and permissions must be determined server-side.

Never trust values supplied by a client.

## 10. Transactions

Use database transactions for operations requiring atomic consistency.

Especially:

* order creation
* inventory changes associated with orders
* order cancellation
* inventory adjustment

## 11. Testing

New business logic should have appropriate unit or integration tests.

Important flows must have integration coverage.

At minimum, test:

* authentication
* authorization
* validation
* product/catalog operations
* inventory
* cart
* order creation
* order cancellation
* reviews
* coupons

## 12. Implementation Style

Prefer:

* small focused files
* explicit dependencies
* readable code
* clear naming
* minimal abstractions
* reusable utilities only when justified

Avoid:

* premature abstractions
* giant files
* duplicated business rules
* circular dependencies
* unnecessary packages

## 13. Dependencies

Do not install packages unless they solve a real project requirement.

Before adding a dependency, check whether the existing stack already provides the required capability.

## 14. Documentation

When an approved architectural change is made, update the relevant documentation before or together with the implementation.

## 15. Implementation Process

Implement in small logical stages:

1. Prisma/database infrastructure
2. Express application foundation
3. global middleware/error handling
4. authentication
5. users
6. addresses
7. categories
8. products
9. media
10. inventory
11. cart
12. wishlist
13. coupons
14. orders
15. payments
16. reviews
17. testing/hardening

Do not implement future stages prematurely.

## 16. Verification

After each logical stage:

* run relevant tests
* run validation
* check syntax
* inspect changed files
* report results

Then stop for review before proceeding to a different major stage.

## 17. Frontend

Frontend work is completely out of scope.

Do not create frontend files or modify frontend architecture.

## 18. Postman

Postman is an external API client.

Do not add Postman-specific code to the backend.

## 19. Completion Standard

A feature is not considered complete merely because the endpoint exists.

Verify:

* validation
* authorization
* business rules
* database behavior
* error handling
* security
* tests
* response format

# TECH PULSE BACKEND — MASTER ENGINEERING INSTRUCTIONS

You are the implementation engineer for the Tech Pulse backend.

This is an EXISTING backend project previously worked on by another coding agent.

Your responsibility is to continue the implementation without destroying, duplicating, or redesigning existing work.

==================================================

## 1. SOURCE OF TRUTH — HIGHEST PRIORITY

==================================================

The following files are the authoritative project specification:

* docs/ARCHITECTURE.md
* docs/DATABASE.md
* docs/API.md
* docs/SECURITY.md
* docs/MEDIA.md
* docs/DEVELOPMENT_RULES.md

READ THESE FILES BEFORE IMPLEMENTING ANY TASK.

The documentation is the project's source of truth.

Do NOT rely on your generic coding preferences when they conflict with these documents.

Do NOT redesign the architecture.

Do NOT invent a different architecture.

If uncertain, inspect the documentation and existing code before making a decision.

==================================================

## 2. EXISTING PROJECT — DO NOT REBUILD

==================================================

This project already contains infrastructure created by a previous agent.

Existing important files include:

* src/config/database.js
* src/app.js
* src/server.js
* src/routes/index.js
* scripts/smoke-express.js

Existing Prisma configuration:

* prisma7.config.ts

Existing Prisma schema:

* prisma/schema.prisma

Existing initial migration:

* prisma/migrations/20260916115156_init/

The existing initial migration has already been applied.

DO NOT:

* reset the database
* delete migrations
* recreate the initial migration
* blindly regenerate existing infrastructure
* create duplicate Prisma clients
* create duplicate configuration files

Inspect existing files before changing them.

==================================================

## 3. BACKEND ONLY

==================================================

This project is BACKEND ONLY.

Do not create frontend code.

Do not create an Admin Panel.

Postman is simply an HTTP client used for API testing and management.

The backend must remain client-agnostic.

==================================================

## 4. ARCHITECTURE

==================================================

Use a MODULAR MONOLITH.

Domain modules belong under:

src/modules/

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

There is NO admin module at this stage.

Use roles and authorization middleware for administrative permissions.

==================================================

## 5. REQUEST FLOW

==================================================

The required request flow is:

HTTP Request
↓
Route
↓
Controller
↓
Validation
↓
Service
↓
Repository
↓
Prisma
↓
MySQL

Maintain these boundaries strictly.

==================================================

## 6. LAYER RESPONSIBILITIES

==================================================

### Routes

Routes:

* define endpoints
* attach middleware
* connect routes to controllers

Routes MUST NOT:

* contain business logic
* query Prisma
* contain database operations

### Controllers

Controllers:

* read request data
* call services
* return HTTP responses

Controllers MUST NOT:

* directly query Prisma
* contain database logic
* contain substantial business rules

### Validation

Use Zod.

Validate external input before business logic.

Validation belongs to the relevant module.

### Services

Services contain:

* business rules
* orchestration
* authorization decisions where appropriate
* transactions
* cross-domain coordination where genuinely necessary

Avoid unnecessary service-to-service dependencies.

Avoid circular dependencies.

### Repositories

Repositories contain database access only.

Repositories use Prisma.

Repositories MUST NOT:

* handle HTTP
* access req/res
* contain route logic
* depend on controllers

### Mappers

Mappers transform database entities into API-safe objects.

Never expose sensitive database fields such as:

* password_hash
* internal security information
* refresh token secrets

==================================================

## 7. FORBIDDEN DEPENDENCIES

==================================================

Never create:

repository → controller

service → route

controller → Prisma

Business modules must not directly manipulate filesystem storage.

==================================================

## 8. DATABASE

==================================================

Database:

MySQL

ORM:

Prisma 7.10.0

Primary keys:

UUID

Money:

DECIMAL(10,2)

Never use FLOAT or DOUBLE for money.

Timestamps:

UTC.

Use:

* foreign keys
* unique constraints
* indexes
* transactions where required

Avoid unnecessary JSON blobs where relational structure is appropriate.

Use soft deactivation where appropriate instead of destructive deletion.

==================================================

## 9. PRISMA

==================================================

The project uses Prisma 7.10.0.

The Prisma CLI configuration is:

prisma7.config.ts

DO NOT rename it.

DO NOT create prisma.config.ts.

DO NOT create another Prisma configuration.

The existing shared runtime client is:

src/config/database.js

Reuse it everywhere.

Do NOT create another PrismaClient.

The current runtime uses:

@prisma/adapter-mariadb

This is a Prisma runtime adapter for the MySQL-compatible connection.

Do NOT interpret this as a requirement to convert the database to MariaDB.

==================================================

## 10. DATABASE SAFETY

==================================================

The existing schema and initial migration are already established.

NEVER run destructive commands such as:

* prisma migrate reset
* database reset
* dropping the database
* deleting migrations
* recreating the initial migration

Do not modify the schema or migrations unless the current task explicitly requires a database change.

If a database change is genuinely required:

* explain why
* inspect existing schema
* make the smallest necessary change
* create a proper migration
* never rewrite history

==================================================

## 11. AUTHENTICATION

==================================================

Authentication architecture:

* short-lived JWT access token
* refresh token
* secure HttpOnly refresh-token cookie
* Argon2id password hashing
* cookie-parser
* environment-based secrets
* role authorization middleware

Roles:

CUSTOMER
ADMIN

Do not implement authentication unless it is the current requested task.

==================================================

## 12. MEDIA

==================================================

Initial storage is local filesystem.

Structure:

storage/uploads/products/<product-uuid>/
storage/uploads/categories/
storage/uploads/users/

MySQL stores metadata only.

Never store image binaries in MySQL.

Media architecture:

media.controller
↓
media.service
↓
localStorage
↓
filesystem

Use Sharp for image processing.

Product/business code must not directly manipulate filesystem paths.

==================================================

## 13. PAYMENTS

==================================================

Initial payment method:

CASH_ON_DELIVERY

No online payment gateway is currently required.

Future architecture should allow:

PaymentService
├── Razorpay
└── other provider

Do not install or integrate a payment gateway unless explicitly requested.

==================================================

## 14. INVENTORY

==================================================

Inventory belongs to product variants.

Available quantity:

quantity - reserved_quantity

All inventory mutations must go through the Inventory Service.

==================================================

## 15. ORDERS

==================================================

Orders preserve historical snapshots.

Order items must preserve relevant purchase-time information including:

* product name
* variant name
* SKU
* unit price
* discount
* quantity
* line total

Order addresses are immutable snapshots.

Do not depend on a user's current address after order creation.

Orders use:

* UUID internal ID
* unique human-readable order_number

Example:

ORD-2026-000001

==================================================

## 16. TRANSACTIONS

==================================================

Use database transactions for atomic operations.

Order creation should atomically handle relevant operations such as:

* order
* order items
* address snapshots
* inventory reservation/decrement
* payment record where applicable

Order cancellation should atomically handle:

* order status
* inventory release
* inventory transaction

Inventory adjustment should atomically handle:

* inventory update
* inventory transaction ledger entry

==================================================

## 17. REVIEWS

==================================================

Reviews enforce ownership.

Relevant user-management endpoints include:

GET /api/v1/reviews/me
GET /api/v1/reviews/:id
PATCH /api/v1/reviews/:id
DELETE /api/v1/reviews/:id

Users may manage only their own reviews.

Verified purchase logic should use the relevant order item.

==================================================

## 18. SECURITY

==================================================

Never expose:

* password hashes
* JWT secrets
* refresh token secrets
* internal security fields

Normalize emails.

Validate external input.

Use Zod.

Enforce authorization server-side.

Never trust client-supplied roles or permissions.

==================================================

## 19. IMPLEMENTATION DISCIPLINE

==================================================

Implement the backend incrementally.

NEVER implement the entire backend in one task.

For every task:

1. READ relevant documentation.
2. INSPECT existing code.
3. IDENTIFY what already exists.
4. PLAN the smallest required change.
5. IMPLEMENT only the requested task.
6. VERIFY the implementation.
7. REVIEW the diff.
8. STOP.

Do not automatically continue to the next module.

==================================================

## 20. DO NOT OVERENGINEER

==================================================

Do not add:

* unnecessary abstractions
* unnecessary packages
* unnecessary configuration
* unnecessary folders
* speculative features
* placeholder implementations for future modules

Create module files only when that module is actually being implemented.

==================================================

## 21. MODEL/QUOTA HANDOFF RULE

==================================================

This project may be implemented using different AI models over time.

Therefore:

NEVER assume that conversational memory contains the project architecture.

The repository and documentation are the persistent memory.

When a new model/session starts:

1. Read AGENTS.md.
2. Read the relevant docs/*.md files.
3. Inspect existing code.
4. Continue from the current repository state.

Never rebuild work simply because another model created it.

==================================================

## 22. CURRENT STATE

==================================================

Current foundation already includes:

* Prisma database infrastructure
* Express application foundation
* shared Prisma client
* server bootstrap
* central API router
* Express smoke test
* initial database migration

The Express health endpoint task is currently being completed.

Before changing anything, inspect the actual files to determine whether:

GET /api/v1/health

already exists.

If it does not exist, implement it as part of the current foundation task.

==================================================

## 23. CURRENT TASK RULE

==================================================

Only implement the task I explicitly give you.

For example:

If I say:

"Implement Express foundation"

do ONLY that.

Do not implement:

* auth
* users
* products
* inventory
* media
* cart
* wishlist
* orders
* payments
* reviews
* coupons

unless explicitly requested.

==================================================

## 24. VERIFICATION

==================================================

After implementation, run appropriate local checks.

Examples:

* syntax checks
* unit tests
* integration tests
* smoke tests
* application startup
* API endpoint verification
* git diff
* git status

Do not claim a test passed unless you actually ran it.

Do not claim a file was modified unless you actually modified it.

Do not claim the database was migrated unless you actually performed and verified the migration.

==================================================

## 25. REPORT FORMAT

==================================================

After each task report:

TASK: <what was implemented>

FILES CREATED: <list>

FILES MODIFIED: <list>

DEPENDENCIES: <changes>

VERIFICATION: <commands actually executed>

RESULT: <result>

ISSUES:
<issues or "None">

NEXT STEP: <one recommended next task>

Then STOP.

==================================================

## 26. FIRST ACTION

==================================================

Before making any changes:

1. Read all relevant documentation.
2. Inspect the current repository.
3. Inspect git status.
4. Inspect the existing Express/Prisma foundation.
5. Determine exactly what is already implemented.

Do not delete or recreate existing work.

Do not modify files until you understand the current state.

Wait for the implementation task.

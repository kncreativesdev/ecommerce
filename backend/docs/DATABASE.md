# DATABASE.md

## 1. Purpose

This document is the authoritative database contract for the backend.

The database must model the actual e-commerce business domain and must not be designed around frontend implementation details.

Technology:

* MySQL
* Prisma ORM
* UUID primary keys
* UTC timestamps
* Relational data model
* `DECIMAL(10,2)` for monetary values

Any database structure change must be reflected in this document before implementation.

---

# 2. Core Rules

## 2.1 Primary Keys

All primary keys use UUIDs unless explicitly stated otherwise.

Example:

```text
id CHAR(36) / UUID
```

Prisma should generate UUID values where appropriate.

---

## 2.2 Timestamps

All entities that require lifecycle tracking use:

```text
created_at
updated_at
```

Timestamps are stored in UTC.

`updated_at` must automatically update when the record changes where supported by Prisma.

---

## 2.3 Money

Never use FLOAT or DOUBLE for money.

Use:

```text
DECIMAL(10,2)
```

Applicable fields include:

* product price
* compare-at price
* order subtotal
* discounts
* shipping
* tax
* grand total
* payment amount
* coupon values where monetary

---

## 2.4 Deletion

Business-critical historical data must not be physically deleted casually.

Prefer:

```text
is_active = false
```

for entities such as:

* users
* products
* variants
* categories
* coupons

Orders and their historical snapshots must remain available.

Foreign-key cascade behavior must be deliberate and documented.

---

# 3. Users and Authentication

## 3.1 users

```text
users
-----
id
email
password_hash
first_name
last_name
phone
is_active
created_at
updated_at
```

Rules:

* `id` is the primary key.
* `email` is required and unique.
* Email handling must be normalized to prevent case-based duplicate accounts.
* `password_hash` stores only Argon2id password hashes.
* Plain-text passwords must never be stored.
* `is_active` controls account availability.

---

## 3.2 roles

```text
roles
-----
id
name
created_at
```

Initial roles:

```text
CUSTOMER
ADMIN
```

Role names are unique.

The schema must allow additional roles later without redesigning the user model.

---

## 3.3 user_roles

```text
user_roles
----------
user_id
role_id
```

Rules:

* Composite primary key:

```text
(user_id, role_id)
```

* `user_id` references `users`.
* `role_id` references `roles`.
* A user may have multiple roles.
* A role may belong to multiple users.

---

# 4. Addresses

## 4.1 addresses

```text
addresses
---------
id
user_id
label
full_name
phone
address_line1
address_line2
city
state
postal_code
country
is_default
created_at
updated_at
```

Relationship:

```text
User 1 ──── N Addresses
```

Rules:

* A user can have multiple addresses.
* An address belongs to exactly one user.
* `is_default` identifies the user's default address.
* Address data used by an order must be copied into an immutable order snapshot.

---

# 5. Categories

## 5.1 categories

```text
categories
----------
id
parent_id
name
slug
description
image
is_active
sort_order
created_at
updated_at
```

Relationship:

```text
Category
   │
   ├── Category
   ├── Category
   └── Category
```

`parent_id` is a self-referencing foreign key.

Example:

```text
Audio
├── Speakers
├── Headphones
└── Earphones
```

Rules:

* `slug` is unique.
* `parent_id` may be null for top-level categories.
* Categories should normally be deactivated instead of deleted.
* `sort_order` controls ordering.
* `image` stores the media path/reference, not binary image data.

---

# 6. Products

## 6.1 products

```text
products
--------
id
category_id
name
slug
description
short_description
brand
is_active
is_featured
created_at
updated_at
```

Relationship:

```text
Category 1 ──── N Products
Product  1 ──── N Variants
Product  1 ──── N Images
Product  1 ──── N Reviews
```

Rules:

* `slug` is unique.
* Product does not directly contain stock.
* Product does not directly contain SKU when variants exist.
* Product does not directly contain the purchasable price when variants are used.
* Products are normally deactivated instead of physically deleted.

---

# 7. Product Variants

## 7.1 product_variants

```text
product_variants
----------------
id
product_id
sku
name
price
compare_at_price
barcode
weight
is_active
created_at
updated_at
```

Relationship:

```text
Product 1 ──── N ProductVariants
```

Variants represent purchasable units.

Example:

```text
Product: Power Bank

Variants:
├── 10,000mAh
└── 20,000mAh
```

Rules:

* `sku` is unique.
* `price` uses `DECIMAL(10,2)`.
* `compare_at_price` is nullable.
* Variant stock is stored in `inventory`.
* Variant can be deactivated independently of the product.

---

# 8. Product Images

## 8.1 product_images

```text
product_images
--------------
id
product_id
variant_id
filename
storage_path
image_type
alt_text
sort_order
is_primary
created_at
updated_at
```

Relationships:

```text
Product 1 ──── N ProductImages
Variant 1 ──── N ProductImages
```

`variant_id` may be null.

This allows:

```text
Product-level image
        OR
Variant-specific image
```

Rules:

* Image binaries are NOT stored in MySQL.
* `storage_path` points to the server filesystem.
* `filename` is the generated safe filename.
* Original user-supplied filenames must not be trusted as storage filenames.
* Images are processed using Sharp.
* WebP is the standard processed format.
* `sort_order` controls display order.
* `is_primary` identifies the primary image.

Physical storage:

```text
storage/uploads/products/<product-id>/
```

---

# 9. Inventory

## 9.1 inventory

```text
inventory
---------
id
variant_id
quantity
reserved_quantity
created_at
updated_at
```

Relationship:

```text
ProductVariant 1 ──── 1 Inventory
```

Rules:

* `variant_id` is unique.
* `quantity` represents physical/current stock.
* `reserved_quantity` represents stock reserved for active orders.
* Available stock is conceptually:

```text
quantity - reserved_quantity
```

Inventory modifications must go through the Inventory Service.

Other modules must not directly mutate inventory through Prisma.

---

## 9.2 inventory_transactions

```text
inventory_transactions
----------------------
id
variant_id
quantity
type
reference_type
reference_id
note
created_at
```

Examples:

```text
+20 INITIAL_STOCK
-2  ORDER
+1  ORDER_CANCELLED
+10 RESTOCK
-1  DAMAGED
```

The transaction table provides an audit trail of stock movements.

`quantity` may be positive or negative depending on transaction semantics.

---

# 10. Cart

## 10.1 carts

```text
carts
-----
id
user_id
created_at
updated_at
```

Relationship:

```text
User 1 ──── 1 Cart
Cart 1 ──── N CartItems
```

Initial implementation uses authenticated server-side carts.

---

## 10.2 cart_items

```text
cart_items
----------
id
cart_id
variant_id
quantity
created_at
updated_at
```

Rules:

* Unique constraint:

```text
(cart_id, variant_id)
```

* A cart item references a product variant.
* Quantity must be a positive integer.

---

# 11. Wishlist

## 11.1 wishlists

```text
wishlists
---------
id
user_id
created_at
updated_at
```

Initial implementation provides one default wishlist per user.

---

## 11.2 wishlist_items

```text
wishlist_items
--------------
id
wishlist_id
product_id
created_at
```

Rules:

* Wishlist references products, not variants.
* Unique constraint:

```text
(wishlist_id, product_id)
```

---

# 12. Orders

## 12.1 orders

```text
orders
------
id
user_id
order_number
status
subtotal
discount_total
shipping_total
tax_total
grand_total
currency
created_at
updated_at
```

Relationship:

```text
User 1 ──── N Orders
Order 1 ──── N OrderItems
Order 1 ──── N OrderAddresses
Order 1 ──── N Payments
Order 1 ──── N OrderStatusHistory
Order 1 ──── N Notifications
```

Order statuses (migration
`20260922123132_order_lifecycle_notifications_announcements`):

```text
PENDING
CONFIRMED
PROCESSING
SHIPPED        (legacy — kept for historical rows, never produced)
DISPATCHED
IN_TRANSIT
ARRIVED_IN_CITY
OUT_FOR_DELIVERY
DELIVERED
COMPLETED
CANCELLED
```

Forward-only machine: `PENDING → CONFIRMED|CANCELLED`,
`CONFIRMED → PROCESSING|CANCELLED`,
`PROCESSING → DISPATCHED|CANCELLED`,
`DISPATCHED → IN_TRANSIT`, `IN_TRANSIT → ARRIVED_IN_CITY`,
`ARRIVED_IN_CITY → OUT_FOR_DELIVERY`,
`OUT_FOR_DELIVERY → DELIVERED`, `DELIVERED → COMPLETED`;
`COMPLETED|CANCELLED` terminal; legacy
`SHIPPED → IN_TRANSIT|DELIVERED` compatibility path only.
`DELIVERED` records courier handover; `COMPLETED` closes the lifecycle.

Rules:

* `order_number` is unique.
* `order_number` is human-readable.
* `id` remains the internal UUID.
* Money fields use `DECIMAL(10,2)`.
* `currency` is stored explicitly.
* Historical order data must remain stable.

Example order number:

```text
ORD-2026-000001
```

---

# 13. Order Items

## 13.1 order_items

```text
order_items
-----------
id
order_id
product_id
variant_id
product_name
variant_name
sku
unit_price
discount
quantity
line_total
image_storage_path
created_at
```

Relationship:

```text
Order 1 ──── N OrderItems
```

Important:

Order items contain snapshots of product information.

For example:

```text
product_name
variant_name
sku
unit_price
discount
image_storage_path
```

must not depend on the current product record after the order is created.

This protects historical orders when products are:

* renamed
* repriced
* deactivated
* changed
* removed from the active catalog
* re-imaged (the snapshotted variant display image never changes)

`image_storage_path` is nullable: rows written before the snapshot
existed keep `NULL` (clients fall back gracefully); new rows capture the
purchased variant's display image at order time (variant primary →
variant first → product primary → product first, else `NULL`).

`product_id` and `variant_id` may still reference the original entities for traceability.

---

# 14. Order Addresses

## 14.1 order_addresses

```text
order_addresses
---------------
id
order_id
type
full_name
phone
address_line1
address_line2
city
state
postal_code
country
```

Types:

```text
SHIPPING
BILLING
```

Order addresses are immutable snapshots.

They must not depend on the user's current address record.

Example:

```text
User Address
     ↓
Order created
     ↓
Address copied
     ↓
Order Address Snapshot
```

Changing the user's address later must not modify an existing order.

---

# 15. Payments

## 15.1 payments

```text
payments
--------
id
order_id
method
status
amount
currency
transaction_reference
created_at
updated_at
```

Initial implementation does not integrate an online payment gateway.

Initial payment method may include:

```text
CASH_ON_DELIVERY
```

The payment architecture must remain provider-independent.

Future architecture:

```text
PaymentService
├── Razorpay
└── OtherProvider
```

Payment-provider implementation must not leak into order business logic.

---

# 16. Reviews

## 16.1 reviews

```text
reviews
-------
id
user_id
product_id
order_item_id
rating
title
comment
is_approved
created_at
updated_at
```

Relationships:

```text
User      1 ──── N Reviews
Product   1 ──── N Reviews
OrderItem 1 ──── 0..1 Review
```

Rules:

* `rating` must be constrained to the allowed rating range.
* Review ownership belongs to the authenticated user.
* A user must only be able to modify or delete their own review.
* Review ID alone must never grant permission to modify another user's review.
* One review per user per product is enforced through:

```text
(user_id, product_id)
```

Recommended initial creation rule:

A review should be associated with a verified purchase through `order_item_id`.

`is_approved` controls whether a review is publicly visible.

User profile functionality must support:

```text
GET    /api/v1/reviews/me
GET    /api/v1/reviews/:id
PATCH  /api/v1/reviews/:id
DELETE /api/v1/reviews/:id
```

---

# 17. Coupons

## 17.1 coupons

```text
coupons
-------
id
code
description
discount_type
discount_value
minimum_order_amount
maximum_discount_amount
usage_limit
used_count
starts_at
expires_at
is_active
created_at
updated_at
```

Rules:

* `code` is unique.
* Coupon validity depends on:

  * active state
  * start date
  * expiration date
  * usage limit
  * minimum order amount
* Discount calculation belongs to the service layer.
* Coupon application must be validated server-side.

---

## 17.2 coupon_products

```text
coupon_products
---------------
coupon_id
product_id
```

Relationship:

```text
Coupon N ──── N Products
```

Composite primary key:

```text
(coupon_id, product_id)
```

This supports product-specific coupons.

---

# 18. Entity Relationship Overview

```text
users
 │
 ├── user_roles ─── roles
 │
 ├── addresses
 │
 ├── carts
 │     └── cart_items ─── product_variants
 │
 ├── wishlists
 │     └── wishlist_items ─── products
 │
 ├── orders
 │     ├── order_items
 │     ├── order_addresses
 │     └── payments
 │
 └── reviews ─── products


categories
 │
 └── products
       │
       ├── product_variants
       │      └── inventory
       │             └── inventory_transactions
       │
       ├── product_images
       │
       └── reviews


coupons
 │
 └── coupon_products ─── products
```

---

# 19. Important Constraints

The database must enforce business invariants wherever practical.

Required unique constraints include:

```text
users.email

roles.name

categories.slug

products.slug

product_variants.sku

orders.order_number

(user_roles.user_id, user_roles.role_id)

(cart_items.cart_id, cart_items.variant_id)

(wishlist_items.wishlist_id, wishlist_items.product_id)

(reviews.user_id, reviews.product_id)

(coupon_products.coupon_id, coupon_products.product_id)

inventory.variant_id
```

---

# 20. Indexing

Indexes should exist on commonly queried foreign keys and business lookup fields.

Important indexes include:

```text
users.email

addresses.user_id

categories.parent_id
categories.slug

products.category_id
products.slug
products.is_active
products.is_featured

product_variants.product_id
product_variants.sku

product_images.product_id
product_images.variant_id

inventory.variant_id

inventory_transactions.variant_id
inventory_transactions.reference_id

carts.user_id

cart_items.cart_id
cart_items.variant_id

wishlists.user_id

wishlist_items.wishlist_id
wishlist_items.product_id

orders.user_id
orders.order_number
orders.status
orders.created_at

order_items.order_id
order_items.product_id
order_items.variant_id

order_addresses.order_id

payments.order_id

reviews.user_id
reviews.product_id
reviews.order_item_id

coupons.code
coupons.is_active
coupons.starts_at
coupons.expires_at
```

Additional composite indexes may be introduced when actual query patterns justify them.

Do not add indexes blindly.

---

# 21. Referential Integrity

Foreign keys must be explicitly defined.

General rules:

### User-owned operational data

Examples:

```text
users → addresses
users → carts
users → wishlists
```

These may use cascading deletion where it cannot damage historical business records.

### Historical commerce data

Examples:

```text
orders
order_items
order_addresses
payments
```

must not be casually cascade-deleted.

Historical records take priority over convenience.

### Products

Products should normally be deactivated:

```text
is_active = false
```

rather than physically deleted.

### Variants

Variants should normally also be deactivated.

### Reviews

Review deletion and related-product/user deletion must be handled deliberately rather than relying on accidental cascades.

---

# 22. Transaction Requirements

The following operations must use database transactions where multiple writes must succeed or fail together.

Examples:

### Order creation

```text
Create order
    ↓
Create order items
    ↓
Create order address snapshots
    ↓
Reserve/decrement inventory
    ↓
Create payment record
```

These operations must maintain consistency.

### Order cancellation

```text
Update order status
    ↓
Release inventory
    ↓
Create inventory transaction
```

### Inventory adjustment

```text
Update inventory
    ↓
Create inventory transaction
```

Both operations must remain consistent.

### Order status transition (admin)

```text
Update order status (conditional on expected status)
    ↓
Restore inventory + ORDER_CANCELLED ledger (CANCELLED only)
    ↓
Append one immutable order_status_history row
    ↓
Create one ORDER_STATUS customer notification
```

Status, history, and notification succeed or roll back together, so
the three can never silently diverge. Order creation seeds one
`PENDING` history row.

---

# 23. Inventory Rules

Inventory is controlled by the Inventory Service.

No controller should directly modify:

```text
inventory.quantity
inventory.reserved_quantity
```

Stock changes must produce an inventory transaction when appropriate.

Example:

```text
RESTOCK
ORDER
ORDER_CANCELLED
DAMAGED
INITIAL_STOCK
```

Negative available stock must not occur unless an explicitly approved business rule later requires it.

---

# 24. Order Snapshot Rules

Orders must preserve the state of the transaction at the time of purchase.

The order must not depend on mutable catalog data for historical display.

At minimum, `order_items` preserve:

```text
product_name
variant_name
sku
unit_price
discount
quantity
line_total
```

`order_addresses` preserve:

```text
full_name
phone
address_line1
address_line2
city
state
postal_code
country
```

---

# 25. Media Storage Rules

Images are stored on the server filesystem.

MySQL stores metadata only.

Storage structure:

```text
storage/
└── uploads/
    ├── products/
    ├── categories/
    └── users/
```

Product images:

```text
storage/uploads/products/<product-id>/
```

Example:

```text
storage/uploads/products/UUID/
├── image-1.webp
├── image-2.webp
└── image-3.webp
```

Database stores:

```text
filename
storage_path
image_type
alt_text
sort_order
is_primary
```

Image binaries must never be stored in database columns.

---

# 26. Future Extensions

Previously listed here, `order_status_history` is now implemented
(see §12 and the new §26A–26D below) because the order-tracking
milestone created the concrete business requirement.

```text
refresh_tokens
product_options
product_option_values
returns
refunds
audit_logs
```

They must not be added simply because they might become useful.

Add them when a concrete business requirement exists.

---

# 26A. Order Status History

```text
order_status_history
--------------------
id
order_id → orders.id (RESTRICT)
status
previous_status (nullable; null on the creation seed)
note (nullable operational note, ≤ 500 chars)
created_by (nullable admin user id; null for system seeds; no FK)
created_at
```

Rules:

* Append-only: application code never updates or deletes rows.
* One row per genuine state change (creation seeds `PENDING`).
* Never aggregated for revenue/analytics — lifecycle tracking only.
* Pre-milestone orders have no rows; readers fall back gracefully.

---

# 26B. Notifications (transactional)

```text
notifications
-------------
id
user_id → users.id (CASCADE)
type (ORDER_STATUS | MARKETING; currently ORDER_STATUS)
title
message
order_id → orders.id (nullable, SET NULL)
is_read
created_at
read_at (nullable)
```

Rules:

* Created server-side inside the triggering transaction only.
* Owner-scoped reads; cross-user access returns `404`.
* Marketing broadcasts are NOT fanned out here (see §26C).

---

# 26C. Marketing Notifications (admin broadcasts)

```text
marketing_notifications
-----------------------
id
title
message
type (DEAL | OFFER | ANNOUNCEMENT)
is_active
starts_at (nullable)
expires_at (nullable)
link_type (nullable: SHOP | CATEGORY | PRODUCT | COUPON)
link_value (nullable; required when link_type is set)
created_by (nullable admin user id; no FK)
created_at
updated_at
```

Rules:

* Rendered as an active in-window list; no per-user fan-out.
* Deletable: no historical/accounting dependency.

---

# 26D. Site Announcements (admin-editable top bar)

```text
site_announcements
------------------
id
message (≤ 200 chars)
is_active
starts_at (nullable)
expires_at (nullable)
link_label (nullable)
link_target (nullable internal route only)
priority
created_by (nullable admin user id; no FK)
created_at
updated_at
```

Rules:

* The storefront shows at most one row: active + in-window, highest
  `priority` first, then newest. No row → the bar hides.
* `linkTarget` accepts internal routes only (no external URLs).
* Deletable.

---

# 27. Database Change Policy

Before changing the schema:

```text
Requirement
    ↓
DATABASE.md update
    ↓
Review/approval
    ↓
Prisma schema update
    ↓
Migration
    ↓
Tests
```

Cursor must not independently redesign the database.

If implementation reveals that the schema is insufficient:

```text
STOP
↓
Explain the problem
↓
Propose the smallest structural change
↓
Approve change
↓
Update DATABASE.md
↓
Update Prisma schema
↓
Create migration
```

The database contract is the source of truth.

---

# 28. Initial Schema Scope

The initial Prisma schema must contain exactly these core entities:

```text
users
roles
user_roles
addresses

categories

products
product_variants
product_images

inventory
inventory_transactions

carts
cart_items

wishlists
wishlist_items

orders
order_items
order_addresses

payments

reviews

coupons
coupon_products
```

No `admin` table/module is required.

No online payment-provider-specific tables are required.

No cloud-storage-specific tables are required.

No frontend-specific tables are required.

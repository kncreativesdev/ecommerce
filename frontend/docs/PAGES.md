# Tech Pulse — Pages (PAGES)

Route params use backend UUIDs (`:id`, `:productId` reads) unless noted.
Auth: `PUBLIC` or `PROTECTED` (redirects to `/login?redirect=<path>`).
"APIs" lists only endpoints the page calls (see API_INTEGRATION.md for
contracts). Catalog filtering/sorting/search is client-side over the
`GET /products` + `GET /categories` cache (no backend query params exist).

---

## 1. Home — `/` (PUBLIC)

- **Purpose**: brand-first merchandised entry: company hero, icon category
  discovery, Popular/Featured, New Arrivals, Maximum Discounted rails,
  category rails, promos, trust strip.
- **Sections**: announcement bar → header (Category | New Arrivals | About Us
  | Support + Search | Cart | Login, plus Wishlist + Notification when
  authenticated) → company-first hero (Tech Pulse brand statement + About Us
  CTA → `/about`, plus Shop CTA) → category discovery with icons (8 seeded
  categories from `GET /categories`, Lucide icon mapped by slug + fallback)
  → Popular Products rail (from `isFeatured`, honestly labeled — see
  FRONTEND_SPEC §5) → New Arrivals rail (`createdAt` desc) → Maximum
  Discounted rail (best variant `% off` desc) → category rails (top N per
  category) → promo banners (static) → trust strip → footer + floating
  WhatsApp action.
- **Components**: `Layout`, `ProductCard`, `ProductGrid`/rails,
  `CategoryTile` (icon + name), `WhatsAppFloat`, `ThemeToggle`, Embla carousel,
  skeletons.
- **APIs**: `GET /categories`, `GET /products`
  (+ `GET /products/:productId/images` only if gallery data is not embedded;
  prefer embedded image metadata when present).
- **Loading**: rail/grid skeletons. **Empty**: no categories/products →
  "Catalog coming soon" state. **Error**: section error cards with retry.
- **Mobile**: stacked rails, swipeable carousels, 2-col compact cards,
  icon category scroller.
  **Desktop**: full-width hero, 4–5-col rails, category row under header.

## 2. Shop — `/shop` (PUBLIC)

- **Purpose**: browse the full catalog with client-side facet/sort.
- **Sections**: title + count, filter sidebar (category multi-select,
  brand, price bands, in-stock-plausible excluded — no stock API; discount
  %, featured), sort bar (featured, price ↑↓, discount %, newest), grid,
  client-side pagination.
- **APIs**: cached `GET /categories`, `GET /products`.
- **Loading/empty/error**: grid skeletons; "no products match filters" with
  clear-filters CTA; fetch error with retry.
- **Mobile**: filters in drawer; 2-col grid. **Desktop**: sidebar + 3–4-col grid.

## 3. Category — `/category/:id` (PUBLIC)

- **Purpose**: products within one category.
- **Sections**: breadcrumb, header (name/description/image), sub-category
  chips (from `parentId` hierarchy), sort + grid, related categories.
- **APIs**: `GET /categories/:id`, cached `GET /products` (filter
  `categoryId === :id` client-side), cached `GET /categories` (children).
- **Auth**: none. **Loading**: header + grid skeletons. **Empty**: "No
  products in this category yet" + shop CTA. **Error**: `404
  CATEGORY_NOT_FOUND` → `NotFoundPage`.
- **Mobile/desktop**: as Shop.

## 4. Search — `/search?q=...` (PUBLIC)

- **Purpose**: text search over the cached catalog (no backend endpoint).
- **Sections**: search input (debounced), result count, grid, suggestions
  (popular categories + featured) when empty query or no hits.
- **APIs**: cached `GET /products`, `GET /categories`. Match fields: product
  `name/brand/shortDescription/description`, variant `name/sku`, category name.
- **Loading**: input-responsive skeletons. **Empty**: "No results for 'q'" +
  suggestions. **Error**: catalog fetch failure → retry.
- **Mobile**: full-width search under header. **Desktop**: centered input +
  4-col results.

## 5. Product Detail — `/product/:id` (PUBLIC)

- **Purpose**: convert interest into cart/wishlist with variant selection.
- **Sections**: breadcrumbs; gallery (primary by `isPrimary`/`sortOrder`,
  thumbnails); info column (`brand`, name, `PriceBlock` with
  `compareAtPrice` discount badge, variant selector, quantity stepper, Add to
  Cart / Buy Now, wishlist toggle, COD + shipping assurances); tabs
  (description / specs from variant data / shipping static); related products
  (same category, exclude self); own-review hint (signed-in user's review for
  this `productId` via cached `GET /reviews/me`, with edit link).
- **APIs**: `GET /products/:id`, `GET /products/:productId/images`
  (if needed), cart/wishlist mutations (auth-gated at action time, not page).
- **Loading**: detail skeleton. **Empty**: n/a. **Error**: `404
  PRODUCT_NOT_FOUND` → not-found; inactive variant add → `422` message.
- **Mobile**: stacked gallery → info; sticky add-to-cart bar.
  **Desktop**: 2-col gallery | info; tabs below.

## 6. Cart — `/cart` (PROTECTED)

- **Purpose**: review and adjust server-side cart before checkout.
- **Sections**: lines (`CartLine`: image, names, unit price, stepper =
  absolute `PATCH`, remove, line total), summary (`CartSummary`: item count,
  subtotal from server, COD note, shipping/tax display — render server values
  only; if the cart payload carries only `subtotal`, show only subtotal +
  "taxes/shipping calculated at checkout" copy), checkout CTA, continue
  shopping.
- **APIs**: `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:itemId`,
  `DELETE /cart/items/:itemId`.
- **Loading**: line skeletons; button spinners. **Empty**: illustration +
  "Your cart is empty" + shop CTA. **Error**: `409 INSUFFICIENT_STOCK` →
  highlight + refresh; section retry.
- **Mobile**: stacked cards; sticky summary/checkout bar. **Desktop**:
  2-col lines | summary.

## 7. Wishlist — `/wishlist` (PROTECTED)

- **Purpose**: saved products (product-level).
- **Sections**: grid of `ProductCard` with remove + move-to-cart (adds
  default/first active variant via `POST /cart/items`, keeps wishlist line
  unless user removes it).
- **APIs**: `GET /wishlist`, `POST /wishlist/items`, `DELETE
  /wishlist/items/:itemId`.
- **Loading**: grid skeletons. **Empty**: "Nothing saved yet" + discover CTA.
  **Error**: retry; `409` on re-add treated as saved.
- **Mobile/desktop**: standard responsive grid.

## 8. Login — `/login?redirect=` (PUBLIC, redirects away when authenticated)

- **Purpose**: establish session.
- **Sections**: form (email, password, show/hide), submit, register link,
  redirect-back on success, inactive-account + invalid-credential messaging.
- **APIs**: `POST /auth/login` → bootstrap `GET /auth/me`, `GET /cart`,
  `GET /wishlist`.
- **Loading**: disabled submit + spinner (rate-limit friendly). **Error**:
  `401` form-level; `403` support message; `429` backoff.
- **Mobile/desktop**: centered card, same layout.

## 9. Register — `/register?redirect=` (PUBLIC)

- **Purpose**: create CUSTOMER account, then auto-login.
- **Sections**: form (email normalized trim+lowercase, password 8–128 with
  meter, optional firstName/lastName/phone), terms note (static), login link.
- **APIs**: `POST /auth/register` → `POST /auth/login` → bootstrap.
- **Error**: `409 AUTH_EMAIL_ALREADY_EXISTS` on email; `422 details[]` mapped
  to fields.

## 10. Account Dashboard — `/account` (PROTECTED)

- **Purpose**: hub + snapshot summaries.
- **Sections**: greeting, cards linking to profile/addresses/orders/reviews
  with counts (orders count from `GET /orders`, wishlist count, default
  address), logout.
- **APIs**: `GET /users/me`, `GET /orders`, `GET /wishlist`, `GET /addresses`.
- **Loading**: card skeletons. **Error**: per-card retry.

## 11. Profile — `/account/profile` (PROTECTED)

- **Purpose**: view/edit own profile.
- **Sections**: form (firstName, lastName, phone; email read-only — no email
  change endpoint), save disabled when untouched (empty PATCH → `422`).
- **APIs**: `GET /users/me`, `PATCH /users/me`.

## 12. Addresses — `/account/addresses` (PROTECTED)

- **Purpose**: address book CRUD.
- **Sections**: list (default badge, edit/delete/set-default), add/edit form
  (full field contract incl. `label?`, `isDefault?`), delete confirm.
- **APIs**: full `/addresses` CRUD.
- **Empty**: "No addresses yet" + add CTA (also the checkout prerequisite
  state). **Error**: `404` on stale ids → refresh list.

## 13. Orders — `/account/orders` (PROTECTED)

- **Purpose**: own order history, newest first.
- **Sections**: rows (orderNumber, date, status badge, total, thumbnail from
  snapshot, detail link). No cancel/reorder actions (no endpoints).
- **APIs**: `GET /orders`.
- **Empty**: "No orders yet" + shop CTA. **Error**: retry.

## 14. Order Detail — `/account/orders/:id` (PROTECTED)

- **Purpose**: immutable snapshot view + review entry points.
- **Sections**: header (orderNumber, date, status timeline display-only),
  items (snapshot names/sku/prices/qty/line totals + "Write a review" per
  order item when unreviewed), shipping/billing snapshots, payment snapshot
  (COD/PENDING/INR), totals.
- **APIs**: `GET /orders/:id` (+ `GET /reviews/me` to mark reviewed items).
- **Error**: `404 ORDER_NOT_FOUND` → not-found. No mutation UI.

## 15. My Reviews — `/account/reviews` (PROTECTED)

- **Purpose**: manage own reviews + find unreviewed purchases.
- **Sections**: unreviewed-items list (from orders' `items[].id` minus
  reviewed `orderItemId`s) with review CTAs; own reviews list (`ReviewCard` +
  edit/delete); `ReviewForm` (rating 1–5, title ≤255, comment ≤5000).
- **APIs**: `GET /reviews/me`, `POST /reviews`, `PATCH /reviews/:id`,
  `DELETE /reviews/:id` (+ `GET /orders` for unreviewed discovery).
- **Empty**: "No reviews yet" + shop-orders CTA. **Error**: `409
  REVIEW_ALREADY_EXISTS` → link existing; `404` on stale ids.

## 16. Checkout — `/checkout` (PROTECTED)

- **Purpose**: place COD order. Prereqs: non-empty cart (redirect to cart
  with messaging otherwise); zero saved addresses renders the address form
  inline (no redirect — the saved record is immediately selected).
- **Sections** (vertical stepper): 1) shipping address picker + inline
  create, 2) billing (same-as-shipping default or second picker), 3) review
  lines + COD summary (server totals only, fixed "Cash on Delivery" method),
  4) Place Order (single submit, double-submit guard).
- **APIs**: `GET /cart`, `GET /addresses` (+ `POST /addresses` inline),
  `POST /orders {shippingAddressId, billingAddressId?}`.
- **Success**: `201` → clear checkout state, navigate
  `/order-confirmation/:id`. **Failure**: `409 ORDER_INSUFFICIENT_STOCK` →
  back to cart with highlights; `422 ORDER_EMPTY_CART` → cart; `404
  ORDER_ADDRESS_NOT_FOUND` → re-pick.
- **Mobile**: stacked steps, sticky place-order bar. **Desktop**: 2-col
  steps | summary.

## 17. Order Confirmation — `/order-confirmation/:id` (PUBLIC with auth recovery)

- **Purpose**: confirm success (only a `201` from `POST /orders` means an
  order exists — never render this page from local state alone).
- **Sections**: success hero, orderNumber (prominent), snapshot summary,
  shipping address snapshot, COD note, CTAs (view order, continue shopping).
- **APIs**: `GET /orders/:id` (refetch so direct visits work; unauthenticated
  → login with redirect-back).
- **Error**: `404` → not-found ("order not found").

## 18. About Us — `/about` (PUBLIC)

- **Purpose**: Tech Pulse company introduction, brand story,
  mission/value proposition, trust sections (COD promise, category breadth,
  support pointers).
- **Sections**: hero (brand statement), story, mission/values grid, trust
  strip, CTA to shop/support. All copy is clearly-marked editable
  placeholder content until the company provides real information — no
  invented factual claims (founding dates, addresses, certifications).
- **APIs**: none (static content config).
- **Loading/empty/error**: static page — standard chrome only.
- **Mobile/desktop**: stacked sections → multi-column grids.

## 19. Support / Contact — `/support` (PUBLIC)

- **Purpose**: customer support, product/order queries, sales-order
  inquiries, physical company address, contact information, Google Map.
- **Sections**: contact cards (phone/email/address — placeholder until the
  company-info backend lands), query form (client-side validation; submits to
  a `mailto:`/configurable endpoint until a backend ticket API exists — label
  honestly), embedded Google Map slot (configurable `VITE_GOOGLE_MAPS_EMBED_URL`;
  static placeholder panel until configured), FAQ accordion (static),
  WhatsApp CTA deep-linking the floating action config.
- **APIs**: none until BACKEND_REQUIREMENTS_GAP.md §1 lands; page is built
  config-driven so it swaps to the company-info GET API without redesign.
  Company data is NEVER hardcoded as if database-backed.
- **Empty/error**: map-config-missing state; form validation states.
- **Mobile/desktop**: stacked cards → 2-col content + map sidebar.

## 20. 404 / Not-found — `*` (PUBLIC)

- **Purpose**: catch-all for bad routes and `404` API outcomes
  (missing/inactive product/category, another user's order/review/address).
- **Sections**: message, popular categories, featured products, home CTA.
- **APIs**: cached catalog for suggestions (no fetch on failure).

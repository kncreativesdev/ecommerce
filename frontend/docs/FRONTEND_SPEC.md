# Tech Pulse — Customer Storefront Specification (FRONTEND_SPEC)

Source of truth for backend behavior:

- `backend/docs/API.md`
- `backend/docs/API_CONTRACT_MATRIX.md`
- `backend/docs/FRONTEND_INTEGRATION.md`
- `backend/docs/SECURITY.md`
- `backend/docs/DATABASE.md`

Verified against backend implementation (`backend/src/routes/index.js` plus
module routes for products, orders, reviews, cart) where the task requires it.
Nothing in this document invents backend capabilities. Anything the backend
does not support is called out explicitly and deferred to
`API_INTEGRATION.md` ("DO NOT INVENT").

Base API prefix: `/api/v1` (local default `http://localhost:3000/api/v1`).

---

## 1. Purpose

Tech Pulse is a customer-facing ecommerce storefront for consumer electronics
and gadget accessories (audio, mobile accessories, computer accessories, car
accessories, smart gadgets — category tree is backend-driven, not hardcoded).

The storefront exists so a customer can:

1. Discover products through categories, browsing, and client-side search.
2. Inspect a product and its variants before buying.
3. Authenticate (register / login / session refresh / logout).
4. Manage profile and shipping/billing addresses.
5. Maintain a cart (variant-level) and a wishlist (product-level).
6. Check out with Cash on Delivery (COD) — the only payment method.
7. Track orders from immutable server-side snapshots.
8. Write and manage reviews tied to verified purchases (own order items only).

There is deliberately NO customer admin panel, NO seller flow, and NO online
payment flow in this phase.

## 2. Target experience

- A Portronics-grade electronics shopping experience (near-identical LEVEL of
  polish, density, and interaction quality — original Tech Pulse brand, never
  a generic template; see DESIGN_REFERENCE.md §12–§14): dense category
  navigation, promotional hero, category tiles, product rails, discount-first
  product cards, rich product detail pages, persistent cart/wishlist affordances.
- Light + dark themes with a global toggle, persisted preference, and
  token-driven components (see §21). Both themes meet the same polish,
  contrast, and hierarchy bar.
- Mobile-first responsive, desktop-enhanced. Touch targets ≥ 44px on mobile.
- Fast perceived performance: skeleton loaders, optimistic-where-safe UI
  (wishlist toggle, cart quantity), server-authoritative totals.
- Trust signals appropriate to COD commerce: clear pricing in INR, order
  numbers (`ORD-YYYY-NNNNNN`), immutable order snapshots, honest stock
  behavior ("availability confirmed at checkout").
- Accessible (WCAG 2.1 AA target): keyboard navigation, visible focus,
  sufficient contrast, semantic landmarks, announced loading/errors.

## 3. Customer-facing feature inventory

| # | Feature | Backend support | Auth |
|---|---------|-----------------|------|
| 1 | Home page (hero, categories, rails, promos) | `GET /categories`, `GET /products`, `GET /products/:productId/images` | Public |
| 2 | Shop / catalog browse (client-side filter/sort) | `GET /products`, `GET /categories` | Public |
| 3 | Category page (products in a category) | `GET /categories/:id`, `GET /products` filtered client-side by `categoryId` | Public |
| 4 | Search (client-side over fetched catalog) | No dedicated search endpoint; uses `GET /products` (+ categories) | Public |
| 5 | Product detail (gallery, variants, price, related) | `GET /products/:id`, `GET /products/:productId/images` | Public |
| 6 | Cart (add/increment, set quantity, remove) | `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:itemId`, `DELETE /cart/items/:itemId` | Required |
| 7 | Wishlist (save/remove products) | `GET /wishlist`, `POST /wishlist/items`, `DELETE /wishlist/items/:itemId` | Required |
| 8 | Register / Login / Logout / Session refresh | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` | Public / session |
| 9 | Account dashboard + profile edit | `GET /users/me`, `PATCH /users/me` | Required |
| 10 | Address book CRUD + default address | Full `/addresses` CRUD | Required |
| 11 | Checkout (address select + COD place order) | `POST /orders` (`shippingAddressId`, optional `billingAddressId`) | Required |
| 12 | Order history + order detail (snapshots) | `GET /orders`, `GET /orders/:id` | Required |
| 13 | Reviews: create from own order items; read/update/delete own | `POST /reviews`, `GET /reviews/me`, `GET /reviews/:id`, `PATCH /reviews/:id`, `DELETE /reviews/:id` | Required |
| 14 | Static/UX pages: 404, error states, empty states | None needed | Public |
| 15 | Theme: light/dark toggle, persisted preference, token-driven UI | No backend dependency (localStorage + CSS variables) | Public |

### Explicitly OUT of scope (backend does not expose these)

- Online payment (cards/UPI/netbanking), payment capture/refund, webhooks.
- Coupons / promo codes (no HTTP surface; no checkout integration).
- Order cancellation or status changes by the customer.
- Public review listing or rating aggregates on product pages.
  (Product pages can show the signed-in user's OWN reviews contextually, but
  there is no endpoint for "all reviews for product X".)
- Public stock/inventory display (inventory endpoints are admin-only).
- Cart "clear all" (delete lines individually).
- Admin catalog/media/inventory management in this storefront.

## 4. Navigation

Brand identity: the application consistently uses **TECH PULSE** everywhere
(header logo, titles, footer, metadata). The header logo always navigates to
Home (`/`).

### 4.1 Global chrome

- **Announcement bar** (top): rotating messages — COD available, shipping note,
  new launches. Dismissible. Content is static frontend config, not an API.
  It REMAINS in the new design.
- **Header (desktop)** — main menu, in order: `Category` (dropdown/mega-menu
  driven by `GET /categories`) | `New Arrivals` (`/shop?sort=newest`) |
  `About Us` (`/about`) | `Support` (`/support`). Right-side actions, in
  order: `Search` | `Cart` | `Login`. When the customer is logged in, the
  header additionally shows `Wishlist` and `Notification` (bell). The
  notification icon is a future-backend placeholder (see §22): it renders the
  entry point with an honest empty/disabled state until a notification API
  exists — no fabricated notification data. The light/dark theme toggle is
  always present in the icon cluster.
- **Header (mobile)**: compact bar — hamburger, logo (→ Home), search icon,
  cart icon with badge, theme-toggle affordance. Slide-in drawer with:
  Category accordion, New Arrivals, About Us, Support, account links (Login,
  or Wishlist + Notifications when authenticated), theme toggle row. Mobile
  navigation stays uncrowded: at most five top-level drawer entries plus the
  account section.
- **Footer**: shop links (categories), About Us, Support/Contact, help
  (shipping/COD/returns policy — static content, must not promise
  backend-unsupported flows like online refunds), contact placeholder,
  copyright. Newsletter signup is decorative
  unless a backend is added later — mark as "future backend change" if built.
- **Floating WhatsApp action** (desktop and mobile): fixed bottom-right
  floating button above sticky buy bars (`z-30`), rendered in both themes,
  with an accessible label ("Chat with Tech Pulse on WhatsApp"), visible
  hover/focus ring, and keyboard reachability. The destination is
  configurable (`VITE_WHATSAPP_LINK`, e.g. `https://wa.me/<number>`); until
  the company provides the real number it uses a clearly-marked placeholder
  and must not obstruct CTAs, sticky bars, or toasts.
- **Breadcrumbs**: Home / Category / Product; Home / Account / Orders / Detail.

### 4.2 Route map (summary; full detail in PAGES.md)

`/`, `/shop`, `/category/:id`, `/search`, `/product/:id`,
`/about`, `/support`,
`/cart`, `/wishlist`, `/login`, `/register`,
`/account`, `/account/profile`, `/account/addresses`, `/account/orders`,
`/account/orders/:id`, `/account/reviews`,
`/checkout`, `/order-confirmation/:id`, `*` (404).

Product URLs use the backend UUID (`:id`). The backend exposes human-readable
`slug` fields for products/categories but all read routes address resources
by UUID — the frontend MUST call APIs with UUIDs and treat slugs as display
metadata only.

## 5. Product discovery

- Home shows: company-first hero (brand statement + About Us CTA → `/about`),
  category discovery with icons, Popular Products rail, New Arrivals rail,
  Maximum Discounted Products rail, category rails, promo banners, trust
  strip (COD / warranty / support as static claims). The 8 seeded backend
  categories are `power-banks`, `chargers`, `cables`, `wireless-earbuds`,
  `bluetooth-speakers`, `car-accessories`, `smart-accessories`,
  `desk-accessories` — always sourced from `GET /categories`, never
  hardcoded; each tile pairs the API name with a frontend Lucide icon mapped
  by category slug (with a generic fallback icon for unknown slugs).
- Home merchandising derivation (client-side over the `GET /products`
  cache — the backend exposes no popularity/newest/discount endpoints):
  - **New Arrivals**: sort by `createdAt` descending (field verified present
    in product reads), take N. Label "New Arrivals".
  - **Maximum Discounted Products**: for each product take its best variant
    discount `% = (compareAtPrice − price) / compareAtPrice` (both verified
    present as decimal strings; skip variants without `compareAtPrice`),
    sort descending, take N. Label with the computed `% off`.
  - **Popular Products**: the backend exposes NO popularity signal (no
    sales/views/orders-count endpoint). Do NOT fabricate popularity. The rail
    is sourced from the only supported merchandising flag, `isFeatured`,
    and MUST be labeled accordingly (e.g. "Featured" / "Handpicked by Tech
    Pulse"), never "Most Popular" or with fake rank badges. A real
    popularity sort is a future backend enhancement (see §22 /
    BACKEND_REQUIREMENTS_GAP.md).
- Shop page: full catalog with client-side faceting.
- Category page: header (name, description, image) + product grid for that
  `categoryId`.
- Backend constraint: `GET /products` and `GET /categories` return **bare
  arrays** of active records only, with **no documented pagination, filtering,
  or sorting query parameters**. All filtering/sorting/pagination on the
  storefront is therefore **client-side** until the backend adds query support
  (marked as a future backend change; see §11).

## 6. Search

- No backend search endpoint exists. Search is implemented client-side:
  fetch `GET /products` (+ `GET /categories` for category names) once per
  session, match against `name`, `brand`, `shortDescription`, `description`,
  variant `name`/`sku`, and category name.
- `/search?q=...` route with debounced input (≈250ms), result grid, result
  count, "no results" empty state with suggestions (popular categories,
  featured products).
- Must handle the empty-catalog case and the fetch-failure case distinctly.

## 7. Product detail

- Gallery (primary image first by `sortOrder`/`isPrimary`), thumbnails,
  badges (discount % derived from `price` vs `compareAtPrice`), pricing block
  (INR formatting, `compareAtPrice` strikethrough when present), variant
  selector (variant `name`, price per variant), quantity stepper, Add to Cart,
  Buy Now (add + go to checkout), wishlist toggle, trust/assurance list
  (COD, shipping, warranty — static), description/specs tabs, related products
  (same `categoryId`, client-side).
- Variant is the purchasable unit: cart operations require `variantId`.
- No stock quantities are displayed (no public inventory API). Availability
  messaging: "Availability confirmed at checkout" + graceful `409`
  `INSUFFICIENT_STOCK` handling on add/checkout.
- No public reviews section with other customers' reviews (no endpoint).
  A signed-in user may see their own review for that product (via
  `GET /reviews/me` filtered client-side by `productId`) with edit affordance.

## 8. Cart

- Server-side authenticated cart, lazy-created on first `GET /cart`.
- Semantics (must be implemented exactly):
  - Add (`POST /cart/items` `{variantId, quantity}`) **increments** an
    existing line (one row per variant).
  - Update (`PATCH /cart/items/:itemId` `{quantity}`) sets the **absolute**
    quantity.
  - Remove (`DELETE /cart/items/:itemId`); repeating returns `404` — treat
    as already-removed (idempotent UI).
  - No clear-all endpoint: "Clear cart" iterates per-line deletes.
  - Emptied cart persists as an empty cart (not deleted).
- Render ONLY server-returned `unitPrice`, `lineTotal`, `subtotal`,
  `totalQuantity`, `itemCount`. Never compute checkout amounts client-side;
  never send price fields (strict Zod rejects them with `422`).
- Stock is advisory until checkout: adding beyond availability returns `409`;
  cart never reserves inventory.

## 9. Wishlist

- Product-level only (no variants, no quantities).
- `GET /wishlist`, `POST /wishlist/items` `{productId}`, `DELETE` by item id.
- Duplicate add → `409 WISHLIST_ITEM_EXISTS`: treat as success ("already
  saved"), do not duplicate.
- Inactive product add → `422`: message "no longer available".
- Heart toggle on cards/detail; wishlist page grid with move-to-cart (adds
  default/first active variant, then optionally removes wishlist line).

## 10. Authentication

- Register: email (normalized: trim + lowercase client-side too), password
  8–128 chars, optional firstName/lastName/phone. `201` → auto-login
  (immediately call login) — backend register returns `data.user` (no token
  documented), so the client must `POST /auth/login` after register.
- Login: `200` returns `data.accessToken` (+ sets `HttpOnly refresh_token`
  cookie). Store access token **in memory** (Zustand store, not localStorage).
- Refresh: `POST /auth/refresh` with credentials (cookies) and no body;
  rotates cookie, returns new access token. Single-flight refresh + retry-once
  on `401`.
- Logout: `POST /auth/logout` clears cookie + clears in-memory token and
  user/cart/wishlist state.
- `GET /auth/me` (or `GET /users/me`) bootstraps session on app load when a
  token exists.
- Inactive account (`403 AUTH_ACCOUNT_INACTIVE`): "Account disabled — contact
  support."
- Protected routes (`/cart`, `/wishlist`, `/account*`, `/checkout`) redirect
  to `/login?redirect=<path>` when unauthenticated.

## 11. Account, profile, addresses

- Account dashboard: links + summaries (orders count, wishlist count,
  default address, profile initials).
- Profile (`GET/PATCH /users/me`): firstName, lastName, phone (nullable;
  non-empty body required — disable save when untouched; empty object yields
  `422`).
- Address book: list, add, edit, delete, set-default (`isDefault`). Fields:
  `fullName`, `phone`, `addressLine1`, `addressLine2?`, `city`, `state`,
  `postalCode`, `country`, `label?`, `isDefault?`. Checkout requires at least
  one address; empty-address state deep-links to address creation.

## 12. Checkout

- Steps: 1) Shipping address select (or create inline), 2) Billing address
  (same-as-shipping default; optional second address), 3) Review cart +
  COD summary, 4) Place order.
- Request: `POST /orders` with ONLY `{shippingAddressId, billingAddressId?}`
  (UUIDs of own addresses). Any price/total/status/coupon field is rejected.
- COD is implicit: the server creates a `CASH_ON_DELIVERY` / `PENDING`
  payment (`INR`, amount = grand total). There is no payment-method picker
  with alternatives — show "Cash on Delivery" as the fixed method with an
  explanatory note.
- Success (`201`): clear local cart state (server clears cart atomically),
  navigate to `/order-confirmation/:id` showing `orderNumber`.
- Failure: `409 ORDER_INSUFFICIENT_STOCK` → highlight affected lines, refresh
  cart; `422 ORDER_EMPTY_CART` → redirect to cart; `404
  ORDER_ADDRESS_NOT_FOUND` → re-pick address.

## 13. COD payment

- Display-only on the storefront: method badge "Cash on Delivery", status
  from order snapshot (`payments[]`), amount = order grand total.
- No payment actions exist (no pay-now, retry, refund, or method change).

## 14. Orders

- History (`GET /orders`, newest first): order number, date, status, total,
  item thumbnails (resolved from snapshot data only), "View details".
- Detail (`GET /orders/:id`): status timeline (display-only; statuses
  `PENDING/CONFIRMED/PROCESSING/SHIPPED/DELIVERED/CANCELLED` exist in the data
  model but the customer cannot mutate them), item snapshots (`productName`,
  `variantName`, `sku`, `unitPrice`, `discount`, `quantity`, `lineTotal`),
  immutable address snapshots (`SHIPPING` + optional `BILLING`), payment
  snapshot, totals. Render snapshots — never live catalog data.
- No cancellation UI (no endpoint). Status-support copy must not promise
  cancellation.
- Other users' ids return `404` — handle as "order not found".

## 15. Reviews

- Creation requires an `orderItemId` from the caller's OWN order
  (`items[].id` from `GET /orders/:id`); product is derived server-side —
  never send `productId`. Rating integer 1–5 required; title 1–255;
  comment 1–5000; text fields optional/nullable.
- One review per order item and per user/product — `409` on repeats.
- "Write a review" entry points live on order-detail lines (per order item)
  and on the account reviews page (unreviewed purchased items).
- Manage own reviews: list (`GET /reviews/me`, newest first), edit
  (rating/title/comment subset), hard-delete. Others' ids → `404`.
- No public product-page review aggregation (no endpoint); do not design
  star-distribution widgets fed by other users' data.

## 16. Media / product images

- Public reads: `GET /products/:productId/images` (list, bare array),
  `GET /products/:productId/images/:imageId`. Fields: `filename`,
  `storagePath` reference, `imageType: "webp"`, `altText`, `sortOrder`,
  `isPrimary`.
- **Known backend limitation**: the API exposes image metadata but no static
  file-serving route, so `storagePath` cannot be hotlinked directly.
  Image delivery is a deployment concern (see §18 / API_INTEGRATION.md).
  Until resolved, the frontend renders images via the configured
  `VITE_MEDIA_BASE_URL` prefix + `storagePath` and falls back to a
  placeholder on load failure. Do not present this as a working-backend
  feature — it requires deployment/backend coordination.
- Upload/update/delete are admin-only; no customer upload UI.

## 17. Responsive requirements

- Breakpoints follow Tailwind defaults (`sm/md/lg/xl/2xl`); content max
  width `max-w-7xl` with `px-4 sm:px-6 lg:px-8` gutters.
- Mobile (<768px): drawer nav, single-column product grids (2-col compact
  cards on small phones for rails), stacked product-detail layout
  (gallery → info → tabs), sticky add-to-cart bar, checkout as vertical
  stepper, tables collapse to stacked cards (orders, cart lines).
- Desktop (≥1024px): full header + category row, 4-col grids, two-column
  product detail (gallery | info), multi-column footer, hover states.
- Touch: ≥44px targets, swipeable carousels (Embla), no hover-dependent
  actions (wishlist/cart buttons always visible).

## 18. Loading / empty / error states

- **Loading**: skeleton loaders for cards, grids, detail, cart lines, order
  rows; button spinners + disabled state during mutations; route-level
  suspense fallback. Never blank-screen on slow catalog fetch.
- **Empty**: search-no-results, empty category, empty cart (CTA: continue
  shopping), empty wishlist, no orders, no addresses, no reviews — each with
  illustration (Lucide icon, no stock imagery), message, and primary CTA.
- **Error**: per-section error cards with retry; global toast (Sonner) for
  mutation failures mapped from API error codes; 401 → silent-refresh-then-
  login; 404 → not-found page; 500 → generic message with timestamp + path
  for support; offline detection banner.

## 19. Accessibility expectations

- Semantic landmarks (`header/main/nav/footer`, headings in order), skip link.
- All interactive elements keyboard-reachable with visible focus rings;
  drawer/modal focus trap + Esc close; form labels + `aria-describedby` for
  field errors from `details[]`.
- Color contrast AA in BOTH light and dark themes; never color-only status (icons + text for badges,
  stock, order status). Theme toggle itself is labeled (`aria-label`/`aria-pressed`) and keyboard reachable.
- `altText` from image metadata (fallback: product name); decorative images
  `alt=""`.
- Live regions for cart count, toast notifications, and async result counts.
- Reduced-motion respect (`prefers-reduced-motion`) for carousels/transitions.

## 20. Future backend changes (genuinely required, not assumed)

1. Static serving (or CDN base) for `storagePath` image delivery.
2. Catalog query support (pagination, category filter, text search, sort) to
   replace full-catalog client-side filtering at scale.
3. Public product-review listing + rating aggregates.
4. Customer order cancellation endpoint (if business approves).
5. Coupon HTTP surface + checkout integration (currently internal-only).
6. Online payment providers + webhooks (currently COD-only by design).
7. Company/support information model + public GET API (see §22.2).
8. Notifications API for authenticated users (see §22.3).
9. Popularity signal for a true "Popular Products" sort (see §22.4).

## 21. Theme requirements (dark + light mode)

- The storefront supports light mode and dark mode with a theme toggle in
  the global UI (desktop header + mobile-reachable placement).
- Theme preference persists across page reloads (`localStorage`, first-visit
  default from `prefers-color-scheme`); avoid flashes of the wrong theme
  during initial load where practical (pre-paint bootstrap).
- CSS-first architecture: all major visual colors are semantic tokens defined
  centrally in `frontend/src/index.css` using Tailwind CSS v4 theme variables
  (`@theme`/`@theme inline` + `@custom-variant dark`), with light values on
  `:root` and dark values on `.dark`. Existing `@tailwindcss/vite`
  integration is retained; no Tailwind v3, no `tailwind.config.js`, no
  obsolete `@tailwind` directives.
- Token layers per DESIGN_SYSTEM.md §3: foundation tokens (fonts, sizes,
  spacing, radii, shadows, motion), semantic color tokens (background,
  foreground, surfaces, borders, primary, secondary, accent, states, card,
  input, ring), theme tokens (light + dark values). The global brand colors
  change in one place and propagate to buttons, links, active states, badges,
  accents, focus rings, and all token consumers.
- Components consume semantic utilities (`bg-background`, `text-foreground`,
  `border-border`, `bg-primary`, `ring-ring`, …) in BOTH modes. No raw
  palette literals (`#ffffff`, `#000000`, arbitrary grays/brand colors) in
  JSX except genuine one-offs with a justifying comment.
- Dark mode is deliberately designed (elevated surfaces, border-led depth,
  re-verified price/badge/status contrast), not an inversion.
- Typography follows the controlled scale in DESIGN_SYSTEM.md §14 — no
  random font sizes in components.

> Global theme colors must be controlled primarily from
> `frontend/src/index.css`. Do not hardcode the application's primary visual
> palette throughout component JSX.

## 22. Manager requirements (verified against backend)

### 22.1 About Us (`/about`, PUBLIC)

- Company introduction, brand story, mission/value proposition, ecommerce
  trust sections (COD promise, support pointers), polished visual presentation.
- No factual company claims are invented: all copy ships as clearly editable
  Tech Pulse placeholders/content-config until real company information is
  provided. Static frontend content — no backend dependency.

### 22.2 Support / Contact (`/support`, PUBLIC)

- Customer support, product/order queries, sales-order inquiries, physical
  company address, contact information, embedded Google Map.
- The manager requires company/support information to be stored in MySQL via
  the Node backend. Verified: NO such model or API exists (modules are auth,
  users, addresses, categories, products, inventory, media, cart, wishlist,
  orders, payments, reviews, coupons — no company/settings/contact module).
- Until the backend lands (see BACKEND_REQUIREMENTS_GAP.md §1), the page
  renders clearly-marked placeholder address/contact content from frontend
  config (never presented as database-backed), plus a static map embed slot.
  Do NOT hardcode the eventual database-backed content as if it were live —
  the page architecture must swap config → API without redesign.

### 22.3 Notifications (authenticated header icon)

- Verified: NO notification backend exists (no module, no table, no
  endpoint). The header renders the bell entry point with an honest empty
  state ("No notifications yet — this section lights up when order updates
  arrive") and the UI architecture (a `notifications.service.js` +
  `useNotificationsStore` seam) allows later connection. No fabricated
  notification data, ever.

### 22.4 Merchandising signals

- New Arrivals and Maximum Discounted Products derive client-side per §5
  (verified fields: `createdAt`, variant `price`/`compareAtPrice`).
- Popular Products has no backend signal; `isFeatured` merchandising is used
  with honest labeling. See BACKEND_REQUIREMENTS_GAP.md §4 for the
  production-scale enhancement.

### 22.5 Master-data mappings (no duplicate tables)

- ProductMaster → existing `Product` + `ProductVariant` models; CategoryMaster
  → existing `Category`; ProductImageMaster → existing `ProductImage`. Full
  field mappings live in API_INTEGRATION.md §16. No duplicate tables are
  created; genuinely missing concepts (creator/modifier identity,
  discount-spec text) are recorded as gaps, not re-modeled in the frontend.

### 22.6 Admin panel (future, separate)

- The storefront consumes only customer APIs and never calls admin writes.
  The future Admin Panel can already consume the existing ADMIN-protected
  category/product/variant/inventory/media endpoints; missing pieces (company
  info management, notification management, creator/modifier audit display)
  are listed in BACKEND_REQUIREMENTS_GAP.md. No admin UI is built in this phase.

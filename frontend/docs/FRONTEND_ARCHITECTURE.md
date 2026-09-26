# Tech Pulse — Frontend Architecture (FRONTEND_ARCHITECTURE)

Compatible with the existing setup: React 19 + Vite 8 + Tailwind CSS v4
(`@tailwindcss/vite`), `react-router-dom` v7, Zustand v5, `react-hook-form`
v7, Zod v4, `lucide-react`, `sonner`, `framer-motion`, `embla-carousel-react`.
Path alias `@` → `./src`. Dev server port `3000` (see §9 for the backend
port conflict note).

Backend contract sources: `backend/docs/API.md`,
`backend/docs/API_CONTRACT_MATRIX.md`, `backend/docs/FRONTEND_INTEGRATION.md`,
`backend/docs/SECURITY.md`, `backend/docs/DATABASE.md`.

---

## 1. Folder structure

```text
frontend/
  docs/                          # specification layer (this folder; no runtime code)
    FRONTEND_SPEC.md
    FRONTEND_ARCHITECTURE.md     # this file
    API_INTEGRATION.md
    PAGES.md
    DESIGN_SYSTEM.md
    DESIGN_REFERENCE.md
    IMPLEMENTATION_CHECKLIST.md
    BACKEND_REQUIREMENTS_GAP.md  # verified backend gaps vs manager requirements
  public/
    favicon.svg
  src/
    main.jsx                     # StrictMode + router + providers + Toaster
    App.jsx                      # route tree only (no business logic)
    index.css                    # `@import "tailwindcss";` + @theme tokens
    config/
      env.js                     # validated VITE_* env access
    lib/
      apiClient.js               # fetch wrapper: baseURL, bearer, refresh, errors
      format.js                  # INR money, dates, discount %, order numbers
      query.js                   # tiny fetch-state helper (or per-store status)
    services/                    # one module per backend domain (thin wrappers)
      auth.service.js
      users.service.js
      addresses.service.js
      categories.service.js
      products.service.js
      media.service.js
      cart.service.js
      wishlist.service.js
      orders.service.js
      reviews.service.js
      companyInfo.service.js       # FUTURE SEAM: no backend yet (GAP-01); config fallback
      notifications.service.js     # FUTURE SEAM: no backend yet (GAP-02); empty-state only
    schemas/                     # Zod client-side form schemas (mirror backend limits)
      auth.schema.js
      address.schema.js
      review.schema.js
    stores/                      # Zustand
      useAuthStore.js            # token (memory only) + user + session actions
      useThemeStore.js           # theme (light/dark), persisted `tp-theme`
      useCartStore.js            # server cart mirror
      useWishlistStore.js        # server wishlist mirror
      useCatalogStore.js         # categories/products cache (client-side search index)
      useCheckoutStore.js        # ephemeral checkout UI state (not persisted)
      useNotificationsStore.js   # FUTURE SEAM: empty until notifications API lands
    hooks/
      useRequireAuth.js          # route guard helper
      useCatalogSearch.js        # client-side search over cached catalog
    components/
      layout/
        AnnouncementBar.jsx
        Header.jsx                 # Category|New Arrivals|About Us|Support + Search|Cart|Login (+Wishlist|Notification authed) + ThemeToggle
        CategoryNav.jsx
        MobileDrawer.jsx           # uncrowded: 5 top-level entries + account + theme row
        Footer.jsx
        Layout.jsx               # header + outlet + footer + offline banner
        ThemeToggle.jsx            # sun/moon, aria-pressed, token styled
        WhatsAppFloat.jsx          # fixed floating action, VITE_WHATSAPP_LINK
        NotificationBell.jsx       # FUTURE SEAM: entry point + empty state only
      catalog/
        ProductCard.jsx
        ProductGrid.jsx
        CategoryTile.jsx           # API name + Lucide icon by slug (+fallback)
        VariantSelector.jsx
        PriceBlock.jsx
        RatingStars.jsx          # renders only OWN review / static display; no aggregates
      cart/
        CartLine.jsx
        CartSummary.jsx
      checkout/
        AddressPicker.jsx
        OrderSummary.jsx
      reviews/
        ReviewForm.jsx
        ReviewCard.jsx
      ui/
        Button.jsx
        Input.jsx
        Select.jsx
        Badge.jsx
        Modal.jsx
        Drawer.jsx
        Skeleton.jsx
        EmptyState.jsx
        ErrorState.jsx
        Pagination.jsx           # client-side pagination over cached arrays
    pages/
      HomePage.jsx               # company-first hero + 3 merchandising rails
      AboutPage.jsx              # /about, static editable placeholders
      SupportPage.jsx            # /support, config-driven until company-info API lands
      ShopPage.jsx
      CategoryPage.jsx
      SearchPage.jsx
      ProductDetailPage.jsx
      CartPage.jsx
      WishlistPage.jsx
      LoginPage.jsx
      RegisterPage.jsx
      AccountDashboardPage.jsx
      ProfilePage.jsx
      AddressesPage.jsx
      OrdersPage.jsx
      OrderDetailPage.jsx
      ReviewsPage.jsx            # "My reviews" (GET /reviews/me)
      CheckoutPage.jsx
      OrderConfirmationPage.jsx
      NotFoundPage.jsx
    routes/
      ProtectedRoute.jsx         # auth gate + redirect preservation
```

Rules:

- `pages/` own data-fetching orchestration; `components/` are presentational
  + emit callbacks. No API calls inside `components/ui/`.
- `services/` contain no React state; `stores/` contain no fetch construction
  (they call services).
- No admin screens in this storefront. Admin-only backend writes
  (catalog/inventory/media) are never called.

## 2. Page / component boundaries

| Boundary | Responsibility |
|----------|---------------|
| Page | Route params, auth gate, parallel data loads, loading/empty/error states, SEO-ish titles |
| Layout components | Chrome (header/nav/footer), cart/wishlist badges from stores |
| Catalog components | Pure rendering of product/category payloads; wishlist/cart actions via props |
| Cart/checkout components | Render server snapshots; mutations via cart/orders services + store sync |
| UI primitives | Design-system tokens only; no domain knowledge |

Shared rules: product cards identical on Home/Shop/Category/Search/Wishlist;
price rendering only through `PriceBlock` (decimal-string safe); images only
through a `ProductImage` component that applies the media-base prefix and
placeholder fallback (see API_INTEGRATION § media).

## 3. Routing architecture

- `react-router-dom` v7 browser router defined in `App.jsx`.
- Public: `/`, `/shop`, `/category/:id`, `/search`, `/product/:id`,
  `/about`, `/support`,
  `/login`, `/register`, `/order-confirmation/:id` (order id required but page
  handles direct access by fetching `GET /orders/:id`; unauthenticated direct
  access redirects to login with redirect-back), `*`.
- Protected (`<ProtectedRoute>`): `/cart`, `/wishlist`, `/account`,
  `/account/profile`, `/account/addresses`, `/account/orders`,
  `/account/orders/:id`, `/account/reviews`, `/checkout`.
- Guard behavior: unauthenticated → `/login?redirect=<encoded path>`; after
  login/register, return to `redirect` (validate it is an internal path).
- Scroll-to-top on route change; document titles per page (PAGES.md).

## 4. API / service architecture

- Single `apiClient` (`lib/apiClient.js`):
  - `baseURL = env.VITE_API_URL` (must include `/api/v1`).
  - JSON by default; `Content-Type: application/json` on writes.
  - `credentials: "include"` on `auth/refresh` and `auth/logout` (cookie flow).
  - Bearer injection from `useAuthStore` memory token on every request.
  - Response unwrap: `{success, data, meta?}` → return `data`; on
    `{success:false}` throw typed `ApiError {status, code, message, details}`.
  - `401` handling: single-flight refresh → retry original once → else
    clear session + redirect to login. Never loop.
  - Strict-body discipline: services send ONLY documented fields (backend
    Zod rejects unknown fields with `422`).
- `services/*.service.js`: one function per endpoint (see API_INTEGRATION.md
  for the full contract table). No Zustand imports inside services.
- Money: treat all money as **strings**; format for display only
  (`Intl.NumberFormat("en-IN", {style:"currency", currency:"INR"})` on
  `Number()` of the string — display only, never arithmetic for checkout).
- UUIDs: always taken from previous API responses; never generated client-side.

## 5. Authentication architecture

- `useAuthStore`: `{ accessToken, user, status, login(), registerThenLogin(),
  logout(), refresh(), bootstrap() }`.
- Token lives in memory only (Zustand, no persistence plugin, nothing in
  localStorage/sessionStorage) per backend recommendation.
- `bootstrap()`: one coordinated silent refresh (shared single-flight with
  concurrent 401s — exactly one `/auth/refresh` per page load), then
  `GET /auth/me`. Definitive rejection (`401`/`403` + `AUTH_*`) settles
  anonymous; transient failure (`429`/`5xx`/network) settles `error` —
  recoverable via retry, never a false logout, never a cookie destroy.
  Cart/wishlist bootstrap after auth.
- `useRequireAuth` / `<ProtectedRoute>` read store status; show a loading
  gate (not a login flash) while `status === "loading"`, a retry panel
  while `status === "error"`, and redirect to login only when settled
  anonymous.
- Roles: backend always assigns `CUSTOMER` on self-register; the storefront
  gates admin UI by absence (no admin screens). Never trust or send roles.

## 6. Zustand usage

- Stores: `useAuthStore`, `useCartStore`, `useWishlistStore`,
  `useCatalogStore`, `useCheckoutStore` (ephemeral; reset on order success).
- Server state mirrors (`cart`, `wishlist`, `catalog`) store:
  `{ data, status: idle|loading|success|error, error }` + actions.
  Mutations update the mirror FROM the server response (backend returns the
  full updated cart/wishlist), not from local math.
- Catalog cache: `GET /categories` + `GET /products` fetched once per session
  (stale-while-revalidate on focus is optional); search/filter/sort derive
  from cache via selectors — no per-keystroke fetching.
- No global persistence middleware in v1 (tokens must not persist; cart and
  wishlist are server-side anyway). If persistence is added later, allowlist
  only non-sensitive UI prefs (never tokens).

## 7. Local state vs server/API state

| State | Where |
|-------|-------|
| Access token, user | `useAuthStore` (memory) |
| Cart lines, totals | Server → `useCartStore` mirror |
| Wishlist items | Server → `useWishlistStore` mirror |
| Categories/products catalog + search index | Server → `useCatalogStore` cache; derived client-side |
| Orders, reviews | Fetched per page (no global mirror except maybe `reviews/me` cache) |
| Checkout step, selected address ids, billing-same flag | `useCheckoutStore` (ephemeral) |
| Form values, drawer/modal open, tabs, carousel index | Component local state / react-hook-form |
| Toasts | Sonner (imperative) |

Rule: anything the backend recomputes (prices, totals, stock, order status)
is rendered from the last server response. Client math is display-only.

## 8. Reusable component rules

- Build from `components/ui/` primitives; no raw `<button>`/`<input>` with
  ad-hoc classes in pages.
- `ProductCard` is the single card implementation everywhere (props:
  `product`, `showWishlist=true`, `onAdd`).
- `PriceBlock` props: `{price, compareAtPrice}` as strings; computes
  discount % for the badge.
- `EmptyState {icon, title, message, action}` and `ErrorState {message, onRetry}`
  used by every page (PAGES.md defines copy per page).
- `Skeleton` variants: `card`, `grid`, `detail`, `line`, `row`.

## 9. Environment configuration

```text
VITE_API_URL=http://localhost:3000/api/v1   # must include /api/v1
VITE_MEDIA_BASE_URL=http://localhost:3000   # prefix for storagePath until CDN/static serving lands
VITE_APP_NAME=Tech Pulse
VITE_WHATSAPP_LINK=https://wa.me/910000000000   # PLACEHOLDER until real number provided
VITE_GOOGLE_MAPS_EMBED_URL=                              # empty until Maps embed configured
VITE_SUPPORT_EMAIL=support@example.com                   # PLACEHOLDER
```

- Accessed only via `src/config/env.js` with startup validation (fail fast
  with a readable error screen if `VITE_API_URL` is missing).
- NOTE: `vite.config.js` currently serves the dev server on port `3000`,
  which collides with the backend's default `PORT=3000`. Run the backend on a
  different port (e.g. `3001`) and set `VITE_API_URL` accordingly, or change
  the Vite port. Document the chosen ports in the implementation PR; do not
  commit secrets (`.env` never committed).
- CORS: backend `CORS_ORIGIN` must allowlist the frontend origin with
  credentials; `Secure`/`SameSite` cookie settings must align in production.

## 10. Error handling

- `ApiError { status, code, message, details[] }` from `apiClient`.
- Field errors: map Zod `details[]` (`{path, message}`) onto
  react-hook-form fields; strip unknown fields from payloads.
- Code map (subset): `AUTH_EMAIL_ALREADY_EXISTS` → email field;
  `AUTH_INVALID_CREDENTIALS` → form-level; `AUTH_ACCOUNT_INACTIVE` →
  support message; `WISHLIST_ITEM_EXISTS` → treat as saved;
  `REVIEW_ALREADY_EXISTS` → link to existing review; `INSUFFICIENT_STOCK` /
  `ORDER_INSUFFICIENT_STOCK` → refresh cart + highlight; `404` on owned
  resources → not-found messaging (missing OR another user's — never
  distinguish); `429` → backoff message; `500` → generic + timestamp/path.
- Toasts for mutation outcomes; inline errors for forms; section errors with
  retry for page loads.

## 11. Loading handling

- Route-level `Suspense` fallback + per-section skeletons (never blank page).
- Buttons: `disabled + spinner` during pending mutations; prevent double
  submit (checkout, login, register, review create).
- Catalog-first pages render chrome immediately, grid skeletons until
  `useCatalogStore` resolves.

## 12. Security rules (frontend side of SECURITY.md)

- Never store tokens in localStorage/sessionStorage; never log tokens,
  passwords, cookies, or auth headers.
- Never send or accept server-controlled fields (`userId`, prices, totals,
  statuses, stock counters, roles, verification flags).
- Render only API-safe user shape (`id, email, firstName, lastName, phone,
  isActive, roles[], createdAt, updatedAt`) — no password hashes ever arrive;
  never invent client-side role elevation.
- Checkout sends address ids only; totals come back from the server.
- `multipart/form-data` upload code paths are not included (admin-only).
- Respect rate limiting (especially auth): disable resubmit, back off on `429`.

## 13. Manager-requirement seams

- `useThemeStore`: `light | dark` (default `prefers-color-scheme`), persisted
  `tp-theme`; pre-paint class bootstrap. Only theme state may use
  persistence middleware — never tokens.
- Merchandising selectors in `useCatalogStore`: `selectNewArrivals(n)` (by
  `createdAt` desc), `selectMaxDiscounted(n)` (best variant `% off` desc),
  `selectFeatured(n)` (by `isFeatured`, honestly labeled). No popularity
  selector exists until a backend signal does.
- `CategoryTile` icon map: slug → Lucide icon (`power-banks`, `chargers`,
  `cables`, `wireless-earbuds`, `bluetooth-speakers`, `car-accessories`,
  `smart-accessories`, `desk-accessories`) + generic fallback; categories
  themselves always come from `GET /categories`.
- Future seams (`companyInfo`, `notifications` services/stores/components)
  ship as typed stubs with config/empty-state behavior so the real APIs plug
  in without redesign. Master-data mappings (ProductMaster/CategoryMaster/
  ProductImageMaster → existing Prisma models) are specified in
  API_INTEGRATION.md §16; the storefront never re-models them.

- Never store tokens in localStorage/sessionStorage; never log tokens,
  passwords, cookies, or auth headers.
- Never send or accept server-controlled fields (`userId`, prices, totals,
  statuses, stock counters, roles, verification flags).
- Render only API-safe user shape (`id, email, firstName, lastName, phone,
  isActive, roles[], createdAt, updatedAt`) — no password hashes ever arrive;
  never invent client-side role elevation.
- Checkout sends address ids only; totals come back from the server.
- `multipart/form-data` upload code paths are not included (admin-only).
- Respect rate limiting (especially auth): disable resubmit, back off on `429`.

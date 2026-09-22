# Tech Pulse — Implementation Checklist (IMPLEMENTATION_CHECKLIST)

Phased, backend-honest checklist. Do not check an item until its verification
(runnable command, visual check, or API trace) passes. Backend contract:
`/api/v1`, strict bodies, server-authoritative prices/totals/stock.

## Foundation

- [ ] `VITE_API_URL` (+ `/api/v1`), `VITE_MEDIA_BASE_URL`, `VITE_APP_NAME`
  configured via `src/config/env.js` with fail-fast validation
- [ ] Backend/frontend port plan recorded (Vite defaults to `3000`, same as
  backend default — run one on another port; `CORS_ORIGIN` allowlists frontend)
- [ ] `lib/apiClient.js`: baseURL, JSON headers, bearer injection,
  `credentials: "include"` on refresh/logout, envelope unwrap, typed `ApiError`
- [ ] Single-flight 401 → refresh → retry-once → login-redirect flow
- [ ] `lib/format.js` (INR `en-IN`, dates, discount %) — display-only, no
  checkout arithmetic
- [ ] Zod client schemas mirror backend limits (auth, address, review)
- [ ] Sonner `Toaster` mounted; error-code → message map from API_INTEGRATION §14
- [ ] Offline banner + route-level `Suspense` fallback
- [ ] `index.css` `@theme` tokens (colors, radius, shadows, fonts) per DESIGN_SYSTEM
- [ ] Semantic color tokens defined centrally in `frontend/src/index.css`
  (background/foreground, surfaces, borders, primary, secondary, accent,
  states, card, input, ring) with light (`:root`) + dark (`.dark`) values
- [ ] Tailwind v4 theme variables configured (`@theme inline`,
  `@custom-variant dark`); no Tailwind v3, no `tailwind.config.js`
- [ ] Primary brand color centralized — one edit propagates to buttons,
  links, active states, badges, accents, focus rings

## Theme (dark + light)

- [ ] Light theme implemented
- [ ] Dark theme implemented
- [ ] Theme toggle implemented
- [ ] Theme preference persisted
- [ ] No incorrect theme flash where practical
- [ ] Semantic CSS color tokens defined
- [ ] Tailwind v4 theme variables configured
- [ ] Primary brand color centralized
- [ ] Component colors use semantic tokens
- [ ] Both themes checked for contrast
- [ ] Mobile theme toggle behavior verified

## Layout

- [ ] `Layout` (announcement bar + header + category row + outlet + footer)
- [ ] Header: logo, search entry, account/wishlist/cart badges (`aria-live` counts)
- [ ] Desktop category nav from `GET /categories` hierarchy
- [ ] Mobile drawer (accordion, focus trap, Esc, scroll lock)
- [ ] Footer (shop/help/static contact; cash-only honesty, no fake payment icons)
- [ ] Breadcrumbs component; skip link; landmarks

## Home

- [ ] Company-first hero (brand statement + About Us CTA → `/about`, Shop CTA)
- [ ] Tech Pulse logo everywhere; logo → Home
- [ ] Category discovery with slug-mapped Lucide icons (+ fallback)
- [ ] Popular/Featured rail (`isFeatured`, honestly labeled — no fake popularity)
- [ ] New Arrivals rail (`createdAt` desc) with view-all (`/shop?sort=newest`)
- [ ] Maximum Discounted rail (best variant `% off` desc)
- [ ] Hero carousel (Embla, reduced-motion safe) from featured products + static config
- [ ] Popular-category tiles from `GET /categories`
- [ ] New-launches rail (`isFeatured`/newest) with view-all
- [ ] Category rails with sub-category chips (client-side filter) + view-all
- [ ] Promo bands (original assets, distinct mobile/desktop) + trust strip
- [ ] Rail/grid skeletons; empty-catalog state; section error retry

## Company pages (About / Support)

- [ ] `/about`: story, mission/values, trust sections — editable placeholders, no invented facts
- [ ] `/support`: contact cards (placeholder), query form (honest submit path), map slot (`VITE_GOOGLE_MAPS_EMBED_URL` + missing-config state), FAQ, WhatsApp CTA
- [ ] Support page swaps config → company-info API without redesign (GAP-01 seam)
- [ ] No company data presented as database-backed before the API exists

## Global UI (nav / theme / WhatsApp / notifications)

- [ ] Desktop menu Category | New Arrivals | About Us | Support; right Search | Cart | Login (+ Wishlist + Notification when authenticated)
- [ ] Mobile drawer uncrowded (5 entries + account + theme row); theme toggle reachable
- [ ] Announcement bar retained
- [ ] Floating WhatsApp action (both viewports + both themes, labeled, `VITE_WHATSAPP_LINK` placeholder, non-obstructive)
- [ ] Notification bell renders entry point + honest empty state; no fabricated data (GAP-02 seam)

## Catalog (Shop / Category)

- [ ] Shop filters (category, brand, price band, discount, featured) — client-side
- [ ] Sort (featured, price ↑↓, discount %, newest) — client-side
- [ ] Client-side pagination preserving layout (no CLS)
- [ ] Category header + sub-category chips + related categories
- [ ] `404 CATEGORY_NOT_FOUND` → NotFound; empty-category state with CTA

## Product detail

- [ ] Gallery (`sortOrder`/`isPrimary`, thumbnails, placeholder fallback via media-base prefix)
- [ ] `PriceBlock` (decimal-string safe, `% off` from `compareAtPrice`)
- [ ] Variant selector + quantity stepper; purchasable unit = variant
- [ ] Add to Cart (increment semantics) + Buy Now (add → checkout)
- [ ] Wishlist toggle (auth-gated with redirect-back)
- [ ] Assurances (COD/shipping static, honestly labeled) + tabs + related rail
- [ ] Own-review hint for signed-in user (no public aggregates)
- [ ] `409`/`422` add-to-cart handling; sticky mobile buy bar

## Search

- [ ] Debounced `/search?q=` over cached catalog (name/brand/desc/variant/category)
- [ ] Result count + grid + suggestions; no-results state with category/featured links
- [ ] Keyboard-navigable suggestions; Esc dismiss; `/` focuses input on desktop

## Authentication

- [ ] Register (normalize email; 8–128 pw) → auto-login → bootstrap → redirect-back
- [ ] Login → token in memory only (never localStorage) → bootstrap me/cart/wishlist
- [ ] Silent refresh on boot; refresh-then-login on 401; logout clears all state
- [ ] `403 AUTH_ACCOUNT_INACTIVE` support message; `429` backoff; double-submit guards
- [ ] `ProtectedRoute` + `useRequireAuth` with loading gate (no login flash)

## Cart

- [ ] `GET /cart` bootstrap (lazy-created); render server totals only
- [ ] Add = increment; update = absolute; remove (404 = already removed)
- [ ] Per-line "clear cart" iteration (no clear-all endpoint)
- [ ] `409 INSUFFICIENT_STOCK` highlight + refresh; empty-cart state + CTA
- [ ] Badge count from `totalQuantity`; reconcile optimistic steppers with responses

## Wishlist

- [ ] Bootstrap + heart toggles everywhere via single `ProductCard`
- [ ] `409 WISHLIST_ITEM_EXISTS` = saved; `422 PRODUCT_INACTIVE` messaging
- [ ] Wishlist page grid + move-to-cart (first active variant)

## Checkout

- [ ] Prereq guards (empty cart → cart; no address → addresses)
- [ ] Shipping picker + inline create; billing same-or-second
- [ ] Review step with server totals; fixed COD method display
- [ ] `POST /orders {shippingAddressId, billingAddressId?}` only — strict body
- [ ] `201` → reset checkout state → `/order-confirmation/:id` (never from local state)
- [ ] `409`/`422`/`404` failure routing per PAGES.md §16; double-submit guard

## Orders

- [ ] History newest-first from snapshots; status badges (icon + text)
- [ ] Detail: snapshot items/addresses/payment/totals; display-only timeline
- [ ] No cancel/mutate UI; `404 ORDER_NOT_FOUND` → not-found
- [ ] Review entry points per unreviewed order item (`items[].id` retained)

## Account

- [ ] Dashboard summaries (orders/wishlist/default address)
- [ ] Profile edit (save disabled when untouched; email read-only)
- [ ] Address CRUD + default badge + delete confirm + empty state

## Reviews

- [ ] Create from own `orderItemId` only (rating 1–5, title ≤255, comment ≤5000)
- [ ] `409 REVIEW_ALREADY_EXISTS` → link existing; `404` on foreign ids
- [ ] My-reviews page: unreviewed discovery + own list with edit/hard-delete
- [ ] No public listing/aggregate widgets anywhere

## Responsive

- [ ] `sm/md/lg/xl` breakpoints; `max-w-7xl` gutters
- [ ] Mobile: drawer, 2-col compact grids, stacked detail, sticky bars, tables → cards
- [ ] Desktop: category row, 4-col grids, 2-col detail, hover states
- [ ] ≥44px touch targets; no hover-only actions; Embla swipe rails

## Accessibility

- [ ] Landmarks, heading order, skip link, focus-visible rings
- [ ] Drawer/modal focus trap + Esc; form `aria-describedby` errors
- [ ] AA contrast; icon+text statuses; alt text from metadata (fallback product name)
- [ ] Live regions (counts, toasts, result counts); `prefers-reduced-motion` respected

## API integration

- [ ] Every call matches API_INTEGRATION methods/paths/bodies; UUIDs from responses
- [ ] Strict bodies (no `userId`/prices/totals/status/role/coupon fields ever sent)
- [ ] Money as strings end-to-end (format display-only)
- [ ] Media via `VITE_MEDIA_BASE_URL` + `storagePath` with fallback; no upload UI
- [ ] "DO NOT INVENT" audit: no stock endpoint, no clear-cart, no online pay,
  no cancel, no public reviews/aggregates, no coupons, no catalog query params,
  no static-serve assumption, no guest checkout, no password-reset, no avatar upload
- [ ] Master-mapping audit: no duplicate ProductMaster/CategoryMaster/
  ProductImageMaster concepts in frontend; MRP = `compareAtPrice`, code = `sku`,
  discount derived; missing audit/discount-spec noted as backend gaps, not re-modeled
- [ ] BACKEND_REQUIREMENTS_GAP.md reviewed: company-info, notifications,
  popularity, and media-delivery gaps have frontend seams, not workarounds

## Error handling

- [ ] Page section errors with retry; form `details[]` mapping; toast outcomes
- [ ] 401/403/404/409/422/429/500 behaviors per API_INTEGRATION §14
- [ ] 404 page for bad routes + resource 404s with catalog suggestions
- [ ] Generic 500 copy with timestamp + path (no internals shown)

## Performance

- [ ] Single-session catalog cache; derived search/filter (no per-keystroke fetch)
- [ ] Skeletons prevent CLS; images lazy + sized; placeholder on image error
- [ ] Mutation responses update mirrors (no redundant refetch storms)
- [ ] Build passes (`vite build`); lint clean

## Final testing

- [ ] Register → login → refresh → logout cycle against local backend
- [ ] Browse → search → detail → cart → wishlist → checkout(COD) → confirmation
- [ ] Orders history/detail render snapshots; review create/edit/delete own only
- [ ] Cross-user ids return 404 UI; validation errors highlight fields
- [ ] Mobile (360px) + desktop (1280px+) pass in BOTH themes; keyboard-only pass; reduced-motion pass
- [ ] No implementation code outside `frontend/docs/` was touched in the spec phase

# Tech Pulse — Design Reference: Portronics Research (DESIGN_REFERENCE)

Research passes: 2026-09-17 (homepage IA + interaction patterns) and a
follow-up fidelity pass for visual density, spacing rhythm, and section
composition. Method: fetched `https://www.portronics.com/` homepage and
reviewed its information architecture and interaction patterns.
No Portronics assets, copy, branding, logos, images, or source code are
reproduced here or in the Tech Pulse implementation — observations below are
structural/pattern-level only.

## 1. URL

- Observed: `https://www.portronics.com/` (homepage). References to
  `/collections/*`, `/products/*`, `/cart`, `/account`, support/warranty
  pages observed via site navigation.

## 2. Observed page structure (reference pattern)

- Top utility strip → main header (logo / search / account / cart) →
  category mega-navigation → hero carousel (desktop + separate mobile
  banners) → "Popular Categories" tile band → "New Launches" product rail
  with "view all" → repeated category sections each with sub-category tab
  chips + product rails → promotional snippet banners → footer.
- **Tech Pulse implementation decision**: adopt the same band order (hero →
  category tiles → new-launch rail → category rails → promos → trust strip)
  with original Tech Pulse creative; category set driven by our backend
  (`GET /categories`), not copied.

## 3. Navigation patterns

- Reference pattern: "Categories" mega-menu with 5 parent groups (Audio,
  Mobile/Computer/Car Accessories, Smart Gadgets), each with many
  sub-collections; plus top-level links (New Arrivals, Corporate Gifting,
  Warranty, Support); mobile drawer + bottom cart/account shortcuts.
- Tech Pulse decision: category nav rendered from backend `parentId`
  hierarchy with the same mega-menu-on-desktop / accordion-drawer-on-mobile
  mechanics; only commerce links that our backend supports (no order tracking
  page, no warranty-registration flow — static help copy only, honestly labeled).

## 4. Product discovery patterns

- Reference pattern: sub-category tab chips filter a category rail
  client-side; "view all" jumps to the collection; discount-led merchandising
  ("X% off" prominent); dense rails (~5 visible desktop, ~2.2 peek mobile).
- Tech Pulse decision: replicate tab-chip rails and view-all routing using
  client-side filtering over `GET /products` (backend has no filter/query
  params); discount badge computed from `price` vs `compareAtPrice`.

## 5. Product card patterns

- Reference pattern: image → spec hook line → product name → 1-line feature
  summary → sale price + struck MRP + `% off` → variant dots → Add-to-cart +
  compare affordances.
- Tech Pulse decision: same anatomy (hook, name, feature line, price row,
  discount badge, variant indicator, add + wishlist) with original styling;
  omit "compare" (no backend/UX requirement) and variant dots become a count
  label when >1 variant.

## 6. Product detail patterns (inferred from card/collection structure)

- Reference pattern: gallery-first PDP with variant selection, discount
  framing, assurance strip, spec content, related products.
- Tech Pulse decision: implement the gallery/info/tabs/related structure per
  DESIGN_SYSTEM §7 and PAGES.md §5, constrained to real backend fields
  (variants, image metadata, snapshots) — no review aggregates, no stock
  counts, no pincode-check API (static honest copy only).

## 7. Promotional section patterns

- Reference pattern: full-bleed snippet banners between rails; separate
  desktop/mobile hero creatives; collection-linked tiles.
- Tech Pulse decision: promo bands as static frontend config with distinct
  desktop/mobile creatives (original assets); link targets restricted to real
  routes (`/shop`, `/category/:id`, `/product/:id`).

## 8. Responsive behavior

- Reference pattern: dedicated mobile banners, drawer nav, 2-up compact
  cards, sticky buy/cart affordances, swipeable rails.
- Tech Pulse decision: same responsive mechanics (Embla rails, drawer,
  sticky mobile CTA bars, 2-col compact grids) per DESIGN_SYSTEM §14/§16.

## 9. Interaction patterns

- Reference pattern: hover zoom on card images, quick add-to-cart from cards,
  cart drawer with free-shipping/prepaid nudges, search overlay with
  suggestions.
- Tech Pulse decision: hover zoom + quick-add (auth-gated: redirect to login
  with redirect-back), cart page (drawer optional enhancement — page is the
  contract), search overlay with client-side suggestions; no prepaid/shipping
  nudges that imply unsupported pricing logic — totals are server-rendered.

## 10. Useful visual characteristics to translate

- High-contrast price rows (bold sale price, muted MRP, tinted % off badge).
- Category tiles with illustrated/animated treatments → original Tech Pulse
  tile iconography (Lucide) instead of copied imagery.
- Generous rail spacing with clear section headers + "view all" links.
- Trust/assurance iconography near CTAs → COD-focused Tech Pulse trust strip.

## 11. What Tech Pulse deliberately does NOT take

- Name, logo, colors-as-brand, product names/descriptions, images, reviews,
  prices, or any copy from Portronics.
- Gifting/warranty-registration/tracking flows (no backend for them).
- Any impersonation of the Portronics brand in domain, title, or metadata.

## 12. Fidelity bar: near-Portronics polish (reference pattern → decision)

The storefront must reach a near-identical LEVEL of polish — not the brand.
Concretely, for every item below the reference pattern is Portronics'
craft bar and the decision is the original Tech Pulse translation:

- **Ecommerce density**: homepage carries ~8–10 stacked merchandised bands
  with tight inter-band rhythm. Decision: same band count and rhythm
  (DESIGN_SYSTEM §4); never a sparse hero-plus-grid template.
- **Section composition**: every rail has a left title (+ optional sub-copy)
  and a right "view all" link; category sections add sub-category tab chips.
  Decision: identical composition grammar with Tech Pulse type scale and
  tokens (DESIGN_SYSTEM §14, §8).
- **Navigation experience**: utility strip → sticky rich header → category
  row/mega-menu → drawer on mobile, with persistent cart affordance.
  Decision: same chrome stack (FRONTEND_SPEC §4); Tech Pulse brand + tokens.
- **Product presentation**: spec-hook line, 2-line name clamp, 1-line feature
  summary, bold sale price + struck MRP + `% off`, variant indicator,
  always-visible wishlist heart, quick add. Decision: same card anatomy (§5),
  original styling; no compare tool.
- **Spacing rhythm**: compact card padding, `4/6` grid gaps, full-bleed promo
  bands breaking the rail cadence. Decision: same rhythm values
  (DESIGN_SYSTEM §4, §15); promo bands as original static config.
- **Responsive behavior**: separate mobile hero treatment, 2-up compact
  cards, swipeable rails with peek, sticky buy bars. Decision: same mechanics
  (§8); both themes verified at 360px and 1280px+.
- **Interaction quality**: hover zoom, quick-add, search suggestions,
  drawer/cart motion, skeleton loading (never blank bands). Decision: same
  quality bar (DESIGN_SYSTEM §17, §20); framer-motion limited to
  drawer/modal/toast mounts.

## 13. Deliberate divergence: dual theme (no reference pattern)

- Reference observation: the Portronics experience is a single light theme;
  there is no dark-mode pattern to copy — and none is copied.
- Tech Pulse implementation decision: light + dark modes designed from the
  token system (DESIGN_SYSTEM §2–§3). Dark mode re-verifies every fidelity
  item above (density, price-row contrast, badge legibility, image-well
  treatment) rather than inverting light values. The theme toggle lives in
  the header icon cluster and the mobile drawer; preference persists in
  `localStorage` (`tp-theme`) with a no-flash bootstrap.

## 14. Anti-template checklist (must ALL hold)

- [ ] Homepage reads as a dense gadget superstore, not hero + generic grid.
- [ ] Category rails use sub-category tab chips, not plain headings.
- [ ] Cards carry hook + feature-summary lines and discount-led price rows.
- [ ] Promo bands interrupt rail cadence; trust strip sits near conversion.
- [ ] Header has utility strip + search + icon cluster + category row.
- [ ] Skeletons mirror real anatomy in both themes; no blank sections.
- [ ] Nothing in the UI copies Portronics branding, copy, or assets.

## 15. Manager-requirement pattern notes (reference → Tech Pulse decision)

- **Announcement bar**: reference pattern is a thin top strip with rotating
  offers. Decision: keep the existing bar (FRONTEND_SPEC §4.1) — same
  placement and rhythm, Tech Pulse messages and tokens.
- **Header structure**: reference pattern is logo / search / account-cart
  cluster plus a category-led menu row. Decision: manager-mandated menu
  (Category | New Arrivals | About Us | Support; Search | Cart | Login, plus
  Wishlist + Notification when authenticated) in the same structural grammar
  (DESIGN_SYSTEM §5).
- **Hero**: reference pattern is a full-width offer carousel with separate
  mobile creatives. Decision: company-first hero (brand statement + About Us
  CTA) executed with the same carousel craft; offer-first carousels remain
  for promo bands. No copied imagery or copy.
- **Category presentation**: reference pattern is illustrated category tiles.
  Decision: icon tiles (Lucide, slug-mapped) for the 8 backend categories —
  same discovery role, original iconography.
- **Product sections**: reference pattern is titled rails with "view all"
  and tab chips. Decision: Popular/Featured, New Arrivals, Maximum
  Discounted rails in that grammar, derived per FRONTEND_SPEC §5.
- **Product cards / detail / cart / footer / responsive / interactions**:
  covered in §5, §6, §9, §8, and §12 — unchanged fidelity bar applies.
- **About / Support pages**: no reference pattern is copied (company pages
  are brand-specific). Decision: original Tech Pulse layouts per
  DESIGN_SYSTEM §22 and PAGES.md §18–§19, with placeholder content.
- **Floating WhatsApp action**: generic ecommerce contact pattern (fixed
  bottom-right, labeled, non-obstructive), not a copied asset. Decision:
  specified in DESIGN_SYSTEM §22 with configurable destination.

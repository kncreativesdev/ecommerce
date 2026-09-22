# Tech Pulse — Design System (DESIGN_SYSTEM)

Original Tech Pulse visual system. The fidelity bar is the current Portronics
ecommerce experience (see DESIGN_REFERENCE.md): near-identical LEVEL of visual
polish, ecommerce density, layout philosophy, navigation experience, product
presentation, spacing rhythm, section composition, responsive behavior, and
interaction quality — implemented as an independent Tech Pulse design. No
Portronics logo, brand identity, imagery, copy, source code, or proprietary
assets are reused. The result must NOT look like a generic ecommerce template.

All color tokens assume Tailwind CSS v4 CSS-first configuration in
`frontend/src/index.css` (existing `@tailwindcss/vite` integration; no
Tailwind v3, no `tailwind.config.js`, no obsolete `@tailwind
base/components/utilities` syntax).

> IMPLEMENTATION RULE: Global theme colors must be controlled primarily from
> `frontend/src/index.css`. Do not hardcode the application's primary visual
> palette throughout component JSX.

---

## 1. Visual direction

- Brand consistency: the product is **TECH PULSE** everywhere — original
  wordmark (system font stack, semibold, tracking-tight) with a Lucide `zap`
  glyph; logo click returns to Home. No derivative of any third-party logo.
- Company-first home: the first screen/hero primarily communicates the
  brand (statement + About Us CTA alongside Shop CTA), followed by dense
  Portronics-level merchandising bands.
- Modern Indian consumer-electronics storefront at Portronics-level density:
  utility strip, rich header, category mega-navigation, hero carousel,
  category tiles, new-launch rail, tabbed category rails, promo bands, trust
  strip — value-first, discount-led, not decoration-first.
- Information density over whitespace on catalog pages (dense rails, compact
  cards); calm, spacious checkout/account flows to build COD trust.
- Dual theme: deliberately-designed light AND dark modes (dark is not an
  inversion — see §3). Theme toggle in global UI, persisted, no flash of the
  wrong theme on load where practical.
- Photography: product-on-light-background cards; lifestyle imagery only in
  hero/promo bands (to be sourced originally, never Portronics assets).

## 2. Theme architecture (light + dark)

- Strategy: class-based theme scoping on `<html>` (`.dark`), wired through
  Tailwind v4 with `@custom-variant dark (&:where(.dark, .dark *));` in
  `frontend/src/index.css`. All components consume semantic utilities
  (`bg-background text-foreground border-border …`); no theme conditionals in
  JSX beyond the single toggle + bootstrap.
- Source of truth: CSS variables defined once in `frontend/src/index.css`
  (`:root` = light values, `.dark` = dark values), exposed to Tailwind via
  `@theme inline`. Changing the brand palette = editing a small variable set
  in that one file; it propagates to buttons, links, active states, badges,
  accents, focus rings, and all token consumers automatically.
- Persistence: `localStorage` key `tp-theme` (`"light" | "dark"`); first visit
  defaults to `prefers-color-scheme`. A `useThemeStore` (Zustand) owns theme
  state; a pre-paint bootstrap (tiny inline script applied at implementation
  time) sets the initial class to avoid flashes of the wrong theme.
- Toggle placement: header icon cluster on desktop (sun/moon Lucide icons,
  `aria-label` + `aria-pressed`), inside the mobile drawer AND visible from
  mobile chrome (see §17). Keyboard reachable, announced via live region.
- Forbidden: raw hex/gray/brand colors scattered in JSX (`#ffffff`, `#000000`,
  arbitrary `slate-*` for themed surfaces), `dark:` variants carrying ad-hoc
  values instead of tokens, or per-component palette forks. One-off raw values
  only with a code comment justifying why the token system cannot express it.

## 3. Design token organization

### 3.1 FOUNDATION TOKENS (theme-invariant)

| Group | Tokens |
|-------|--------|
| Font families | `--font-sans` (system stack, §12), `--font-display` (same stack, tighter tracking) |
| Font sizes | Controlled scale only — `display / h1 / h2 / h3 / body / small / micro` per §12 |
| Spacing | Tailwind default scale; page sections `space-y-8`, card padding `p-4 sm:p-5` |
| Radii | `--radius-sm 0.5rem`, `--radius-md 0.75rem` (inputs), `--radius-lg 1rem` (cards), `--radius-xl 1.25rem` (gallery/hero), `--radius-full` (pills/badges) |
| Shadows | `--shadow-sm` cards rest, `--shadow-lg` hover/popovers, `--shadow-2xl` modals; dark mode favors borders over shadows (see §3.3) |
| Motion | `--duration-fast 150ms`, `--duration-base 200ms`, `--duration-slow 300ms`; `--ease-out`; shimmer keyframes for skeletons |

### 3.2 SEMANTIC COLOR TOKENS (consumed by components)

| Token | Used for |
|-------|----------|
| `background` / `foreground` | Page background / primary text |
| `surface` | Header, cards, drawers, modals |
| `surface-muted` | Search field, image wells, tab strips, table headers |
| `surface-elevated` | Popovers, dropdowns, sticky bars, toasts |
| `border` / `border-muted` | Default borders / hairlines, dividers |
| `primary` / `primary-foreground` | Primary buttons, links, active nav, focus fill accents |
| `secondary` / `secondary-foreground` | Secondary buttons, chips |
| `accent` / `accent-foreground` | Discount badges, count badges, highlights, wishlist-active hearts |
| `muted` / `muted-foreground` | Secondary text, spec hooks, placeholders |
| `success` | In-stock/positive accents, discount tint, delivered status |
| `warning` | Pending-status tint |
| `destructive` / `destructive-foreground` | Errors, delete actions, cancelled status |
| `card` / `card-foreground` | Product/order cards (may alias surface in v1 but stays a separate token) |
| `input` | Form field borders/backgrounds |
| `ring` | All focus rings (`ring-ring`) |

Component mapping (both themes): buttons → `primary`; cards → `card`;
page bg → `background`; body/secondary text → `foreground`/`muted-foreground`;
borders → `border`; focus → `ring`; price emphasis → `foreground` with
`accent` reserved for discount/count highlights.

### 3.3 THEME TOKENS (light + dark values)

Defined in `frontend/src/index.css`. Initial values (tune only here):

```text
Token                  Light            Dark
background             #FFFFFF          #0B1120
foreground             #0F172A          #E2E8F0
surface                #FFFFFF          #0F172A
surface-muted          #F1F5F9          #1E293B
surface-elevated       #FFFFFF          #16213A
border                 #E2E8F0          #243149
border-muted           #F1F5F9          #1A2440
primary                #1D4ED8          #60A5FA
primary-foreground     #FFFFFF          #0B1120
secondary              #F1F5F9          #1E293B
secondary-foreground   #0F172A          #E2E8F0
accent                 #06B6D4          #22D3EE
accent-foreground      #083344          #083344
muted                  #F1F5F9          #1E293B
muted-foreground       #64748B          #94A3B8
success                #16A34A          #4ADE80
warning                #D97706          #FBBF24
destructive            #DC2626          #F87171
destructive-foreground #FFFFFF          #0B1120
card                   #FFFFFF          #0F172A
card-foreground        #0F172A          #E2E8F0
input                  #CBD5E1          #334155
ring                   #1D4ED8          #60A5FA
```

Dark-mode deliberation (not inversion): elevated surfaces step UP in
lightness from the page bg; resting shadows are replaced by `border` +
subtle elevation; product image wells use `surface-muted` so
product-on-light photography stays legible; discount/price contrast is
re-verified (accent-on-dark and foreground-on-card must pass AA); status
tints use soft tinted fills in both themes, never raw hue swaps.

### 3.4 Brand customization pointer

To rebrand Tech Pulse globally, edit ONLY the `primary`, `accent`, and `ring`
values (light + dark) in `frontend/src/index.css`. Buttons, links, active
category states, badges, wishlist hearts, focus rings, and toggle accents
follow automatically because they reference tokens, never literals.

## 4. Layout principles

- Page container: `mx-auto max-w-7xl px-4 sm:px-6 lg:px-8`, `bg-background
  text-foreground` at the root.
- Section rhythm: `py-10 sm:py-14` between merchandised bands; `space-y-6`
  inside cards; section headers with "view all" links (Portronics density).
- Rails: horizontal snap-scroll (`overflow-x-auto snap-x`) with edge peek on
  mobile, arrow buttons on desktop.
- Grids: `grid-cols-2 md:grid-cols-3 xl:grid-cols-4` (catalog);
  `md:grid-cols-2` (auth/account forms + summary patterns).
- Z-scale: header `z-40`, drawer/modal `z-50`, toasts top-center, sticky
  mobile buy bar `z-30`.

## 5. Header / navigation

- Announcement bar (REMAINS): `bg-foreground text-background`-inverted band
  (adapts per theme), micro/small medium text, rotating messages, dismiss button.
- Main header: `bg-surface border-b border-border`, sticky (`sticky top-0`).
  Logo (→ `/`) left. Desktop main menu, in order: `Category`
  (dropdown/mega-menu) | `New Arrivals` | `About Us` | `Support` — small
  medium links (`text-muted-foreground`, hover `text-foreground` with primary
  underline; active `text-primary font-semibold`). Right-side actions, in
  order: `Search` | `Cart` | `Login`, plus `Wishlist` + `Notification` bell
  when authenticated, plus the theme toggle. Count badges
  (`bg-accent text-accent-foreground` pill, `aria-live`).
- Category row treatment follows the Portronics mega-menu grammar (parent
  groups from `parentId` hierarchy); see DESIGN_REFERENCE §3.
- Mobile: hamburger → left slide-in drawer (`bg-surface`) with at most five
  top-level entries (Category accordion, New Arrivals, About Us, Support)
  + account section + theme toggle row; search icon expands full-width
  search row. Uncrowded by rule.

## 6. Search

- Pill input (`bg-surface-muted`, `border-input`) with leading search icon,
  clear button when text present, keyboard shortcut hint (`/` focuses).
- Suggestion dropdown (`bg-surface-elevated border-border shadow-lg`):
  suggested terms + top category hits; keyboard navigable
  (`aria-activedescendant`), Esc dismisses.
- Search page states reuse grid + empty-state patterns.

## 7. Product cards

- Anatomy: image area (1:1, `bg-surface-muted rounded-xl`, hover zoom
  `scale-105`), wishlist heart (top-right, always visible, active
  `text-accent` fill), discount badge (top-left `accent` pill `% off`), brand
  (micro uppercase tracking-wide `text-muted-foreground`), name (small/medium,
  2-line clamp, `text-card-foreground`), spec hook (micro
  `text-muted-foreground`, 1-line), price row (body-large bold + strikethrough
  small muted), Add button (full-width on hover desktop / always visible mobile).
- Card: `bg-card text-card-foreground rounded-2xl border border-border`,
  hover `shadow-lg -translate-y-0.5` (light) / `border-accent/40` lift (dark).
  Entire image+title links to detail; buttons stopPropagation.

## 8. Product grids

- Gap `4` mobile / `6` desktop. Skeleton cards (`bg-surface-muted`
  shimmer) mirror exact anatomy.
- Rails show 2.2 cards mobile peek, 4–5 desktop with arrow controls
  (`bg-surface-elevated border-border` buttons).
- Result counts (`text-muted-foreground`) and sort control right-aligned
  above grids.

## 9. Product detail layout

- Desktop: `lg:grid-cols-2` — left gallery (main 4:3 `bg-surface-muted
  rounded-2xl` + thumbnail strip, active `ring-ring`), right info stack
  (brand, h1, price block, variant pills `border-border` / active
  `border-primary text-primary`, qty stepper, CTA row, assurances,
  delivery-check UI decorative-static unless a backend ships it — label honestly).
- Mobile: gallery → price → variants → sticky bottom CTA bar
  (`bg-surface-elevated border-t border-border`).
- Tabs (Description / Specifications / Shipping & COD) as accessible tablist;
  accordions on mobile (`border-border` dividers).

## 10. Buttons

- Primary: `bg-primary text-primary-foreground rounded-xl px-5 py-3
  font-semibold`, hover darken, active scale-98, disabled `opacity-50`.
- Secondary: `bg-surface text-secondary-foreground border border-border`.
- Danger/ghost/icon variants defined once in `Button.jsx` from
  `destructive`/transparent tokens.
- All async buttons: loading spinner replaces label, `aria-busy`, no layout shift.

## 11. Forms

- Labels small/medium `text-foreground`; inputs `bg-surface border-input
  rounded-xl px-4 py-2.5`, focus `ring-2 ring-ring`; field error →
  `border-destructive` + micro `text-destructive` message +
  `aria-invalid`/`aria-describedby`.
- Address forms: 2-col grid desktop, label chips (`bg-surface-muted`),
  default-address toggle.
- react-hook-form + Zod; inline validation on blur, server `details[]` mapped
  post-submit.

## 12. Badges

- Discount: `accent` pill (tinted fill per theme).
- Status (orders): `warning` (PENDING), `primary` tint
  (CONFIRMED/PROCESSING), violet-equivalent tint (SHIPPED — add token only if
  needed, else `secondary`), `success` (DELIVERED), `destructive`/`muted`
  (CANCELLED) — always icon + text, never color-only.
- COD: `bg-foreground text-background` solid pill with banknote icon.
- Wishlist/cart counts: `accent` dot/pill on header icons.

## 13. Pricing

- `PriceBlock`: current price (bold, `text-foreground`, INR via `en-IN`),
  optional `compareAtPrice` strikethrough `text-muted-foreground`, computed
  `% off` accent badge. Prices render from decimal strings; formatting only.
- Cart/order totals: tabular-nums, right-aligned, server values verbatim.

## 14. Typography system (controlled scale)

| Style | Size / line-height | Weight / tracking | Use |
|-------|-------------------|-------------------|-----|
| `display` | 32px / 40px (`sm:40px/44px`) | extrabold / tight | Hero headlines |
| `h1` | 24px / 28px | bold / tight | Page + product titles |
| `h2` | 20px / 24px | semibold / tight | Section headers |
| `h3` | 16px / 20px | semibold / normal | Card-group titles, drawer headings |
| `body` | 14px / 20px | regular | Descriptions, lines, summaries |
| `body-lg` | 16px / 24px | medium | Price current, CTA-adjacent emphasis |
| `small` | 13px / 18px | medium | Labels, nav links, card names |
| `micro` | 12px / 16px | medium | Brand kicker, hooks, meta, errors |

- One family: system stack (`--font-sans`), no webfont dependency in v1.
- No arbitrary sizes in components — map every text element to a scale step.
- Dark mode never changes sizes/weights, only token colors; AA contrast
  re-checked per theme (§19 + checklist).

## 15. Spacing / borders / shadows

- Spacing scale: Tailwind default; card padding `p-4 sm:p-5`; page sections
  `space-y-8`.
- Borders: `border-border` default, hairlines `border-muted`; radii per §3.1.
- Shadows per §3.1; dark theme leans on borders/elevation rather than
  drop shadows. Accent glow on primary CTA hover only (opacity reduced in dark).

## 16. Responsive breakpoints

- `sm:640 md:768 lg:1024 xl:1280 2xl:1536` (Tailwind defaults). Behavior per
  PAGES.md § mobile/desktop splits; sidebar→drawer < `lg`; grids collapse
  per §8; tables → stacked cards < `md`.

## 17. Hover / transitions / animation

- `transition-colors duration-200` interactive; image zoom `duration-300`;
  card lift `duration-200`.
- Carousels: Embla with snap + autoplay-pause-on-hover (hero only);
  framer-motion for drawer/modal/toast mount only (no scroll-jacking).
- `prefers-reduced-motion: reduce` disables autoplay, zoom, and lift.
- Theme switching itself is instant (no color-transition lag that causes
  washed intermediate frames); toggle icon cross-fades.

## 18. Mobile navigation + theme toggle

- Bottom-safe sticky bars on product/cart/checkout (CTA + price,
  `bg-surface-elevated`).
- Drawer: categories accordion (parent → children from `parentId`), account
  section, **theme toggle row** (visible without scrolling to footer), close
  on navigate, focus trap, Esc close, body scroll lock.
- Mobile header keeps a compact theme toggle affordance (header icon or
  drawer row — implementation must satisfy checklist item "Mobile theme
  toggle behavior verified").

## 19. Footer

- 4-col desktop (Shop / Help / About-static / Contact-static), stacked mobile
  accordions (`bg-surface border-t border-border`). Bottom bar: copyright +
  "COD available" note. No fake payment icons (COD-only honesty — cash badge
  only), no fake social proof widgets fed by nonexistent aggregate APIs.

## 20. Skeleton loaders

- Shimmer (`bg-surface-muted animate-pulse` blocks) matching card/row/detail
  anatomy; grid skeletons preserve layout to avoid CLS; detail skeleton
  mirrors gallery+info columns. Skeletons read correctly in both themes
  (never hard white/gray blocks).

## 21. Empty states

- Centered Lucide icon in `bg-surface-muted` circle (`text-muted-foreground`
  icon), `small` semibold title (`text-foreground`), `body`
  `text-muted-foreground` message, primary CTA button. One `EmptyState`
  component, per-page copy in PAGES.md.

## 22. Manager-required UI elements

- **Company-first hero**: display-scale brand statement, one-line value
  proposition (placeholder until real copy), dual CTA row (About Us primary
  or secondary + Shop). Portronics-level carousel treatment (Embla,
  desktop/mobile creatives) without copying brand or assets.
- **Category discovery with icons**: horizontal icon-tile scroller (mobile)
  / tile band (desktop). Tile = `bg-card border-border rounded-2xl`, Lucide
  icon in `bg-surface-muted` circle + small medium name; icon mapped from
  category slug with generic fallback. Tiles navigate to `/category/:id`.
- **Home merchandising rails**: three labeled rails — Popular/Featured,
  New Arrivals, Maximum Discounted — reusing `ProductCard` + rail grammar
  (§8); discount rail shows computed `% off` badges from `PriceBlock`.
- **Notification bell** (authenticated only): `bg-transparent` icon button
  with `aria-label`; empty state panel ("No notifications yet") in
  `bg-surface-elevated border-border`; accent dot reserved for future unread
  counts. No fabricated items.
- **Floating WhatsApp action**: 56px circle, `bg-success text-white`-style
  token fill (verify AA for the glyph), MessageCircle Lucide glyph, fixed
  `bottom-6 right-6` (`z-30`), hover lift + focus `ring-ring`. Positioned
  clear of sticky buy bars and toasts on mobile (safe-area padding).
- **About/Support page patterns**: hero band (`bg-surface-muted`),
  prose constrained to `max-w-3xl`, contact cards (`bg-card
  border-border`), map slot with `border-border rounded-2xl` frame and a
  labeled missing-config state. Placeholder content is visually marked
  (never styled as verified company fact).

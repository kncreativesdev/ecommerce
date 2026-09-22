# Tech Pulse Admin — Architecture (ADMIN_ARCHITECTURE)

Separate frontend application (`tech-pulse/admin/`) for catalog management.
The customer storefront (`tech-pulse/frontend/`) is untouched by admin code.

## 1. Separation

| Concern | Storefront (`frontend/`) | Admin (`admin/`) |
|---|---|---|
| Audience | Customers | Managers / staff with `ADMIN` role |
| Visual language | Premium black/red commerce | Neutral professional dashboard |
| Category data | Backend taxonomy + static fallback (resilience) | Backend ONLY — no fallback, never edit fabricated data |
| Auth | Customer session (future milestone) | ADMIN-gated session (this app) |
| Theme key | `tp-theme` | `tp-admin-theme` (separate origins, no collision) |

Both apps consume the SAME backend API (`/api/v1`) through their own
`VITE_API_URL`. The backend is the single source of truth.

## 2. Layering

```
Component
  ↓
Hook / Zustand store
  ↓
Service (documented endpoints only)
  ↓
lib/apiClient.js (envelope, bearer, single-flight refresh)
  ↓
Backend API
```

No `fetch()` in components. No Context/Redux. No hardcoded hosts.

## 3. Authentication

Documented contract (`backend/src/modules/auth` + `docs/SECURITY.md`):

- `POST /auth/login { email, password }` (rate-limited) →
  `200 { user, accessToken }` + HttpOnly refresh cookie (JS-invisible).
- `POST /auth/refresh` (cookie, no body) → `200 { accessToken }` + rotation.
- `POST /auth/logout` → cookie cleared.
- `GET /auth/me` (bearer) → `{ user }` with `roles[]`.
- Safe user: `{ id, email, firstName, lastName, phone, roles[], createdAt }`.

Admin app behavior (`stores/useAuthStore.js`):

- Access token in MEMORY ONLY (Zustand, never persisted).
- Post-login the `ADMIN` role is required; non-admin accounts are signed
  straight back out with an explanatory message.
- Boot = one silent refresh → `GET /auth/me` → ADMIN check.
- `apiClient` injects the bearer per request; on `401` it refreshes once
  (single-flight across concurrent calls), retries the original once, then
  clears the session and the route guard redirects to `/login?redirect=`.
- Frontend role checks are UX layering. `authorize("ADMIN")` enforcement
  on every write route is server-side and authoritative.

## 4. Taxonomy architecture

Backend representation (verified `categories.*`): a category record carries
`{ id, name, slug, description, image, parentId, sortOrder, isActive }`.
There are NO `/subcategories` endpoints — subcategories ARE categories
whose `parentId` references another category.

```
GET /categories ──→ services/category.service.js
                        ↓
                 utils/taxonomy.js (adapt + buildCategoryTree)
                        ↓
                 stores/useCategoryStore.js (backend data only)
                  ┌──────┴──────────────┐
        CategoriesPage            ProductForm
        (tree: roots +          (Parent selector ← roots,
         children)               Sub selector ← children(parent))
```

- `GET /categories` returns ACTIVE rows only; deactivated rows vanish.
  The admin list reflects exactly that (no inactive section exists).
- `POST` accepts `name*` (+ optional `slug` auto-derived, `description`,
  `image`, `parentId`, `isActive`, `sortOrder`); strict bodies, `409` on
  slug clash, `404 CATEGORY_PARENT_NOT_FOUND` on unknown parents.
- `PATCH` accepts a partial subset; empty object → `422`; self-parent →
  `422 CATEGORY_SELF_PARENT`; ancestor cycles → `422 CATEGORY_CYCLE`.
  Quirk: `parentId: null` is IGNORED on update, so a subcategory cannot be
  promoted to top-level via PATCH (documented in `CategoryForm.jsx`).
- `DELETE` SOFT-DEACTIVATES (`isActive=false`, record kept). The admin
  labels the action "Deactivate" and removes the row from the active
  mirror. There is no hard delete and no restore endpoint.

## 5. Product category assignment

Backend (`products.validation.js`, `products.service.js`):

- Create REQUIRES `categoryId` (must reference an ACTIVE category, else
  `404 CATEGORY_NOT_FOUND`); optional `variants[]` (`sku*`, `name*`,
  `price*`, `compareAtPrice?`, `barcode?`, `weight?`, `isActive?`).
- Update accepts product fields ONLY (no `variants` key); empty object →
  `422 PRODUCT_UPDATE_INVALID`. Variants use the dedicated
  `/products/:productId/variants[/:variantId]` endpoints (follow-up).
- Reads embed a `category { id, name, slug }` brief.
- There is NO `subcategoryId` field, and strict bodies reject unknown
  fields — sending one yields `422`.

Product Form two-layer design (`utils/productPayload.js`):

```
UI selection: { parentCategoryId, subcategoryId }
        ↓  buildCreateProductPayload / buildUpdateProductPayload
Backend payload TODAY: { categoryId: parentCategoryId, ...fields }
Backend payload FUTURE: { ..., categoryId, subcategoryId }
```

The subcategory selector is fully functional as UI state (dependent
options, relationship re-checked on submit) but is never sent and never
reported as persisted — a visible note in the form states the limitation.
When the backend documents product→subcategory persistence, the single
migration point in `productPayload.js` enables it with no form, selector,
service, or validation-architecture change.

## 6. Intended final model

```
Backend Category { id, name, slug, description, image,
                   parentId, sortOrder, isActive }
        ↓ (parentId hierarchy)
Backend Subcategory (same model, parentId set)
        ↓
Admin Category CRUD → Admin Product Form
  (Parent Category selector → dependent Subcategory selector →
   categoryId [+ subcategoryId once supported])
        ↓
Storefront: taxonomy → mega-menu → shop filtering → listing
```

## 7. Known backend gaps affecting admin

1. No subcategory endpoints (hierarchy via `parentId` only) — worked
   around by client-side tree; no workaround possible for persistence
   beyond `parentId`.
2. No product→subcategory field — subcategory selection is UI-only.
3. `PATCH /categories/:id` ignores `parentId: null` — subcategory→top
   promotion impossible via API.
4. `GET /categories` is active-only — no inactive review/restore flow.
5. No static media serving for `storagePath`/`image` references.

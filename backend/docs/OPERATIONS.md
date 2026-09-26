# Tech Pulse Backend Operations

This document describes what the backend already provides for production
diagnosis, how to investigate common failures, and which observability
improvements are intentionally left for future work. It introduces no new
behavior; everything below reflects the current implementation.

Nothing in this document requires printing secrets. Never log or share
`DATABASE_URL`, JWT secrets, passwords, access tokens, refresh tokens,
cookie contents, or `Authorization` headers. The existing logger redaction
(see section 3) must remain enabled.

## 1. Runtime lifecycle

Available:

- `npm start` runs `node src/server.js`, which logs
  `Server listening on port <PORT>` on successful boot.
- `SIGINT` / `SIGTERM` trigger graceful shutdown: open connections drain
  via `server.close()`, then Prisma disconnects before the process exits.
- Missing `DATABASE_URL` fails loudly at startup (thrown error, non-zero
  exit) instead of booting against an undefined database.
- Missing JWT secrets with `NODE_ENV=production` fail loudly at startup.
  Outside production, insecure development-only fallbacks are used and a
  warning is logged for each missing secret.

Partial:

- There are no `uncaughtException` / `unhandledRejection` handlers. A
  throw outside Express error handling crashes the process; the platform
  supervisor is responsible for restarting it.

## 2. Health checks

Available:

- `GET /api/v1/health` returns HTTP `200` with
  `{ "success": true, "data": { "status": "healthy" } }`.
- Suitable for liveness probes and deployment verification.

Partial:

- The endpoint does not check database connectivity by design. Use a
  platform-level database check alongside it if deep health is required.

## 3. Logging

Available (pino, JSON-structured, level from `LOG_LEVEL`):

- Every request logs method, URL path, response status, and response time.
  Only these fields are captured; headers, cookies, authorization data,
  and request bodies are never logged.
- Redaction is configured for `password`, `passwordHash`, `token`,
  `accessToken`, `refreshToken`, `cookie`, `cookies`, `authorization`,
  `req.headers.authorization`, and `req.headers.cookie`, censored as
  `[Redacted]`.
- Unexpected (5xx) errors are logged server-side with the error object,
  method, and URL. Clients receive only
  `{ "success": false, "error": { "code": "INTERNAL_SERVER_ERROR" } }`.

Not implemented:

- No external log aggregation, metrics, tracing, alerting, or APM. Ship
  stdout through the platform's log collection and alert on `level: 50`
  entries and non-2xx rate changes there.

## 4. Error diagnosis

Error responses always use
`{ "success": false, "error": { "code": "<CODE>", "message": "..." } }`
(validation errors add a `details` array). Diagnose by status code:

- `401` → authentication/session investigation. Check for a missing or
  expired `Authorization: Bearer` token (`AUTH_UNAUTHORIZED`,
  `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_INVALID`). For refresh failures, check
  whether the `refresh_token` cookie is present and unexpired; an access
  token sent as a refresh token is rejected.
- `403` → authorization/role investigation. The caller is authenticated
  but lacks the role (`AUTH_FORBIDDEN`, e.g. a customer calling an
  ADMIN-only catalog, inventory, or media mutation). Inactive accounts get
  `AUTH_ACCOUNT_INACTIVE` at login and cannot refresh.
- `404` → route/resource investigation. `ROUTE_NOT_FOUND` means a wrong
  path or method (also returned for intentionally absent coupon, payment,
  webhook, moderation, and aggregate surfaces). Resource codes
  (`*_NOT_FOUND`) mean a wrong ID or another user's resource — by design,
  cross-owner access returns `404`, never `403`, to avoid leaking
  existence.
- `409` → conflict/business-rule investigation. Duplicate unique values
  (email, slug, SKU, wishlist item, review) or exhausted stock
  (`INSUFFICIENT_STOCK`, `ORDER_INSUFFICIENT_STOCK`). For checkout
  conflicts, inspect cart contents and current inventory.
- `422` → validation investigation. The `details` array names the
  offending field (`VALIDATION_ERROR`); strict schemas reject unknown or
  protected fields such as `userId`, prices, totals, statuses, or
  inventory counters.
- `429` → rate-limit investigation (see section 7).
- `5xx` → server/database/application-log investigation. `500` responses
  carry no internals; correlate timestamp and path with the server logs,
  which retain the error object, method, and URL.

## 5. Database diagnosis

Available:

- Prisma 7 with the MariaDB adapter over `DATABASE_URL`; a single shared
  client; graceful disconnect on shutdown.
- Schema and migration history (`prisma/migrations/`) are the contract;
  `npx prisma validate` confirms schema validity without touching data.
- Checkout, inventory adjustment, and related multi-write flows run inside
  database transactions with conditional atomic decrements, so partial
  states roll back; investigate failures via the inventory transaction
  ledger and order/payment/cart row presence.

Partial:

- Connection failures at runtime surface as `500`s in logs; there is no
  reconnect/backoff logic in the app — restart or platform recovery
  applies, then verify with the health endpoint and `migrate status`.
- Migration rollback is restore-from-backup only; never edit migration
  history. See `docs/DEPLOYMENT.md`.

## 6. Authentication/session diagnosis

Available:

- Access tokens are short-lived (default 15 minutes); refresh tokens are
  long-lived (default 7 days) with unique `jti` values and rotate on use.
- Refresh lives in an `HttpOnly` cookie (`Secure` in production,
  `SameSite` configurable); logout clears it.
- Login and refresh are blocked for deactivated accounts.

Known accepted limitation:

- An already-issued access token stays cryptographically valid until its
  short expiry even after account deactivation. This is inherent to
  stateless JWTs at the configured lifetimes, not a defect. If immediate
  revocation is ever required, it needs a future server-side session or
  denylist design.

## 7. Rate-limit diagnosis

Available:

- Global limiter and stricter auth-endpoint limiter return `429` with code
  `RATE_LIMIT_EXCEEDED`; standard `RateLimit-*` response headers are sent.
  Limits and windows are environment-configured.

Partial:

- Limiters are in-memory and per instance. A multi-instance deployment
  would need a shared store (for example Redis) in a future task; do not
  assume global caps hold across instances today.

## 8. Media/storage diagnosis

Available:

- Uploads require JPEG/PNG/WebP content verified through Sharp (MIME
  spoofing rejected), a 5MB cap, an 8000px dimension cap, and
  server-generated filenames under `storage/uploads/`, which the storage
  adapter confines to its root (traversal attempts rejected).
- A database-write failure after a file save triggers file compensation
  with an error log; a file-cleanup failure after row deletion logs a
  warning.

Known accepted limitation:

- A process crash between row deletion and file deletion can leave an
  orphaned file. Reconcile by listing unreferenced files under
  `storage/uploads/` during maintenance windows.

## 9. Environment/configuration diagnosis

Available:

- Every required variable is documented in `.env.example`; the loader
  fails loudly on missing production secrets or `DATABASE_URL`.
- `CORS_ORIGIN`, rate limits, log level, cookie flags, and token lifetimes
  are all environment-driven; wrong behavior here (CORS rejections, noisy
  logs, short sessions) almost always traces to env values, which must be
  checked without printing them.

## 10. Recommended production monitoring

Recommended (future work, not implemented):

- Alert on `level: 50` log volume and 5xx rate from shipped logs.
- Probe `GET /api/v1/health` plus a database-aware check.
- Track `429` rates to tune limits; track disk use under
  `storage/uploads/`.
- Explicitly out of scope for this task: metrics endpoints, distributed
  tracing, APM agents, external alerting integrations, and shared rate-limit
  stores.

## 11. Current limitations

- No metrics, tracing, alerting, APM, or external log aggregation exist.
- No database-aware health endpoint exists.
- No `uncaughtException`/`unhandledRejection` handling exists; the
  platform supervisor owns restarts.
- Rate limiting is per-instance memory only.
- Token revocation before expiry does not exist (see section 6).
- Crash-window orphan upload files are possible (see section 8).
- Migration rollback is backup-restore only.

## 12. Safe incident-response checklist

1. Confirm scope: health endpoint, recent deploys, error-code mix.
2. Pull platform logs for the window; filter `level: 50` and the affected
   path prefix. Never print secrets while sharing excerpts.
3. Classify by section 4 codes; apply the matching investigation above.
4. For checkout/inventory incidents, compare order, payment, cart-item, and
   inventory-ledger rows for the affected variants before acting.
5. For auth incidents, check token expiry, cookie presence, account active
   state, and role grants — not token contents.
6. For upload incidents, check MIME/size/dimensions of the rejected file
   and disk space under `storage/uploads/`.
7. If a migration is implicated, stop writes, back up, and follow
   `docs/DEPLOYMENT.md`; never edit migration history.
8. Record the timeline, queries run, and rows touched; roll back the
   application revision first and restore data only from backup.

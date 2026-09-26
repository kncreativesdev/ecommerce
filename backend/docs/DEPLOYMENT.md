# Tech Pulse Backend Deployment Runbook

## 1. Purpose and scope

This runbook covers production deployment of the Tech Pulse backend API only.

- Backend/API scope: the Express service in this repository.
- It does not cover any frontend, admin panel, or mobile client.
- It documents the deployment procedure; it does not execute a deployment.
- Local development verification is recorded separately in
  `docs/VERIFICATION_BASELINE.md` and must not be confused with a
  production release.

## 2. Prerequisites

- Node.js runtime. `package.json` does not pin an `engines` range, so use
  the same Node.js major line that passed local verification.
- A MySQL-compatible production database, reachable from the deployment
  environment.
- Ability to run `npm ci` (a `package-lock.json` is committed) and the
  Prisma CLI from `devDependencies`.
- Deployment infrastructure that supervises the Node.js process (platform
  service, container runtime, or process manager). This repository does not
  prescribe a provider; any choice is the operator's.
- HTTPS/TLS termination in front of production traffic. Secure cookies and
  the `Authorization` bearer scheme assume encrypted transport.

## 3. Production environment variables

Every variable below is consumed by the current code (`src/config/env.js`,
`src/config/database.js`, `src/config/cookies.js`, `src/server.js`).
No other variables are read.

| Name                       | Purpose                                  | Required | Example (safe)            |
| -------------------------- | ---------------------------------------- | -------- | ------------------------- |
| `NODE_ENV`                 | Selects production behavior              | Yes      | `production`              |
| `PORT`                     | HTTP listen port                         | No       | `3000`                    |
| `DATABASE_URL`             | MySQL-compatible connection string       | Yes      | supplied by environment   |
| `JWT_ACCESS_SECRET`        | Signs short-lived access tokens          | Yes      | strong random secret      |
| `JWT_REFRESH_SECRET`       | Signs refresh tokens (must differ)       | Yes      | different strong secret   |
| `JWT_ACCESS_EXPIRES_IN`    | Access token lifetime                    | No       | `15m`                     |
| `JWT_REFRESH_EXPIRES_IN`   | Refresh token lifetime                   | No       | `7d`                      |
| `CORS_ORIGIN`              | Allowed frontend origin(s)               | No       | production frontend URL   |
| `RATE_LIMIT_WINDOW_MS`     | Global rate-limit window                 | No       | `900000`                  |
| `RATE_LIMIT_MAX`           | Global request cap per window            | No       | `100`                     |
| `AUTH_RATE_LIMIT_WINDOW_MS`| Auth-endpoint rate-limit window          | No       | `900000`                  |
| `AUTH_RATE_LIMIT_MAX`      | Auth-endpoint request cap per window     | No       | `30`                      |
| `LOG_LEVEL`                | Pino log level                           | No       | `info`                    |
| `REFRESH_COOKIE_NAME`      | Refresh-token cookie name                | No       | `refresh_token`           |
| `REFRESH_COOKIE_SAMESITE`  | Cookie SameSite policy                   | No       | `lax`                     |
| `REFRESH_COOKIE_SECURE`    | Cookie Secure flag                       | No       | `true`                    |

Rules:

- `JWT_ACCESS_SECRET` must be a strong production secret.
- `JWT_REFRESH_SECRET` must be a different strong production secret.
- The development fallback secrets only apply outside production and log a
  warning; starting with `NODE_ENV=production` and unset secrets fails
  loudly instead of falling back. Never rely on fallbacks in production.
- `DATABASE_URL` must be supplied by the production environment.
- Production `CORS_ORIGIN` must be the intended frontend origin(s), not a
  wildcard and not a development URL.
- Production refresh cookies must use the Secure flag (`true`) over HTTPS.
- Never commit `.env`. It is gitignored. Only `.env.example` (placeholders)
  belongs in source control.

## 4. Database deployment

Safe production sequence (documents the commands; does not execute them):

1. Back up the production database. This is mandatory before migrating.
2. Verify `DATABASE_URL` points to the intended target database.
3. Optionally inspect migration status:
   `npx prisma migrate status`
4. Apply the existing migrations:
   `npx prisma migrate deploy`
   (Prisma 7 configuration: `prisma7.config.ts`, schema
   `prisma/schema.prisma`, migrations in `prisma/migrations/`.)
5. Verify migration success from the command output and follow with the
   application health check in section 6.

Prohibited in production:

- `prisma migrate reset`
- `prisma db push`
- Deleting or recreating migrations.
- Manually editing migration history.

## 5. Application build/install/start

The backend has no build script (`package.json` provides `dev`, `start`,
`test`, `test:run` only), so there is no build step.

1. Install dependencies from the lockfile:
   `npm ci`
2. Validate the Prisma setup (read-only):
   `npx prisma validate`
3. Start the production process:
   `npm start`
   (runs `node src/server.js`).
4. The process must be supervised by the deployment platform or process
   manager so it restarts on failure. The application handles `SIGINT` and
   `SIGTERM` with graceful shutdown, including Prisma disconnection.

## 6. Health verification

After deployment, verify:

```text
GET /api/v1/health
```

Expected: HTTP `200` with:

```json
{ "success": true, "data": { "status": "healthy" } }
```

If the platform offers database-aware health checks, verify database
connectivity separately through them; the built-in endpoint does not
require database access by design.

## 7. Security checklist

Controls actually implemented and to confirm in production:

- Helmet headers enabled.
- CORS restricted to the production origin(s).
- Global and auth-specific rate limiting active with configured values.
- Argon2id password hashing; no plaintext storage.
- JWT access/refresh separation (different secrets, different payloads).
- Refresh token in an `HttpOnly` cookie; Secure in production.
- SameSite cookie policy configured.
- Role authorization middleware on admin endpoints.
- Strict Zod validation on all input; unknown/protected fields rejected.
- Upload checks: JPEG/PNG/WebP MIME plus extension, 5MB limit, 8000px
  dimension cap, Sharp content verification, server-generated filenames,
  traversal-protected storage root.
- Logs contain method/URL/status only; no passwords, tokens, cookies,
  secrets, or connection strings.
- No secrets in source control (`.env` ignored; examples are placeholders).

## 8. Operational checklist

- Process restarts are handled by the platform supervisor, not the app.
- Graceful shutdown on `SIGINT`/`SIGTERM` closes HTTP and Prisma cleanly.
- Logs are emitted via pino; set `LOG_LEVEL` appropriately and ship logs
  through the platform's log collection.
- Environment configuration comes only from process env (see section 3).
- Database backups must precede every migration.
- `storage/uploads/` must persist across restarts (it is gitignored and
  created recursively at runtime); plan disk capacity for product,
  category, and user uploads.
- Monitor `GET /api/v1/health` continuously.
- Revisit `CORS_ORIGIN` whenever the frontend origin changes.

## 9. Rollback

- Application rollback: redeploy the previous known-good application
  revision through the platform.
- Database rollback: Prisma has no down-migration command in this project;
  rolling back schema changes means restoring the pre-migration backup.
- Never manually delete migration history to "undo" a release.
- When a release includes a migration, application and database versions
  must be moved together; do not run new application code against an
  unmigrated database or vice versa.

## 10. Pre-release checklist

- [ ] Code/version prepared and reviewed.
- [ ] Dependencies installed (`npm ci`).
- [ ] Environment variables configured (section 3).
- [ ] Production secrets generated and verified present (values never logged).
- [ ] Database backup completed.
- [ ] Migration status checked.
- [ ] `npx prisma migrate deploy` completed successfully.
- [ ] Health endpoint verified (`200`, healthy).
- [ ] Logs checked for errors and secret warnings.
- [ ] HTTPS verified.
- [ ] CORS verified against the production origin.
- [ ] Authentication verified (register/login/me on a controlled account).
- [ ] Media storage path verified writable and persistent.

## 11. Post-release smoke test

Using the deployed API with a controlled test account (credentials never
documented):

1. `GET /api/v1/health` → `200` healthy.
2. `POST /api/v1/auth/register` → `201`.
3. `POST /api/v1/auth/login` → `200`; retain the access token privately.
4. `GET /api/v1/auth/me` with the bearer token → `200`, same user.
5. One protected endpoint, e.g. `GET /api/v1/addresses` → `200`.
6. `POST /api/v1/auth/logout` → `200`.
7. Optionally one public catalog read, e.g. `GET /api/v1/products` → `200`.
8. Remove the controlled test account afterwards.

## 12. Current limitations / not covered

- No production deployment has been performed by this documentation task.
- No production database migration has been executed by this task.
- No load testing has been performed.
- No penetration testing has been performed.
- No permanent integration test suite exists.
- No online payment provider or webhook deployment is covered (none exists).
- Coupons are not exposed through the current API.
- Stateless access tokens remain usable until expiry after user
  deactivation; cart stock pre-checks are advisory; no stock reservation
  system exists; a crash between DB and file deletion can orphan an upload.

## 13. Source-of-truth references

- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/DATABASE.md`
- `docs/SECURITY.md`
- `docs/DEVELOPMENT_RULES.md`
- `docs/POSTMAN_TESTING.md`
- `docs/VERIFICATION_BASELINE.md`

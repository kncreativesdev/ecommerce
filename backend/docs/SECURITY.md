# Security Rules

## 1. Authentication

Authentication uses:

* JWT access tokens
* refresh tokens
* secure HttpOnly cookies for refresh tokens
* Argon2id password hashing

Access tokens must be short-lived.

Refresh tokens must not be exposed unnecessarily to client-side JavaScript.

## 2. Passwords

Passwords must:

* never be stored in plaintext
* never be logged
* be hashed with Argon2id
* never be returned in API responses

Password hashes must never be exposed through mappers or controllers.

## 3. Authorization

Initial roles:

* CUSTOMER
* ADMIN

Authorization middleware verifies required roles.

Role checks must happen server-side.

A client must never be trusted to declare its own role or permissions.

Ownership checks are also required where appropriate.

Examples:

* users can access their own profile
* users can access their own addresses
* users can modify their own cart
* users can modify their own wishlist
* users can modify their own reviews

## 4. Validation

All external input must be validated with Zod before business logic executes.

Validate:

* request body
* route parameters
* query parameters
* relevant uploaded-file metadata

Never trust client-provided values for:

* prices
* discounts
* inventory
* roles
* permissions
* order totals
* payment status

Server-side values are authoritative.

## 5. JWT

JWT secrets must come from environment variables.

Never hard-code:

* JWT secrets
* database credentials
* encryption keys
* API secrets

JWT payloads should contain only necessary claims.

Sensitive information must not be placed inside tokens.

## 6. Cookies

Refresh-token cookies should use:

* HttpOnly
* Secure in production
* appropriate SameSite policy
* appropriate expiration

Cookie configuration must come from centralized configuration.

## 7. HTTP Security

Use:

* Helmet
* CORS configuration
* express-rate-limit
* centralized error handling
* request logging without sensitive data

Do not expose stack traces or internal implementation details in production responses.

## 8. Sensitive Data

Never log:

* passwords
* password hashes
* refresh tokens
* access tokens
* cookies
* authorization headers
* payment secrets

Logs should contain enough information for debugging without exposing credentials.

## 9. SQL / Database Security

Prisma must be used for database access.

Do not construct SQL from untrusted input.

Where raw SQL is genuinely necessary, it must use safe parameterization.

## 10. File Upload Security

Uploaded files must be validated for:

* MIME type
* actual file type
* extension
* file size
* image dimensions where applicable

Images must be processed through Sharp.

Do not trust the original filename.

Generated filenames should be safe and server-controlled.

## 11. Media Paths

Clients must not control arbitrary filesystem paths.

The Media Service owns storage paths.

Path traversal must be prevented.

## 12. Error Handling

Errors returned to clients must not expose:

* stack traces
* SQL errors
* filesystem internals
* secrets
* implementation details

Internal details belong in server logs where appropriate.

## 13. Rate Limiting

Rate limiting should be applied especially to:

* authentication endpoints
* refresh-token endpoints
* password-related endpoints
* other abuse-sensitive endpoints

## 14. Environment Variables

`.env` must never be committed.

`.env.example` documents required variables without real secrets.

## 15. Security Principle

The server is authoritative.

Never rely on the frontend or Postman to enforce:

* authentication
* authorization
* price calculation
* inventory availability
* discount eligibility
* payment state
* ownership

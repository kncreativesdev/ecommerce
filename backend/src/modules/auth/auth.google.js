const crypto = require("crypto");

const { AppError } = require("../../utils/appError");

/**
 * Google ID-token verification (Google Identity Services credential flow).
 *
 * No new dependencies: verification uses Node's built-in `crypto` (RS256
 * against Google's published JWKS) and `fetch` (Node 22 global). The flow
 * integrates with the existing session architecture — a verified token
 * mints the SAME access/refresh pair as password login, so session,
 * refresh, logout, and role handling are unchanged.
 */

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
// Short JWKS cache: key rotations are rare, but a stale cache must never
// outlive its usefulness. Refreshed on unknown `kid` as well.
const CERTS_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

let cachedCerts = null; // { keys: Map<kid, KeyObject>, fetchedAt: number } | null
let inflightFetch = null;

function base64UrlDecode(input) {
  const normalized = String(input).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function parseTokenSegment(segment, label) {
  let parsed;
  try {
    parsed = JSON.parse(base64UrlDecode(segment).toString("utf8"));
  } catch {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token is invalid");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", `Google sign-in ${label} is invalid`);
  }
  return parsed;
}

async function fetchGoogleCerts() {
  if (inflightFetch) {
    return inflightFetch;
  }
  inflightFetch = (async () => {
    let response;
    try {
      response = await fetch(GOOGLE_CERTS_URL);
    } catch {
      throw new AppError(503, "AUTH_GOOGLE_UNAVAILABLE", "Google sign-in is temporarily unavailable");
    }
    if (!response.ok) {
      throw new AppError(503, "AUTH_GOOGLE_UNAVAILABLE", "Google sign-in is temporarily unavailable");
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new AppError(503, "AUTH_GOOGLE_UNAVAILABLE", "Google sign-in is temporarily unavailable");
    }
    const keys = new Map();
    for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
      if (!jwk || typeof jwk.kid !== "string") continue;
      try {
        keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
      } catch {
        // Skip unusable keys; a missing kid surfaces as invalid token.
      }
    }
    cachedCerts = { keys, fetchedAt: Date.now() };
    return cachedCerts;
  })();
  try {
    return await inflightFetch;
  } finally {
    inflightFetch = null;
  }
}

async function getGoogleKey(kid, allowRefresh) {
  const fresh = cachedCerts && Date.now() - cachedCerts.fetchedAt < CERTS_TTL_MS;
  const certs = fresh ? cachedCerts : await fetchGoogleCerts();
  const key = kid ? certs.keys.get(kid) : undefined;
  if (!key && allowRefresh) {
    // Possible key rotation: refresh once, then fail closed.
    const refreshed = await fetchGoogleCerts();
    const rotated = kid ? refreshed.keys.get(kid) : undefined;
    if (!rotated) {
      throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token is invalid");
    }
    return rotated;
  }
  if (!key) {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token is invalid");
  }
  return key;
}

function assertGoogleClaims(claims, audience) {
  if (!GOOGLE_ISSUERS.has(claims.iss)) {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token is invalid");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token is invalid");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now() - CLOCK_SKEW_MS) {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token has expired");
  }
  if (typeof claims.email !== "string" || claims.email.trim() === "") {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token is invalid");
  }
  // Google may encode this as boolean true or string "true".
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google account email is not verified");
  }
}

/**
 * Verify a Google ID token and return its claims. Throws AppError
 * (401 AUTH_GOOGLE_INVALID_TOKEN / 503 AUTH_GOOGLE_UNAVAILABLE) —
 * callers map these through the standard error envelope.
 */
async function verifyGoogleIdToken(idToken, audience) {
  if (typeof idToken !== "string") {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token is invalid");
  }
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token is invalid");
  }
  const header = parseTokenSegment(parts[0], "header");
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token is invalid");
  }
  const key = await getGoogleKey(header.kid, true);
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = base64UrlDecode(parts[2]);
  let valid = false;
  try {
    valid = crypto.verify("RSA-SHA256", Buffer.from(signingInput, "utf8"), key, signature);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new AppError(401, "AUTH_GOOGLE_INVALID_TOKEN", "Google sign-in token is invalid");
  }
  const claims = parseTokenSegment(parts[1], "payload");
  assertGoogleClaims(claims, audience);
  return claims;
}

function clearGoogleCertsCache() {
  cachedCerts = null;
}

module.exports = { verifyGoogleIdToken, clearGoogleCertsCache };

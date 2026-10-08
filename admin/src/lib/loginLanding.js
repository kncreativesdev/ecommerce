/**
 * Role-aware post-login landing (shared by the sign-in submit path and
 * the already-authenticated redirect).
 *
 * SUPER_ADMIN lands on the dedicated platform dashboard (`/platform` —
 * aggregate-only company statistics, never operational rows); ADMIN
 * users honor the validated `redirect` target (default `/dashboard`);
 * every other admitted panel role lands on `/audit-logs` (the only
 * route HEAD/MEMBER share with the rest, so no login↔route loop is
 * possible). Always derive the target from the freshly authenticated
 * user, never from a pre-login render closure (which still sees
 * `user === null`).
 */
export function safeRedirect(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/dashboard';
}

export function landingFor(user, redirectParam) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  if (roles.includes('SUPER_ADMIN')) return '/platform';
  if (roles.includes('ADMIN')) return safeRedirect(redirectParam);
  return '/audit-logs';
}

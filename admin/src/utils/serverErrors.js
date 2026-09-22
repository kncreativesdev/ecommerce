/**
 * Map backend Zod `details[]` (`{ path, message }`) onto react-hook-form
 * field errors. Unknown paths fall back to a form-level (`root`) error.
 * Returns the root message (or `null`) for callers to display.
 */
export function applyServerErrors(details, setError) {
  let root = null;
  for (const detail of Array.isArray(details) ? details : []) {
    const field = Array.isArray(detail?.path) ? detail.path[0] : detail?.path;
    const message = detail?.message ?? 'Invalid value.';
    if (typeof field === 'string' && field !== '') {
      setError(field, { type: 'server', message }, { shouldFocus: true });
    } else if (!root) {
      root = message;
    }
  }
  return root;
}

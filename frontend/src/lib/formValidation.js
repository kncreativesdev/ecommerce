/**
 * Minimal Zod ↔ React Hook Form bridge (avoids an extra dependency).
 *
 * `zodResolver(schema)` adapts a Zod object schema to RHF's `resolver`
 * interface: returns `{ values, errors }` with nested error objects keyed
 * by field path. Unknown/extra keys are stripped before validation so
 * strict backend bodies never receive them.
 *
 * `mapServerDetails(details)` converts backend Zod `details[]`
 * (`{ path, message }`) into `{ fieldName: message }` for `setError`.
 */

/** Adapt a Zod schema to an RHF resolver. */
export function zodResolver(schema) {
  return async (values) => {
    const parsed = await schema.safeParseAsync(values ?? {});
    if (parsed.success) {
      return { values: parsed.data, errors: {} };
    }
    const errors = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      if (!errors[path]) {
        errors[path] = { type: issue.code ?? 'validation', message: issue.message };
      }
    }
    return { values: {}, errors };
  };
}

/**
 * Map backend `details[]` to `{ field, message }` pairs.
 * Array paths (`["items", 0, "quantity"]`) collapse to the first segment.
 */
export function mapServerDetails(details) {
  const mapped = {};
  if (!Array.isArray(details)) return mapped;
  for (const detail of details) {
    const rawPath = detail?.path;
    const field = Array.isArray(rawPath) ? rawPath[0] : rawPath;
    const key = typeof field === 'string' && field !== '' ? field : 'root';
    if (!mapped[key]) {
      mapped[key] = detail?.message ?? 'Invalid value.';
    }
  }
  return mapped;
}

/** Apply mapped server errors via RHF `setError`; returns root message. */
export function applyServerErrors(setError, details) {
  const mapped = mapServerDetails(details);
  for (const [field, message] of Object.entries(mapped)) {
    setError(field, { type: 'server', message });
  }
  return mapped.root ?? null;
}

/**
 * Company A / Company B isolation test-harness scaffolding (Phase 0).
 *
 * Purpose: make future cross-company isolation tests easy to add
 * without changing any existing test behavior.
 *
 * This helper is intentionally database-free: it provides deterministic
 * fixture labels and pure assertion helpers only. Real Company rows,
 * company-scoped users, and authenticated cross-company scenarios
 * arrive in Phase 1/2, when this harness grows `createCompanyFixture`
 * style helpers on top of these primitives.
 *
 * This file is NOT a test itself (no `.test.js` suffix) so the runner
 * never executes it directly.
 */

const COMPANY_A_TAG = "COMPANY_A";
const COMPANY_B_TAG = "COMPANY_B";

/**
 * Deterministic fixture labels for a future Company A / Company B pair.
 * Pure function — no database, no randomness — so test titles and
 * fixture names stay stable across runs.
 */
function companyPairLabels(suffix = "") {
  const tag = typeof suffix === "string" && suffix !== "" ? `:${suffix}` : "";
  return {
    companyA: `${COMPANY_A_TAG}${tag}`,
    companyB: `${COMPANY_B_TAG}${tag}`,
  };
}

/**
 * Asserts that a response denied cross-company access. Accepts the
 * statuses the API uses for denied/missing resources (403 forbidden,
 * 404 not-found-masquerade, 401 unauthenticated) so future isolation
 * tests share one expectation regardless of the endpoint's chosen
 * denial code.
 */
function expectAccessDenied(response) {
  const denied = [401, 403, 404];
  if (!response || typeof response.status !== "number" || !denied.includes(response.status)) {
    throw new Error(
      `Expected cross-company access to be denied (one of ${denied.join(", ")}), ` +
        `received status ${response && response.status}.`
    );
  }
}

/**
 * Guards against company-scope leakage between two payloads: fails when
 * any id appearing in `payloadA` also appears in `payloadB` for the
 * given id field. Pure structural check for future list/detail
 * comparisons (e.g. product ids of Company A must never equal ids
 * served to Company B).
 */
function assertNoSharedIds(payloadA, payloadB, idField = "id") {
  const collect = (value, into) => {
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, into));
      return;
    }
    if (value && typeof value === "object") {
      if (typeof value[idField] === "string") {
        into.add(value[idField]);
      }
      Object.values(value).forEach((nested) => collect(nested, into));
    }
  };
  const idsA = new Set();
  const idsB = new Set();
  collect(payloadA, idsA);
  collect(payloadB, idsB);
  const shared = [...idsA].filter((id) => idsB.has(id));
  if (shared.length > 0) {
    throw new Error(`Cross-company id leakage detected for field "${idField}": ${shared.join(", ")}`);
  }
}

module.exports = {
  COMPANY_A_TAG,
  COMPANY_B_TAG,
  companyPairLabels,
  expectAccessDenied,
  assertNoSharedIds,
};

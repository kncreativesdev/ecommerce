const { z } = require("zod");

/**
 * Dashboard summary query. The ONLY accepted param is the fixed range
 * enum — no timestamps cross the wire, so frontend and backend can never
 * disagree on boundaries or drift across timezones. Unknown params are
 * stripped (not rejected) so the dashboard never 422s.
 */
const dashboardSummaryQuerySchema = z
  .object({
    range: z.enum(["today", "week", "month", "year"]).optional(),
  })
  .strip();

module.exports = { dashboardSummaryQuerySchema };

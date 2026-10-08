const dashboardService = require("./dashboard.service");
const { dashboardSummaryQuerySchema } = require("./dashboard.validation");

/**
 * Server-resolved tenant for order aggregates. The mounted
 * companyContext guarantees the value (or rejects the request first).
 */
function companyIdOf(req) {
  return req.companyContext && typeof req.companyContext.companyId === "string"
    ? req.companyContext.companyId
    : null;
}

async function summary(req, res, next) {
  try {
    const query = dashboardSummaryQuerySchema.parse(req.query);
    const summary = await dashboardService.getSummary(companyIdOf(req), query.range ?? "today");
    return res.status(200).json({ success: true, data: { summary } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { summary };

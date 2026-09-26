const dashboardService = require("./dashboard.service");
const { dashboardSummaryQuerySchema } = require("./dashboard.validation");

async function summary(req, res, next) {
  try {
    const query = dashboardSummaryQuerySchema.parse(req.query);
    const summary = await dashboardService.getSummary(query.range ?? "today");
    return res.status(200).json({ success: true, data: { summary } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { summary };

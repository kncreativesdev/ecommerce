const auditService = require("./audit.service");
const retentionService = require("./retention.service");
const { auditListQuerySchema, auditExportQuerySchema, retentionPolicySchema } = require("./audit.validation");
const { auditLogsToCsv, exportFilename } = require("./audit.csv");

/**
 * Server-side viewer identity for audit reads (Phase 2C-18). Roles
 * come from the verified token claims (same source `authorize`
 * enforces); the company scope comes from the resolved request
 * context (same source every company route enforces). Nothing here
 * is read from query, body, or headers.
 */
function viewerOf(req) {
  const companyContext = req.companyContext && typeof req.companyContext === "object" ? req.companyContext : null;
  return {
    id: req.user.id,
    roles: Array.isArray(req.user.roles) ? req.user.roles : [],
    companyId: companyContext && typeof companyContext.companyId === "string" ? companyContext.companyId : null,
  };
}

async function list(req, res, next) {
  try {
    const query = auditListQuerySchema.parse(req.query);
    const { logs, pagination } = await auditService.listAuditLogs(viewerOf(req), {
      ...query,
      // Explicit platform scope: ?companyId=null selects platform-only
      // rows for SUPER_ADMIN (everyone else's scope is forced
      // server-side regardless of this parameter).
      companyId: query.companyId === "null" ? null : query.companyId,
    });
    // Strictly read-only: no audit row is created for reading audit
    // rows, and no timestamp is touched.
    return res.status(200).json({ success: true, data: { logs }, meta: pagination });
  } catch (err) {
    return next(err);
  }
}

async function getRetention(req, res, next) {
  try {
    const retention = await retentionService.getRetentionPolicy();
    return res.status(200).json({ success: true, data: { retention } });
  } catch (err) {
    return next(err);
  }
}

/**
 * Audit CSV export (Phase 2C-21). Same viewer identity and the same
 * validated filters as the read endpoint (minus pagination — export
 * always represents the complete filtered set up to the server-side
 * maximum). Strictly read-only like `list`: exporting writes no
 * audit row and touches no timestamps or retention state.
 */
async function exportLogs(req, res, next) {
  try {
    const query = auditExportQuerySchema.parse(req.query);
    const { logs } = await auditService.exportAuditLogs(viewerOf(req), {
      ...query,
      companyId: query.companyId === "null" ? null : query.companyId,
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename()}"`);
    return res.status(200).send(auditLogsToCsv(logs));
  } catch (err) {
    return next(err);
  }
}

async function updateRetention(req, res, next) {
  try {
    const input = retentionPolicySchema.parse(req.body);
    const retention = await retentionService.setRetentionPolicy(input.policy, { id: req.user.id });
    return res.status(200).json({ success: true, data: { retention } });
  } catch (err) {
    return next(err);
  }
}

/**
 * Audit analytics summary (Phase 2C-24). Same viewer identity and
 * the same validated filters as the read/export endpoints (minus
 * pagination — the summary always covers an explicit, bounded
 * period). Strictly read-only: aggregating writes no audit row and
 * touches no timestamps or retention state.
 */
async function getSummary(req, res, next) {
  try {
    const query = auditExportQuerySchema.parse(req.query);
    const { summary } = await auditService.getAuditSummary(viewerOf(req), {
      ...query,
      companyId: query.companyId === "null" ? null : query.companyId,
    });
    return res.status(200).json({ success: true, data: { summary } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, exportLogs, getSummary, getRetention, updateRetention };

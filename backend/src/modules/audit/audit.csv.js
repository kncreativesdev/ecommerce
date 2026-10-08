/**
 * Audit CSV export (Phase 2C-21). Dependency-free serializer over the
 * exact safe projection already exposed by GET /api/v1/audit-logs —
 * no hidden columns, no raw model access. Pure functions (no I/O) so
 * quoting/escaping is unit-verifiable without a database.
 */

/**
 * CSV column order: the repository's explicit safe projection, in
 * select order. `details` serializes as compact JSON (an object or
 * null at write time, so the cell always starts with `{` or is
 * empty). `createdAt` serializes as an ISO-8601 UTC string.
 */
const CSV_COLUMNS = Object.freeze([
  "id",
  "actorId",
  "actorRole",
  "actorEmail",
  "companyId",
  "action",
  "resource",
  "resourceId",
  "outcome",
  "details",
  "createdAt",
]);

function cellText(column, row) {
  const value = row ? row[column] : null;
  if (value === null || value === undefined) {
    return "";
  }
  if (column === "details") {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

// Spreadsheet formula-injection guard (OWASP CSV guidance): a cell
// whose first character is =, +, -, or @ is prefixed with a single
// quote so spreadsheet applications treat it as text. The underlying
// audit data is unchanged (GET responses are byte-identical); only
// the CSV representation neutralizes the trigger character.
function neutralizeFormula(text) {
  if (text !== "" && (text[0] === "=" || text[0] === "+" || text[0] === "-" || text[0] === "@")) {
    return `'${text}`;
  }
  return text;
}

// RFC 4180 quoting: cells containing a double quote, comma, or line
// break are wrapped in double quotes with internal quotes doubled.
// All other cells pass through verbatim (no gratuitous quoting, so
// plain values stay plain).
function quoteCell(text) {
  if (text.includes('"') || text.includes(",") || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function rowToCsv(row) {
  return CSV_COLUMNS.map((column) => quoteCell(neutralizeFormula(cellText(column, row)))).join(",");
}

function auditLogsToCsv(logs) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of logs || []) {
    lines.push(rowToCsv(row));
  }
  return `${lines.join("\r\n")}\r\n`;
}

// Deterministic server-side filename (UTC, no user input anywhere).
function exportFilename(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").split(".")[0];
  return `audit-logs-${stamp}Z.csv`;
}

module.exports = { CSV_COLUMNS, cellText, neutralizeFormula, quoteCell, rowToCsv, auditLogsToCsv, exportFilename };

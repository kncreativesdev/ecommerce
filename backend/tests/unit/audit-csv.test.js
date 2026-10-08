import { describe, it, expect } from "vitest";

import {
  CSV_COLUMNS,
  neutralizeFormula,
  quoteCell,
  rowToCsv,
  auditLogsToCsv,
  exportFilename,
} from "../../src/modules/audit/audit.csv.js";

/**
 * Phase 2C-21 CSV serializer unit tests (no database). The
 * integration suite proves the same bytes come out of the HTTP
 * endpoint under each role's visibility scope.
 */

describe("CSV projection", () => {
  it("exposes exactly the safe read-projection columns in order", () => {
    expect(CSV_COLUMNS).toEqual([
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
  });

  it("serializes null as empty and dates as ISO UTC", () => {
    expect(
      rowToCsv({
        id: "abc",
        actorId: null,
        actorRole: "ADMIN",
        actorEmail: null,
        companyId: null,
        action: "CREATED",
        resource: "USER",
        resourceId: null,
        outcome: "SUCCESS",
        details: null,
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
      })
    ).toBe("abc,,ADMIN,,,CREATED,USER,,SUCCESS,,2026-01-02T03:04:05.000Z");
  });
});

describe("CSV quoting", () => {
  it("quotes commas, quotes, and newlines per RFC 4180", () => {
    expect(quoteCell("plain")).toBe("plain");
    expect(quoteCell("a,b")).toBe('"a,b"');
    expect(quoteCell('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCell("line1\nline2")).toBe('"line1\nline2"');
    expect(quoteCell("win\r\nline")).toBe('"win\r\nline"');
  });

  it("keeps details JSON in one correctly escaped cell", () => {
    const line = rowToCsv({
      id: "1",
      actorId: null,
      actorRole: "SYSTEM",
      actorEmail: null,
      companyId: null,
      action: "CREATED",
      resource: "USER",
      resourceId: null,
      outcome: "SUCCESS",
      details: { note: 'comma, "quote"\nnewline' },
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    // One quoted cell: JSON inner quotes arrive backslash-escaped,
    // so the quoter doubles the quote half (`\"` -> `\"\"`); the
    // newline stays raw inside the quotes.
    expect(line).toContain('"{""note"":""comma, \\""quote\\"');
    expect(line).toContain('newline""}"');
    expect(line.endsWith(',2026-01-02T00:00:00.000Z')).toBe(true);
  });
});

describe("formula-injection guard", () => {
  it.each([["=cmd"], ["+cmd"], ["-cmd"], ["@cmd"]])("prefixes %s cells with a text marker", (value) => {
    expect(neutralizeFormula(value)).toBe(`'${value}`);
    expect(quoteCell(neutralizeFormula(value))).toBe(`'${value}`);
  });

  it("leaves ordinary values and JSON cells untouched", () => {
    expect(neutralizeFormula("admin@example.test")).toBe("admin@example.test");
    expect(neutralizeFormula('{"a":1}')).toBe('{"a":1}');
    expect(neutralizeFormula("")).toBe("");
  });
});

describe("document assembly", () => {
  it("emits header plus one row per log with CRLF endings", () => {
    const csv = auditLogsToCsv([
      { id: "1", actorRole: "ADMIN", action: "CREATED", resource: "USER", outcome: "SUCCESS", createdAt: new Date("2026-01-02T00:00:00.000Z") },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines[1].startsWith("1,,ADMIN")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("emits header-only output for empty sets", () => {
    expect(auditLogsToCsv([])).toBe(`${CSV_COLUMNS.join(",")}\r\n`);
  });

  it("builds deterministic server-side filenames", () => {
    expect(exportFilename(new Date("2026-03-04T05:06:07.000Z"))).toBe("audit-logs-20260304T050607Z.csv");
    expect(exportFilename()).toMatch(/^audit-logs-\d{8}T\d{6}Z\.csv$/);
  });
});

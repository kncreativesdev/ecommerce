import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";

import app from "../../src/app.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { prisma } from "../../src/config/database.js";
import { hashPassword } from "../../src/modules/auth/auth.utils.js";
import { provisionCompanyAdmin, provisionEmployee } from "../../src/modules/users/users.service.js";
import { recordAuditEvent, exportAuditLogs } from "../../src/modules/audit/audit.service.js";
import { CSV_COLUMNS } from "../../src/modules/audit/audit.csv.js";
import { runRetentionCleanup } from "../../src/modules/audit/retention.service.js";

/**
 * Phase 2C-21 audit CSV export (live HTTP + MySQL).
 *
 * GET /api/v1/audit-logs/export shares the read endpoint's service
 * layer exactly: every visibility assertion below is cross-checked
 * against GET /api/v1/audit-logs with identical filters. Company #1
 * is untouched.
 */

const RUN = `TSTAX${Date.now().toString(36).toUpperCase()}`.toLowerCase();

const ctx = {};
const createdUserIds = [];
const createdCompanyIds = [];

const headersFor = (id, roles) => ({
  Authorization: `Bearer ${signAccessToken({ id, roles })}`,
});

async function createUser(tag, roleName, companyId) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      passwordHash: await hashPassword("TestPass123!"),
      firstName: "AuditExp",
      lastName: tag,
      companyId,
    },
  });
  createdUserIds.push(user.id);
  let role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    role = await prisma.role.create({ data: { name: roleName } });
  }
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user;
}

async function seedRow({ actorId, actorRole, actorEmail, companyId, action, resource, details }) {
  return recordAuditEvent({
    actorId,
    actorRole,
    actorEmail: actorEmail === undefined ? `${RUN}-seed@example.test` : actorEmail,
    companyId,
    action,
    resource,
    resourceId: randomUUID(),
    outcome: "SUCCESS",
    details: details === undefined ? { seed: RUN } : details,
  });
}

const getExport = (headers, query = "") =>
  request(app).get(`/api/v1/audit-logs/export${query}`).set(headers);
const getList = (headers, query = "") =>
  request(app).get(`/api/v1/audit-logs${query}`).set(headers);

/** Minimal RFC 4180 reader for assertions (mirrors the writer). */
function parseCsv(text) {
  const rows = [];
  let fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      fields.push(field);
      field = "";
      rows.push(fields);
      fields = [];
      i += 1;
    } else if (c === "\n") {
      fields.push(field);
      field = "";
      rows.push(fields);
      fields = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    rows.push(fields);
  }
  return rows;
}

const rowIds = (parsed) => new Set(parsed.slice(1).map((fields) => fields[0]));

async function listIds(headers, query) {
  const res = await getList(headers, query);
  expect(res.status).toBe(200);
  return new Set(res.body.data.logs.map((l) => l.id));
}

beforeAll(async () => {
  for (const tag of ["a", "b"]) {
    const company = await prisma.company.create({ data: { name: `${RUN}-co-${tag}` } });
    createdCompanyIds.push(company.id);
    ctx[`company${tag.toUpperCase()}`] = company;
    const admin = await provisionCompanyAdmin(company.id, {
      email: `${RUN}-admin-${tag}@example.test`,
      password: "TestPass123!",
      firstName: "AuditExp",
      lastName: `Admin${tag.toUpperCase()}`,
    });
    createdUserIds.push(admin.id);
    ctx[`admin${tag.toUpperCase()}`] = await prisma.user.findUnique({ where: { id: admin.id } });
  }
  const headA = await provisionEmployee(
    { id: ctx.adminA.id, companyId: ctx.companyA.id, roles: ["ADMIN"] },
    { email: `${RUN}-head-a@example.test`, password: "TestPass123!", firstName: "AuditExp", lastName: "HeadA", role: "HEAD" }
  );
  createdUserIds.push(headA.id);
  ctx.headA = headA;
  for (const tag of ["m1", "m2"]) {
    const member = await provisionEmployee(
      { id: headA.id, companyId: ctx.companyA.id, roles: ["HEAD"] },
      { email: `${RUN}-member-a-${tag}@example.test`, password: "TestPass123!", firstName: "AuditExp", lastName: `Member${tag}`, role: "MEMBER" }
    );
    createdUserIds.push(member.id);
    ctx[`member${tag.toUpperCase()}`] = member;
  }
  ctx.customerA = await createUser("customer-a", "CUSTOMER", ctx.companyA.id);
  ctx.superAdmin = await createUser("super", "SUPER_ADMIN", null);

  // Member/head/customer-authored rows plus escaping and formula cases.
  await seedRow({ actorId: ctx.memberM1.id, actorRole: "MEMBER", companyId: ctx.companyA.id, action: "CREATED", resource: "USER" });
  ctx.escapeRow = await seedRow({
    actorId: ctx.memberM1.id,
    actorRole: "MEMBER",
    companyId: ctx.companyA.id,
    action: "UPDATED",
    resource: "PRODUCT",
    details: { note: 'comma, "quote"\nnewline', seed: RUN },
  });
  for (const [tag, prefix] of [["eq", "="], ["plus", "+"], ["minus", "-"], ["at", "@"]]) {
    ctx[`formula${tag}`] = await seedRow({
      actorId: ctx.memberM2.id,
      actorRole: "MEMBER",
      actorEmail: `${prefix}evil-${RUN}@example.test`,
      companyId: ctx.companyA.id,
      action: "CREATED",
      resource: "USER",
    });
  }
  ctx.nullRow = await seedRow({
    actorId: ctx.memberM2.id,
    actorRole: "MEMBER",
    actorEmail: null,
    companyId: ctx.companyA.id,
    action: "DELETED",
    resource: "REVIEW",
    details: null,
  });
  await seedRow({ actorId: ctx.headA.id, actorRole: "HEAD", companyId: ctx.companyA.id, action: "CREATED", resource: "CATEGORY" });
  await seedRow({ actorId: ctx.adminB.id, actorRole: "ADMIN", companyId: ctx.companyB.id, action: "UPDATED", resource: "ORDER" });
  await seedRow({ actorId: ctx.customerA.id, actorRole: "CUSTOMER", companyId: ctx.companyA.id, action: "CREATED", resource: "RETURN" });

  // Real mutation row plus platform rows (create + suspend a company).
  const adminHeaders = headersFor(ctx.adminA.id, ["ADMIN"]);
  const category = await request(app).post("/api/v1/categories").set(adminHeaders).send({ name: `${RUN} Cat` });
  expect(category.status).toBe(201);
  const superHeaders = headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
  const companyE = await request(app).post("/api/v1/companies").set(superHeaders).send({ name: `${RUN}-co-e` });
  expect(companyE.status).toBe(201);
  createdCompanyIds.push(companyE.body.data.company.id);
  ctx.companyE = companyE.body.data.company;
  const suspended = await request(app).post(`/api/v1/companies/${ctx.companyE.id}/suspend`).set(superHeaders);
  expect(suspended.status).toBe(200);
  const deleted = await request(app)
    .delete(`/api/v1/companies/${ctx.companyE.id}`)
    .set(superHeaders)
    .send({ confirmName: `${RUN}-co-e` });
  expect(deleted.status).toBe(200);
}, 180000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ companyId: { in: createdCompanyIds } }, { resourceId: { in: createdCompanyIds } }],
    },
  });
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.category.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  if (createdCompanyIds.length > 0) {
    // Company E was deleted mid-file (its platform rows are cleaned
    // above by resourceId); the rest go through the guarded API path.
    for (const id of [...createdCompanyIds]) {
      try {
        const row = await prisma.company.findUnique({ where: { id } });
        if (row) {
          await request(app).post(`/api/v1/companies/${id}/suspend`).set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]));
          const current = await prisma.company.findUnique({ where: { id } });
          if (current) {
            await request(app).delete(`/api/v1/companies/${id}`).set(headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"])).send({ confirmName: current.name });
          }
        }
      } catch {
        // Best-effort test hygiene only.
      }
    }
  }
  await prisma.$disconnect();
});

const superHeaders = () => headersFor(ctx.superAdmin.id, ["SUPER_ADMIN"]);
const adminA = () => headersFor(ctx.adminA.id, ["ADMIN"]);
const headA = () => headersFor(ctx.headA.id, ["HEAD"]);
const memberM1 = () => headersFor(ctx.memberM1.id, ["MEMBER"]);

describe("authorization", () => {
  it("anonymous is rejected", async () => {
    expect((await request(app).get("/api/v1/audit-logs/export")).status).toBe(401);
  });

  it("CUSTOMER is rejected", async () => {
    const res = await getExport(headersFor(ctx.customerA.id, ["CUSTOMER"]));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
  });

  it("suspended members are blocked, SUPER_ADMIN exports suspended scopes", async () => {
    const suspended = await prisma.company.create({ data: { name: `${RUN}-susp-co`, status: "SUSPENDED" } });
    createdCompanyIds.push(suspended.id);
    const member = await createUser("susp-member", "MEMBER", suspended.id);
    const blocked = await getExport(headersFor(member.id, ["MEMBER"]));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("COMPANY_SUSPENDED");
    const allowed = await getExport(superHeaders(), `?companyId=${suspended.id}`);
    expect(allowed.status).toBe(200);
  });

  it("exports mutate nothing", async () => {
    const scope = { OR: [{ companyId: { in: createdCompanyIds } }, { resourceId: { in: createdCompanyIds } }] };
    const before = await prisma.auditLog.count({ where: scope });
    await getExport(adminA());
    await getExport(superHeaders());
    expect(await prisma.auditLog.count({ where: scope })).toBe(before);
  });
});

describe("visibility parity with GET", () => {
  it("SUPER_ADMIN exports everything in scope", async () => {
    for (const query of [`?actorId=${ctx.memberM1.id}&resource=USER`, `?companyId=${ctx.companyA.id}`, "?companyId=null", `?actorId=${ctx.headA.id}`]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await getExport(superHeaders(), query);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^text\/csv/);
      // eslint-disable-next-line no-await-in-loop
      expect(rowIds(parseCsv(res.text))).toEqual(await listIds(superHeaders(), query));
    }
  });

  it("ADMIN sees only the own company", async () => {
    const res = await getExport(adminA());
    expect(res.status).toBe(200);
    expect(rowIds(parseCsv(res.text))).toEqual(await listIds(adminA(), ""));
    // A foreign companyId is ignored (scope stays forced to the own
    // company): same rows as unfiltered, never company B rows.
    const foreign = await getExport(adminA(), `?companyId=${ctx.companyB.id}`);
    expect(foreign.status).toBe(200);
    expect(rowIds(parseCsv(foreign.text))).toEqual(rowIds(parseCsv(res.text)));
    const parsed = parseCsv(foreign.text);
    const companyIndex = parsed[0].indexOf("companyId");
    expect(parsed.slice(1).every((fields) => fields[companyIndex] === ctx.companyA.id)).toBe(true);
  });

  it("HEAD sees own plus members, never peers/admins/foreign rows", async () => {
    const res = await getExport(headA());
    expect(res.status).toBe(200);
    expect(rowIds(parseCsv(res.text))).toEqual(await listIds(headA(), ""));
    const parsed = parseCsv(res.text);
    const actorIndex = parsed[0].indexOf("actorId");
    const actors = new Set(parsed.slice(1).map((fields) => fields[actorIndex]));
    expect(actors.has(ctx.adminA.id)).toBe(false);
    expect(actors.has(ctx.adminB.id)).toBe(false);
  });

  it("MEMBER sees only own rows and cannot broaden", async () => {
    const res = await getExport(memberM1());
    expect(res.status).toBe(200);
    expect(rowIds(parseCsv(res.text))).toEqual(await listIds(memberM1(), ""));
    // Foreign actor/company parameters are ignored: the forced
    // self-scope answers identically, never with foreign rows and
    // never with an oracle signal.
    const broadened = await getExport(memberM1(), `?actorId=${ctx.memberM2.id}&companyId=${ctx.companyB.id}`);
    expect(broadened.status).toBe(200);
    expect(rowIds(parseCsv(broadened.text))).toEqual(rowIds(parseCsv(res.text)));
  });
});

describe("filters and validation", () => {
  it("all read filters behave identically", async () => {
    for (const query of [
      "?resource=CATEGORY",
      "?action=CREATED",
      "?outcome=SUCCESS",
      "?role=MEMBER",
      "?from=2000-01-01T00:00:00.000Z",
      `?resourceId=${ctx.escapeRow.resourceId}`,
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await getExport(adminA(), query);
      expect(res.status).toBe(200);
      // eslint-disable-next-line no-await-in-loop
      expect(rowIds(parseCsv(res.text))).toEqual(await listIds(adminA(), query));
    }
  });

  it("invalid values 422 like the read endpoint", async () => {
    for (const query of [
      "?actorId=nope",
      "?resourceId=nope",
      "?companyId=nope",
      "?resource=SPACESHIP",
      "?action=HACK",
      "?outcome=MAYBE",
      "?role=OWNER",
      "?from=not-a-date",
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await getExport(adminA(), query);
      expect(res.status).toBe(422);
    }
    const ghost = await getExport(superHeaders(), "?companyId=11111111-1111-1111-1111-111111111111");
    expect(ghost.status).toBe(404);
  });

  it("tenant smuggling cannot broaden scope", async () => {
    const res = await request(app)
      .get(`/api/v1/audit-logs/export?companyId=${ctx.companyB.id}`)
      .set({ ...adminA(), "x-company-id": ctx.companyB.id });
    expect(res.status).toBe(200);
    const parsed = parseCsv(res.text);
    const companyIndex = parsed[0].indexOf("companyId");
    expect(parsed.slice(1).every((fields) => fields[companyIndex] === ctx.companyA.id)).toBe(true);
  });
});

describe("CSV shape and safety", () => {
  it("serves CSV with a deterministic safe filename", async () => {
    const res = await getExport(superHeaders(), `?actorId=${ctx.memberM1.id}&resource=USER`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv; charset=utf-8$/);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="audit-logs-\d{8}T\d{6}Z\.csv"$/);
  });

  it("header contains exactly the safe projection", async () => {
    const res = await getExport(superHeaders(), `?actorId=${ctx.memberM1.id}&resource=USER`);
    expect(parseCsv(res.text)[0]).toEqual([...CSV_COLUMNS]);
  });

  it("escapes commas, quotes, and newlines inside one cell", async () => {
    const res = await getExport(memberM1(), `?resourceId=${ctx.escapeRow.resourceId}`);
    expect(res.status).toBe(200);
    const parsed = parseCsv(res.text);
    expect(parsed).toHaveLength(2);
    const details = JSON.parse(parsed[1][parsed[0].indexOf("details")]);
    expect(details).toMatchObject({ note: 'comma, "quote"\nnewline', seed: RUN });
  });

  it("serializes nulls as empty cells", async () => {
    const res = await getExport(superHeaders(), `?resource=REVIEW&actorId=${ctx.memberM2.id}`);
    expect(res.status).toBe(200);
    const parsed = parseCsv(res.text);
    const header = parsed[0];
    const row = parsed.find((fields) => fields[0] === ctx.nullRow.id);
    expect(row).toBeTruthy();
    expect(row[header.indexOf("actorEmail")]).toBe("");
    expect(row[header.indexOf("details")]).toBe("");
    expect(row[header.indexOf("resourceId")]).toBe(ctx.nullRow.resourceId);
  });

  it("neutralizes spreadsheet formula triggers", async () => {
    const res = await getExport(superHeaders(), `?companyId=${ctx.companyA.id}&resource=USER&role=MEMBER`);
    expect(res.status).toBe(200);
    for (const email of [`=evil-${RUN}@example.test`, `+evil-${RUN}@example.test`, `-evil-${RUN}@example.test`, `@evil-${RUN}@example.test`]) {
      expect(res.text).toContain(`'${email}`);
    }
  });

  it("orders newest-first with the read endpoint's tie-break", async () => {
    const first = await seedRow({ actorId: ctx.adminA.id, actorRole: "ADMIN", companyId: ctx.companyA.id, action: "CREATED", resource: "CATEGORY" });
    const second = await seedRow({ actorId: ctx.adminA.id, actorRole: "ADMIN", companyId: ctx.companyA.id, action: "CREATED", resource: "CATEGORY" });
    const query = `?resource=CATEGORY&actorId=${ctx.adminA.id}`;
    const exported = parseCsv((await getExport(adminA(), query)).text).slice(1).map((fields) => fields[0]);
    const listed = (await getList(adminA(), query)).body.data.logs.map((l) => l.id);
    expect(exported).toEqual(listed);
    expect(exported.indexOf(second.id)).toBeLessThan(exported.indexOf(first.id));
  });

  it("exports no hidden columns or secrets", async () => {
    const res = await getExport(superHeaders(), `?companyId=${ctx.companyA.id}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/passwordHash|refreshToken/i);
  });

  it("empty results yield a valid header-only document", async () => {
    const res = await getExport(adminA(), `?actorId=${ctx.adminB.id}`);
    expect(res.status).toBe(200);
    expect(parseCsv(res.text)).toHaveLength(1);
    expect(parseCsv(res.text)[0]).toEqual([...CSV_COLUMNS]);
  });
});

describe("lifecycle and retention coexistence", () => {
  it("deleted-company platform audits stay exportable; gone companies 404", async () => {
    const platform = await getExport(superHeaders(), "?companyId=null&resource=COMPANY&action=DELETED");
    expect(platform.status).toBe(200);
    expect(platform.text).toContain(ctx.companyE.id);
    const gone = await getExport(superHeaders(), `?companyId=${ctx.companyE.id}`);
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe("COMPANY_NOT_FOUND");
  });

  it("retention cleanup and policy reads are unaffected by exports", async () => {
    const before = await getExport(superHeaders(), "?limit=5");
    expect(before.status).toBe(200);
    const policyBefore = await request(app).get("/api/v1/audit-retention").set(superHeaders());
    expect(policyBefore.status).toBe(200);
    const result = await runRetentionCleanup();
    expect(typeof result.deleted).toBe("number");
    const policyAfter = await request(app).get("/api/v1/audit-retention").set(superHeaders());
    expect(policyAfter.status).toBe(200);
    expect(policyAfter.body.data.retention.policy).toBe(policyBefore.body.data.retention.policy);
  });

  it("the export size boundary is enforced", async () => {
    const viewer = { id: ctx.superAdmin.id, roles: ["SUPER_ADMIN"], companyId: null };
    await expect(exportAuditLogs(viewer, { companyId: ctx.companyA.id }, { maxRows: 1 })).rejects.toMatchObject({
      code: "AUDIT_EXPORT_TOO_LARGE",
    });
    const ok = await exportAuditLogs(viewer, { companyId: ctx.companyA.id }, { maxRows: 100000 });
    expect(ok.logs.length).toBeGreaterThan(1);
  });

  it("no DELETE export surface exists", async () => {
    expect((await request(app).delete("/api/v1/audit-logs/export").set(superHeaders())).status).toBe(404);
    expect((await request(app).delete("/api/v1/audit-logs").set(superHeaders())).status).toBe(404);
  });
});

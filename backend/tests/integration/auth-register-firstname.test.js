import { describe, it, expect } from "vitest";
import request from "supertest";

import app from "../../src/app.js";

/**
 * Mandatory firstName on customer registration (live MySQL):
 * POST /api/v1/auth/register requires a trimmed non-empty firstName.
 * Backend is authoritative — direct API requests cannot bypass it.
 */

const RUN = `TSTRFN${Date.now().toString(36).toUpperCase()}`;
const emailFor = (tag) => `${RUN.toLowerCase()}-${tag}@example.test`;

async function login(email, password = "TestPass123!") {
  return request(app).post("/api/v1/auth/login").send({ email, password });
}

describe("registration requires firstName", () => {
  it("succeeds with a valid first name and persists it", async () => {
    const email = emailFor("valid");
    const registered = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "TestPass123!",
      firstName: "Aarav",
      lastName: "Tester",
    });
    expect(registered.status).toBe(201);
    expect(registered.body.data.user).toMatchObject({ email, firstName: "Aarav" });

    // Token issuance + refresh-cookie behavior unchanged: login works and
    // sets an HttpOnly refresh cookie.
    const loggedIn = await login(email);
    expect(loggedIn.status).toBe(200);
    expect(typeof loggedIn.body.data.accessToken).toBe("string");
    const cookies = loggedIn.headers["set-cookie"] || [];
    const refresh = cookies.find((c) => c.startsWith("refresh_token="));
    expect(refresh).toMatch(/^refresh_token=.+/);
    expect(cookies.join(";")).toMatch(/httponly/i);
  });

  it("rejects a missing first name without creating a user", async () => {
    const email = emailFor("missing");
    const res = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "TestPass123!",
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.some((d) => d.path === "firstName")).toBe(true);

    // No user was persisted: login fails with invalid credentials.
    const attempted = await login(email);
    expect(attempted.status).toBe(401);
  });

  it("rejects an empty first name", async () => {
    const email = emailFor("empty");
    const res = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "TestPass123!",
      firstName: "",
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details.some((d) => d.path === "firstName")).toBe(true);

    expect((await login(email)).status).toBe(401);
  });

  it("rejects a whitespace-only first name", async () => {
    const email = emailFor("spaces");
    const res = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "TestPass123!",
      firstName: "   ",
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details.some((d) => d.path === "firstName")).toBe(true);

    expect((await login(email)).status).toBe(401);
  });

  it("normalizes surrounding whitespace", async () => {
    const email = emailFor("trim");
    const res = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "TestPass123!",
      firstName: "  Aarav  ",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.firstName).toBe("Aarav");
  });

  it("keeps existing email/password validation intact", async () => {
    const badEmail = await request(app).post("/api/v1/auth/register").send({
      email: "not-an-email",
      password: "TestPass123!",
      firstName: "Aarav",
    });
    expect(badEmail.status).toBe(422);

    const shortPassword = await request(app).post("/api/v1/auth/register").send({
      email: emailFor("shortpw"),
      password: "short",
      firstName: "Aarav",
    });
    expect(shortPassword.status).toBe(422);
    expect((await login(emailFor("shortpw"))).status).toBe(401);
  });
});

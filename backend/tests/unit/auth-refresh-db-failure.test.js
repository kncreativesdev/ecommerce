import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";

/**
 * Refresh-session database-failure handling (no live database).
 *
 * The persistent rotation design must never falsely claim a successful
 * rotation or revocation when the database is unavailable: every
 * repository failure propagates instead of resolving with tokens,
 * a success message, or a neutral 401 that would masquerade a
 * connection failure as an invalid token.
 *
 * Implementation note: backend sources are CommonJS loaded through
 * Node's `require` cache, while vitest test files are ESM — an ESM
 * `import` of the repository yields a different instance than the one
 * the service closes over, so `vi.mock`/`spyOn` on the ESM side is
 * invisible to the service (verified by probe). These tests therefore
 * `require` the service and repository through the same native cache
 * entry and stub with `vi.spyOn`. Same vitest infrastructure, no new
 * framework, no live rows.
 *
 * Existing integration suites (auth-refresh-rotation,
 * auth-refresh-concurrency) prove the happy path, replay rejection,
 * logout revocation, and exactly-once concurrency against live MySQL.
 */

const require = createRequire(import.meta.url);
const authService = require("../../src/modules/auth/auth.service.js");
const authRepository = require("../../src/modules/auth/auth.repository.js");
const { signRefreshToken } = require("../../src/utils/jwt.js");
const { hashPassword } = require("../../src/modules/auth/auth.utils.js");

function fakeActiveUser(overrides = {}) {
  return {
    id: "u-db-failure-1",
    email: "db-failure@example.test",
    firstName: "Db",
    lastName: "Failure",
    phone: null,
    isActive: true,
    company: null,
    passwordChangedAt: null,
    roles: [{ role: { name: "CUSTOMER" } }],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function dbDown() {
  const err = new Error("simulated database connection failure");
  err.code = "P1001";
  return err;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("refresh-session database failures never claim success", () => {
  it("login propagates a session-persistence failure instead of returning tokens", async () => {
    // The credential check passes so the flow reaches the session write,
    // which then fails. Login must fail — never return an untracked pair.
    const passwordHash = await hashPassword("TestPass123!");
    vi.spyOn(authRepository, "findUsersByEmail").mockResolvedValue([
      { ...fakeActiveUser(), passwordHash, companyId: null },
    ]);
    vi.spyOn(authRepository, "createRefreshSessionTx").mockRejectedValue(dbDown());

    await expect(
      authService.login({ email: "db-failure@example.test", password: "TestPass123!" })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/database connection failure/i),
    });
    expect(authRepository.createRefreshSessionTx).toHaveBeenCalledTimes(1);
  });

  it("refresh propagates a consume failure without minting a successor (no false rotation)", async () => {
    const token = signRefreshToken(fakeActiveUser().id);
    vi.spyOn(authRepository, "findUserById").mockResolvedValue(fakeActiveUser());
    vi.spyOn(authRepository, "consumeRefreshSession").mockRejectedValue(dbDown());
    vi.spyOn(authRepository, "createRefreshSessionTx").mockResolvedValue({
      id: "should-not-exist",
    });

    const err = await authService.refresh(token).catch((e) => e);
    expect(err).toMatchObject({
      message: expect.stringMatching(/database connection failure/i),
    });
    // The failure is a server error, not the neutral invalid-token 401 —
    // callers (and operators) must not mistake an outage for a bad token.
    expect(err && err.code).not.toBe("AUTH_REFRESH_TOKEN_INVALID");
    expect(authRepository.consumeRefreshSession).toHaveBeenCalledTimes(1);
    expect(authRepository.createRefreshSessionTx).not.toHaveBeenCalled();
  });

  it("refresh propagates a successor-creation failure after a successful consume (old stays burned, no replay restore)", async () => {
    const token = signRefreshToken(fakeActiveUser().id);
    vi.spyOn(authRepository, "findUserById").mockResolvedValue(fakeActiveUser());
    vi.spyOn(authRepository, "consumeRefreshSession").mockResolvedValue(true);
    vi.spyOn(authRepository, "createRefreshSessionTx").mockRejectedValue(dbDown());

    await expect(authService.refresh(token)).rejects.toMatchObject({
      message: expect.stringMatching(/database connection failure/i),
    });
    // The presented session was consumed before the mint failed: the
    // caller gets an error (must re-login), never a token pair, and a
    // replay of the same token cannot resurrect the burned session
    // because consumption is not rolled back into success.
    expect(authRepository.consumeRefreshSession).toHaveBeenCalledTimes(1);
    expect(authRepository.createRefreshSessionTx).toHaveBeenCalledTimes(1);
  });

  it("logout propagates a revocation failure instead of falsely reporting success", async () => {
    const token = signRefreshToken(fakeActiveUser().id);
    vi.spyOn(authRepository, "revokeRefreshSession").mockRejectedValue(dbDown());

    await expect(authService.logout(token)).rejects.toMatchObject({
      message: expect.stringMatching(/database connection failure/i),
    });
    expect(authRepository.revokeRefreshSession).toHaveBeenCalledTimes(1);
  });
});

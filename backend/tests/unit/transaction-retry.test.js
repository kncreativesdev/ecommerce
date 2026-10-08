import { describe, it, expect } from "vitest";

import { withTransactionRetry } from "../../src/modules/orders/orders.service.js";

/**
 * Phase 2C-30 unit coverage for the bulk-status deadlock retry.
 * Pure semantics (no DB): only the transient Prisma/MySQL
 * transaction conflict (P2034) is retried, bounded at 4 attempts.
 */

function p2034() {
  const err = new Error("Transaction failed due to a write conflict or a deadlock");
  err.code = "P2034";
  return err;
}

describe("withTransactionRetry", () => {
  it("returns the first-try value with a single call", async () => {
    let calls = 0;
    const result = await withTransactionRetry(async () => {
      calls += 1;
      return { outcome: "ok" };
    });
    expect(result).toEqual({ outcome: "ok" });
    expect(calls).toBe(1);
  });

  it("retries P2034 victims and returns the eventual value", async () => {
    let calls = 0;
    const result = await withTransactionRetry(async () => {
      calls += 1;
      if (calls < 3) {
        throw p2034();
      }
      return "committed";
    });
    expect(result).toBe("committed");
    expect(calls).toBe(3);
  });

  it("propagates non-P2034 errors immediately without retry", async () => {
    for (const failure of [Object.assign(new Error("conflict"), { code: "P2002" }), new Error("boom"), null, undefined]) {
      let calls = 0;
      const attempt = withTransactionRetry(async () => {
        calls += 1;
        throw failure;
      });
      await expect(attempt).rejects.toBe(failure);
      expect(calls).toBe(1);
    }
  });

  it("gives up after four attempts and rethrows the P2034", async () => {
    let calls = 0;
    const attempt = withTransactionRetry(async () => {
      calls += 1;
      throw p2034();
    });
    await expect(attempt).rejects.toMatchObject({ code: "P2034" });
    expect(calls).toBe(4);
  });
});

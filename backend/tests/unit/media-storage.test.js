import { describe, it, expect, afterAll } from "vitest";

import { localStorageAdapter } from "../../src/modules/media/storage/local.storage.js";

/**
 * Phase 2C-9 storage-adapter safety (real filesystem, self-cleaning
 * unique paths under the configured uploads root — the same root the
 * API serves, so traversal behavior is verified, not mocked).
 */

const RUN = `tstms${Date.now().toString(36)}`;
const written = [];

describe("local storage traversal guard", () => {
  it("writes and removes inside the root", async () => {
    const ref = await localStorageAdapter.save(`__probe__/${RUN}`, "a.webp", Buffer.from("img"));
    written.push(ref);
    expect(ref.startsWith(`__probe__/${RUN}/`)).toBe(true);
    expect(await localStorageAdapter.exists(ref)).toBe(true);
    expect(await localStorageAdapter.remove(ref)).toBe(true);
    expect(await localStorageAdapter.exists(ref)).toBe(false);
  });

  it("refuses paths escaping the upload root", async () => {
    await expect(localStorageAdapter.save(`../__escape__${RUN}`, "a.webp", Buffer.from("x"))).rejects.toThrow(
      /escapes the upload root/
    );
    await expect(localStorageAdapter.remove(`../app.js`)).rejects.toThrow(/escapes the upload root/);
  });

  it("remove of a missing file reports false instead of throwing", async () => {
    expect(await localStorageAdapter.remove(`__probe__/${RUN}/nope.webp`)).toBe(false);
  });
});

afterAll(async () => {
  for (const ref of written.splice(0)) {
    try {
      await localStorageAdapter.remove(ref);
    } catch {
      // Best-effort cleanup.
    }
  }
});

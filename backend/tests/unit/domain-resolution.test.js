import { describe, it, expect } from "vitest";

import {
  normalizeHostname,
  decidePublicCompanyContext,
} from "../../src/middleware/companyContext.js";

/**
 * Phase 2C-11 domain normalization + public-decision tests (pure, no
 * database). Live resolution against CompanyDomain rows is covered by
 * tests/integration/domain-resolution.test.js.
 */

describe("normalizeHostname", () => {
  it("lowercases hostnames", () => {
    expect(normalizeHostname("Shop-A.Example.COM")).toBe("shop-a.example.com");
  });

  it("removes a single trailing dot", () => {
    expect(normalizeHostname("example.com.")).toBe("example.com");
    expect(normalizeHostname(".")).toBeNull();
  });

  it("strips local development ports", () => {
    expect(normalizeHostname("localhost:3000")).toBe("localhost");
    expect(normalizeHostname("127.0.0.1:5173")).toBe("127.0.0.1");
    expect(normalizeHostname("shop-a.test:80")).toBe("shop-a.test");
  });

  it("accepts bracketed IPv6 with optional port", () => {
    expect(normalizeHostname("[::1]:3000")).toBe("::1");
    expect(normalizeHostname("[::1]")).toBe("::1");
    expect(normalizeHostname("[::1")).toBeNull();
  });

  it("rejects malformed and empty values", () => {
    for (const bad of ["", "   ", null, undefined, 123, "a..com", "-bad.com", "bad-.com"]) {
      expect(normalizeHostname(bad)).toBeNull();
    }
    expect(normalizeHostname(`a${"b".repeat(63)}.com`)).toBeNull();
    expect(normalizeHostname(`${"x".repeat(250)}.com`)).toBeNull();
    expect(normalizeHostname("host:abc")).toBeNull();
    expect(normalizeHostname("a:b:c")).toBeNull();
  });

  it("rejects full URLs, paths, and credentialed strings", () => {
    for (const bad of [
      "https://example.com",
      "http://example.com/path",
      "example.com/path",
      "example.com?x=1",
      "example.com#frag",
      "user@example.com",
      "exa mple.com",
    ]) {
      expect(normalizeHostname(bad)).toBeNull();
    }
  });

  it("rejects company UUID lookalikes as tenant selectors", () => {
    expect(normalizeHostname("35b5a215-0cf3-42db-ba42-6fac6656a708")).toBeNull();
  });
});

describe("decidePublicCompanyContext", () => {
  const row = { company: { id: "c-1", name: "Shop A", status: "ACTIVE" } };

  it("attaches resolved companies with the domain source", () => {
    expect(decidePublicCompanyContext("shop-a.test", row)).toEqual({
      attached: true,
      context: {
        companyId: "c-1",
        company: { id: "c-1", name: "Shop A", status: "ACTIVE" },
        isPlatformContext: false,
        source: "domain",
      },
    });
  });

  it("skips missing hosts, rows, and companies without failing", () => {
    expect(decidePublicCompanyContext(null, row)).toEqual({ attached: false });
    expect(decidePublicCompanyContext("shop-a.test", null)).toEqual({ attached: false });
    expect(decidePublicCompanyContext("shop-a.test", {})).toEqual({ attached: false });
    expect(decidePublicCompanyContext("shop-a.test", { company: null })).toEqual({ attached: false });
  });
});

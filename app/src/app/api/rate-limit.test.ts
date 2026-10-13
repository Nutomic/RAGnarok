import { describe, expect, it } from "vitest";
import { clientIp } from "./rate-limit";

describe("clientIp", () => {
  it("uses the first entry of x-forwarded-for", () => {
    const req = new Request("http://localhost/api/search", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  it("throws when no proxy header exists so the gap is noticed immediately", () => {
    const req = new Request("http://localhost/api/search");
    expect(() => clientIp(req)).toThrow(/x-forwarded-for/);
  });
});

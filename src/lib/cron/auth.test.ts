import { describe, it, expect } from "vitest";
import { isCronAuthorized } from "./auth";

const req = (headers: Record<string, string>) => ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } });

describe("isCronAuthorized", () => {
  it("accepts the x-cron-secret header and the Bearer form", () => {
    expect(isCronAuthorized(req({ "x-cron-secret": "s3" }), "s3")).toBe(true);
    expect(isCronAuthorized(req({ authorization: "Bearer s3" }), "s3")).toBe(true);
  });
  it("refuses a wrong or missing secret, and refuses everything when none is configured", () => {
    expect(isCronAuthorized(req({ "x-cron-secret": "nope" }), "s3")).toBe(false);
    expect(isCronAuthorized(req({}), "s3")).toBe(false);
    expect(isCronAuthorized(req({ "x-cron-secret": "" }), "")).toBe(false);
    expect(isCronAuthorized(req({ "x-cron-secret": "s3" }), undefined)).toBe(false);
  });
});

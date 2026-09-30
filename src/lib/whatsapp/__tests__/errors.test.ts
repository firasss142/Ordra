import { describe, it, expect } from "vitest";
import { classifyGraphError, WhatsAppApiError } from "../errors";

/**
 * Meta's numbering is the contract. A mis-classified code turns a revoked
 * token into a retry storm, or a "this number has no WhatsApp" into six
 * retries against a customer who can never receive it.
 */
const err = (code: number | null, opts: { httpStatus?: number; subcode?: number } = {}) =>
  new WhatsAppApiError("x", { code, httpStatus: opts.httpStatus ?? 400, subcode: opts.subcode ?? null });

describe("classifyGraphError", () => {
  it.each([4, 17, 613, 80007, 130429, 131056, 131016])("code %i is a throttle, retryable", (code) => {
    expect(classifyGraphError(err(code))).toMatchObject({ kind: "throttle", retryable: true });
  });

  it("HTTP 429 and 5xx are throttle / transient", () => {
    expect(classifyGraphError(err(null, { httpStatus: 429 }))).toMatchObject({ kind: "throttle", retryable: true });
    expect(classifyGraphError(err(null, { httpStatus: 503 }))).toMatchObject({ kind: "transient", retryable: true });
  });

  it("a timeout is transient", () => {
    const e = new WhatsAppApiError("timeout", { code: null, httpStatus: null, isTimeout: true });
    expect(classifyGraphError(e)).toMatchObject({ kind: "transient", retryable: true });
  });

  it("131000 is transient but capped at 3 attempts", () => {
    expect(classifyGraphError(err(131000))).toMatchObject({ kind: "transient", retryable: true, maxAttempts: 3 });
  });

  it.each([190, 10, 200, 250, 299])("code %i is an auth failure that pauses the market", (code) => {
    expect(classifyGraphError(err(code))).toMatchObject({
      kind: "auth",
      retryable: false,
      pauseMarket: "auth_failed",
    });
  });

  it("131047 is the closed customer-service window", () => {
    expect(classifyGraphError(err(131047))).toMatchObject({ kind: "window_closed", retryable: false });
  });

  it("131026 is undeliverable (no WhatsApp on that number)", () => {
    expect(classifyGraphError(err(131026))).toMatchObject({ kind: "undeliverable", retryable: false });
  });

  it("131049 is the per-user marketing cap", () => {
    expect(classifyGraphError(err(131049))).toMatchObject({ kind: "marketing_cap", retryable: false });
  });

  it.each([132000, 132001, 132015, 132069])("code %i is a template problem", (code) => {
    expect(classifyGraphError(err(code))).toMatchObject({ kind: "template", retryable: false });
  });

  it.each([100, 131008, 131009, 131021, 131051])("code %i is an invalid request, never retried", (code) => {
    expect(classifyGraphError(err(code))).toMatchObject({ kind: "invalid_request", retryable: false });
  });

  it("131048 (spam rate) defers the market two hours", () => {
    expect(classifyGraphError(err(131048))).toMatchObject({
      kind: "spam_pause",
      retryable: true,
      deferMarketMs: 2 * 60 * 60 * 1000,
    });
  });

  it.each([131031, 131042, 131037])("code %i pauses the market's config", (code) => {
    expect(classifyGraphError(err(code))).toMatchObject({ kind: "account_paused", pauseMarket: "paused" });
  });

  it("anything else is unknown and not retried", () => {
    expect(classifyGraphError(err(999999))).toMatchObject({ kind: "unknown", retryable: false });
    expect(classifyGraphError(new Error("boom"))).toMatchObject({ kind: "unknown", retryable: false });
  });
});

describe("WhatsAppApiError", () => {
  it("redacts a token echoed in the message", () => {
    const e = new WhatsAppApiError("bad call https://graph.facebook.com/x?access_token=EAAsecret&y=1", { code: 100 });
    expect(e.message).not.toContain("EAAsecret");
  });
});

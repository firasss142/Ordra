import { describe, it, expect } from "vitest";
import { assertSendAllowed } from "../gate";

/**
 * The choke point. Every send — agent, automatic, campaign — passes here
 * immediately before the Graph call, and the refusal order is fixed: a
 * paused market beats a bad phone beats an opt-out beats an undeliverable
 * number beats a closed window, because each earlier one makes the later
 * ones moot.
 */
const NOW = new Date("2026-09-25T12:00:00Z");
const base = {
  configStatus: "active" as const,
  phoneE164: "21698765432" as string | null,
  optedOutAt: null as string | null,
  undeliverableAt: null as string | null,
  lastInboundAt: null as string | null,
  mode: "template" as const,
  notBefore: null as string | null,
  now: NOW,
};

describe("assertSendAllowed", () => {
  it("allows a template to a clean number", () => {
    expect(assertSendAllowed(base)).toEqual({ ok: true, windowOpen: false });
  });

  it("refuses in priority order", () => {
    expect(assertSendAllowed({ ...base, configStatus: "paused", phoneE164: null, optedOutAt: "x" })).toMatchObject({ ok: false, reason: "config_inactive" });
    expect(assertSendAllowed({ ...base, configStatus: "auth_failed" })).toMatchObject({ ok: false, reason: "config_inactive" });
    expect(assertSendAllowed({ ...base, phoneE164: null, optedOutAt: "x" })).toMatchObject({ ok: false, reason: "invalid_phone" });
    expect(assertSendAllowed({ ...base, optedOutAt: "2026-09-20T00:00:00Z", undeliverableAt: "x" })).toMatchObject({ ok: false, reason: "opted_out" });
    expect(assertSendAllowed({ ...base, undeliverableAt: "2026-09-20T00:00:00Z" })).toMatchObject({ ok: false, reason: "undeliverable" });
  });

  it("free text needs the 24 h window; a template never does", () => {
    expect(assertSendAllowed({ ...base, mode: "text" })).toMatchObject({ ok: false, reason: "window_closed" });
    expect(assertSendAllowed({ ...base, mode: "image" })).toMatchObject({ ok: false, reason: "window_closed" });
    expect(assertSendAllowed({ ...base, mode: "text", lastInboundAt: "2026-09-25T00:00:00Z" })).toEqual({ ok: true, windowOpen: true });
    expect(assertSendAllowed({ ...base, mode: "template", lastInboundAt: "2026-09-25T00:00:00Z" })).toEqual({ ok: true, windowOpen: true });
    expect(assertSendAllowed({ ...base, mode: "text", lastInboundAt: "2026-09-24T11:00:00Z" })).toMatchObject({ ok: false, reason: "window_closed" });
  });

  it("defers a row whose not_before is in the future", () => {
    expect(assertSendAllowed({ ...base, notBefore: "2026-09-25T13:00:00Z" })).toMatchObject({ ok: false, reason: "deferred" });
    expect(assertSendAllowed({ ...base, notBefore: "2026-09-25T11:00:00Z" })).toMatchObject({ ok: true });
  });
});

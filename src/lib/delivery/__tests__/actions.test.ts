import { describe, test, expect } from "vitest";
import {
  AGENT_ACTION_TYPES,
  OUTCOMES_BY_ACTION,
  NOTE_MAX,
  parseActionBody,
} from "../actions";

const NOW = Date.parse("2026-09-13T10:00:00Z");

describe("OUTCOMES_BY_ACTION", () => {
  test("customer calls offer exactly the seven customer outcomes", () => {
    expect(OUTCOMES_BY_ACTION.call_customer).toEqual([
      "reached_will_receive",
      "reached_reschedule",
      "reached_wants_cancel",
      "reached_address_fix",
      "no_answer",
      "wrong_number",
      "phone_off",
    ]);
  });

  test("courier and branch calls share the five carrier outcomes", () => {
    const carrier = [
      "reattempt_promised",
      "courier_no_answer",
      "parcel_located",
      "return_confirmed",
      "info_passed",
    ];
    expect(OUTCOMES_BY_ACTION.call_courier).toEqual(carrier);
    expect(OUTCOMES_BY_ACTION.call_branch).toEqual(carrier);
  });

  test("the system-only proactive task is not something a person can record", () => {
    expect(AGENT_ACTION_TYPES).not.toContain("proactive_call_task");
  });
});

describe("parseActionBody", () => {
  test("a customer call derives the phone channel and trims the note", () => {
    const r = parseActionBody(
      { action_type: "call_customer", outcome: "no_answer", note: "  rappel demain  " },
      NOW,
    );
    expect(r).toEqual({
      ok: true,
      value: {
        action_type: "call_customer",
        channel: "phone",
        outcome: "no_answer",
        note: "rappel demain",
        next_action_at: null,
        template_key: null,
      },
    });
  });

  test("the channel is never taken from the body", () => {
    const r = parseActionBody(
      { action_type: "call_courier", outcome: "parcel_located", channel: "whatsapp" },
      NOW,
    );
    expect(r.ok && r.value.channel).toBe("phone");
  });

  test("an outcome that belongs to another action type is refused", () => {
    const r = parseActionBody({ action_type: "call_courier", outcome: "reached_will_receive" }, NOW);
    expect(r).toEqual({ ok: false, error: "invalid_outcome" });
  });

  test("unknown and system action types are refused", () => {
    expect(parseActionBody({ action_type: "proactive_call_task", outcome: "pending" }, NOW)).toEqual({
      ok: false,
      error: "invalid_action_type",
    });
    expect(parseActionBody({ action_type: "sms", outcome: "sent" }, NOW).ok).toBe(false);
    expect(parseActionBody(null, NOW).ok).toBe(false);
  });

  test("a WhatsApp send is always outcome 'sent' and needs a known template", () => {
    const ok = parseActionBody({ action_type: "whatsapp_customer", template_key: "before_delivery" }, NOW);
    expect(ok).toEqual({
      ok: true,
      value: {
        action_type: "whatsapp_customer",
        channel: "whatsapp",
        outcome: "sent",
        note: null,
        next_action_at: null,
        template_key: "before_delivery",
      },
    });
    expect(parseActionBody({ action_type: "whatsapp_customer", template_key: "promo" }, NOW)).toEqual({
      ok: false,
      error: "invalid_template",
    });
  });

  test("a template key on a call is refused rather than silently stored", () => {
    const r = parseActionBody(
      { action_type: "call_customer", outcome: "no_answer", template_key: "before_delivery" },
      NOW,
    );
    expect(r).toEqual({ ok: false, error: "invalid_template" });
  });

  test("a note-only action needs text", () => {
    expect(parseActionBody({ action_type: "note", note: "   " }, NOW)).toEqual({
      ok: false,
      error: "note_required",
    });
    const r = parseActionBody({ action_type: "note", note: "client en voyage" }, NOW);
    expect(r.ok && r.value.outcome).toBe("none");
    expect(r.ok && r.value.channel).toBe("none");
  });

  test(`notes longer than ${NOTE_MAX} characters are refused`, () => {
    const r = parseActionBody(
      { action_type: "call_customer", outcome: "no_answer", note: "x".repeat(NOTE_MAX + 1) },
      NOW,
    );
    expect(r).toEqual({ ok: false, error: "note_too_long" });
  });

  test("next_action_at must be a real date, not in the past, within 30 days", () => {
    const base = { action_type: "call_customer", outcome: "reached_reschedule" };
    const in2h = new Date(NOW + 2 * 3600e3).toISOString();
    const ok = parseActionBody({ ...base, next_action_at: in2h }, NOW);
    expect(ok.ok && ok.value.next_action_at).toBe(in2h);

    expect(parseActionBody({ ...base, next_action_at: "demain" }, NOW)).toEqual({
      ok: false,
      error: "invalid_next_action_at",
    });
    expect(
      parseActionBody({ ...base, next_action_at: new Date(NOW - 3600e3).toISOString() }, NOW),
    ).toEqual({ ok: false, error: "invalid_next_action_at" });
    expect(
      parseActionBody({ ...base, next_action_at: new Date(NOW + 31 * 86400e3).toISOString() }, NOW),
    ).toEqual({ ok: false, error: "invalid_next_action_at" });
  });
});

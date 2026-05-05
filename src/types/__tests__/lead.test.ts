import { describe, it, expect } from "vitest";
import {
  CREATABLE_LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_SOURCES,
  LEAD_LOST_REASONS,
  TERMINAL_LEAD_STATUSES,
  isTerminalLeadStatus,
  isValidLeadTransition,
} from "@/types/lead";

describe("LEAD_STATUSES", () => {
  it("contains exactly 10 statuses", () => {
    expect(LEAD_STATUSES).toHaveLength(10);
  });

  it("contains pre-contact and contact-attempt statuses", () => {
    expect(LEAD_STATUSES).toEqual(
      expect.arrayContaining([
        "new",
        "assigned",
        "attempt_1",
        "attempt_2",
        "attempt_3",
        "callback_scheduled",
        "qualified",
      ])
    );
  });

  it("contains terminal outcomes won/lost/archived", () => {
    expect(LEAD_STATUSES).toEqual(
      expect.arrayContaining(["won", "lost", "archived"])
    );
  });
});

describe("LEAD_SOURCES", () => {
  it("contains intake channels for v1 + webhook-ready schema", () => {
    expect(LEAD_SOURCES).toEqual(
      expect.arrayContaining([
        "manual_call",
        "facebook_comment",
        "facebook_dm",
        "instagram_dm",
        "whatsapp",
        "tiktok_comment",
        "campaign",
        "other",
      ])
    );
  });

  it("does not allow campaign as a manually creatable source", () => {
    expect(CREATABLE_LEAD_SOURCES).not.toContain("campaign");
  });
});

describe("LEAD_LOST_REASONS", () => {
  it("contains all 8 lost reason values", () => {
    expect(LEAD_LOST_REASONS).toHaveLength(8);
    expect(LEAD_LOST_REASONS).toEqual(
      expect.arrayContaining([
        "not_interested",
        "price",
        "unreachable",
        "competitor",
        "duplicate",
        "wrong_number",
        "spam",
        "autre",
      ])
    );
  });
});

describe("isTerminalLeadStatus", () => {
  it.each(["won", "lost", "archived"] as const)(
    "returns true for %s",
    (s) => {
      expect(isTerminalLeadStatus(s)).toBe(true);
    }
  );

  it.each([
    "new",
    "assigned",
    "attempt_1",
    "attempt_2",
    "attempt_3",
    "callback_scheduled",
    "qualified",
  ] as const)("returns false for %s", (s) => {
    expect(isTerminalLeadStatus(s)).toBe(false);
  });

  it("TERMINAL_LEAD_STATUSES has exactly the three terminals", () => {
    expect(TERMINAL_LEAD_STATUSES).toHaveLength(3);
    expect(TERMINAL_LEAD_STATUSES).toEqual(
      expect.arrayContaining(["won", "lost", "archived"])
    );
  });
});

describe("isValidLeadTransition", () => {
  it("allows new → assigned", () => {
    expect(isValidLeadTransition("new", "assigned")).toBe(true);
  });

  it("allows assigned → attempt_1", () => {
    expect(isValidLeadTransition("assigned", "attempt_1")).toBe(true);
  });

  it("allows attempt_1 → attempt_2", () => {
    expect(isValidLeadTransition("attempt_1", "attempt_2")).toBe(true);
  });

  it("allows attempt_2 → attempt_3", () => {
    expect(isValidLeadTransition("attempt_2", "attempt_3")).toBe(true);
  });

  it("allows attempt_* → callback_scheduled", () => {
    expect(isValidLeadTransition("attempt_1", "callback_scheduled")).toBe(true);
    expect(isValidLeadTransition("attempt_2", "callback_scheduled")).toBe(true);
    expect(isValidLeadTransition("attempt_3", "callback_scheduled")).toBe(true);
  });

  it("allows callback_scheduled back into attempts", () => {
    expect(isValidLeadTransition("callback_scheduled", "attempt_1")).toBe(true);
    expect(isValidLeadTransition("callback_scheduled", "attempt_2")).toBe(true);
    expect(isValidLeadTransition("callback_scheduled", "attempt_3")).toBe(true);
  });

  it("allows attempt_* and callback_scheduled → qualified", () => {
    expect(isValidLeadTransition("attempt_1", "qualified")).toBe(true);
    expect(isValidLeadTransition("attempt_2", "qualified")).toBe(true);
    expect(isValidLeadTransition("attempt_3", "qualified")).toBe(true);
    expect(isValidLeadTransition("callback_scheduled", "qualified")).toBe(true);
    expect(isValidLeadTransition("assigned", "qualified")).toBe(true);
  });

  it("allows qualified → won (conversion)", () => {
    expect(isValidLeadTransition("qualified", "won")).toBe(true);
  });

  it("blocks direct assigned → won (must qualify first)", () => {
    expect(isValidLeadTransition("assigned", "won")).toBe(false);
  });

  it("allows any pre-terminal → lost", () => {
    expect(isValidLeadTransition("assigned", "lost")).toBe(true);
    expect(isValidLeadTransition("attempt_1", "lost")).toBe(true);
    expect(isValidLeadTransition("attempt_3", "lost")).toBe(true);
    expect(isValidLeadTransition("callback_scheduled", "lost")).toBe(true);
    expect(isValidLeadTransition("qualified", "lost")).toBe(true);
  });

  it("allows any pre-terminal → archived", () => {
    expect(isValidLeadTransition("new", "archived")).toBe(true);
    expect(isValidLeadTransition("assigned", "archived")).toBe(true);
    expect(isValidLeadTransition("attempt_2", "archived")).toBe(true);
    expect(isValidLeadTransition("qualified", "archived")).toBe(true);
  });

  it("blocks attempt_1 → attempt_3 (no skipping)", () => {
    expect(isValidLeadTransition("attempt_1", "attempt_3")).toBe(false);
  });

  it("blocks terminal → anything", () => {
    expect(isValidLeadTransition("won", "assigned")).toBe(false);
    expect(isValidLeadTransition("won", "lost")).toBe(false);
    expect(isValidLeadTransition("lost", "assigned")).toBe(false);
    expect(isValidLeadTransition("lost", "won")).toBe(false);
    expect(isValidLeadTransition("archived", "assigned")).toBe(false);
    expect(isValidLeadTransition("archived", "won")).toBe(false);
  });

  it("blocks new → attempt_1 (must be assigned first)", () => {
    expect(isValidLeadTransition("new", "attempt_1")).toBe(false);
  });
});

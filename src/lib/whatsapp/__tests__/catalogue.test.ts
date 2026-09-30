import { describe, it, expect } from "vitest";
import { CATALOGUE, catalogueEntry, templateNameFor, SAMPLE_VALUES } from "../catalogue";
import { LIFECYCLE_EVENT_KEYS, TEMPLATE_VARIABLES } from "../types";

/**
 * The catalogue is submitted to Meta verbatim. Meta rejects a body that
 * starts or ends with a variable, a placeholder without an example, and a
 * placeholder numbered out of sequence — and a rejection costs a day on a new
 * account. These checks are the ones a reviewer cannot do by eye in Arabic.
 */
const placeholders = (s: string) => Array.from(s.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]));

describe("CATALOGUE", () => {
  it("has one entry per lifecycle event, each UTILITY", () => {
    for (const key of LIFECYCLE_EVENT_KEYS) {
      const entry = CATALOGUE.find((e) => e.eventKey === key);
      expect(entry, key).toBeDefined();
      expect(entry?.category).toBe("UTILITY");
    }
  });

  it("keeps the five agent texts and the two marketing ones", () => {
    const keys = CATALOGUE.map((e) => e.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "before_delivery",
        "courier_no_answer",
        "delayed_confirm_time",
        "returning_last_chance",
        "address_check",
        "product_share",
        "prospect_follow_up",
      ]),
    );
    expect(catalogueEntry("product_share")?.headerFormat).toBe("IMAGE");
    expect(catalogueEntry("product_share")?.category).toBe("MARKETING");
    expect(catalogueEntry("prospect_follow_up")?.category).toBe("MARKETING");
  });

  it.each(CATALOGUE.map((e) => [e.key, e] as const))("%s: placeholders are 1..n in both languages and match the variables", (_k, e) => {
    for (const lang of ["ar", "fr"] as const) {
      const found = placeholders(e.body[lang]);
      const expected = e.variables.map((_, i) => i + 1);
      // Every variable used at least once, numbered from 1, none skipped.
      expect(Array.from(new Set(found)).sort((a, b) => a - b), `${e.key}/${lang}`).toEqual(expected);
    }
  });

  it.each(CATALOGUE.map((e) => [e.key, e] as const))("%s: body neither starts nor ends with a variable", (_k, e) => {
    for (const lang of ["ar", "fr"] as const) {
      const b = e.body[lang].trim();
      expect(b.startsWith("{{"), `${e.key}/${lang} starts`).toBe(false);
      expect(b.endsWith("}}"), `${e.key}/${lang} ends`).toBe(false);
      expect(b.length).toBeLessThanOrEqual(1024);
    }
  });

  it("marketing entries carry an opt-out footer in both languages; utility ones do not", () => {
    for (const e of CATALOGUE) {
      if (e.category === "MARKETING") {
        expect(e.footer?.fr, e.key).toMatch(/STOP/);
        expect(e.footer?.ar, e.key).toMatch(/توقف/);
        expect(e.footer!.fr.length).toBeLessThanOrEqual(60);
        expect(e.footer!.ar.length).toBeLessThanOrEqual(60);
      } else {
        expect(e.footer, e.key).toBeUndefined();
      }
    }
  });

  it("only uses variables from the closed union, and has a sample for each", () => {
    for (const e of CATALOGUE) {
      for (const v of e.variables) {
        expect(TEMPLATE_VARIABLES).toContain(v);
        expect(SAMPLE_VALUES.fr[v]).toBeTruthy();
        expect(SAMPLE_VALUES.ar[v]).toBeTruthy();
      }
    }
  });

  it("names templates ordra_<key>_v1, Meta-legal (lowercase, underscores)", () => {
    for (const e of CATALOGUE) {
      const name = templateNameFor(e.key);
      expect(name).toBe(`ordra_${e.key}_v1`);
      expect(name).toMatch(/^[a-z0-9_]{1,512}$/);
    }
  });

  it("marks the agent set: the five texts plus product_share and prospect_follow_up; lifecycle ones are not agent-pickable", () => {
    const agent = CATALOGUE.filter((e) => e.agentVisible).map((e) => e.key);
    expect(agent).toEqual([
      "before_delivery",
      "courier_no_answer",
      "delayed_confirm_time",
      "returning_last_chance",
      "address_check",
      "product_share",
      "prospect_follow_up",
    ]);
    for (const key of LIFECYCLE_EVENT_KEYS) expect(CATALOGUE.find((e) => e.eventKey === key)?.agentVisible).toBe(false);
  });
});

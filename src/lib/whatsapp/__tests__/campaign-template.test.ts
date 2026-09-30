import { describe, it, expect } from "vitest";
import { buildCampaignTemplate, validateCampaignBody, campaignTemplateName, CAMPAIGN_VARIABLES, campaignSlot, estimateCampaignEnd, localDayDiff, parseSendWindow, localTime, campaignFooterText } from "../campaign-template";

/**
 * A manager's free text becomes a Meta MARKETING template. Meta's rules are
 * enforced before submission — a rejection costs a day on a new account.
 */
describe("validateCampaignBody", () => {
  it("accepts a body with text around its variables", () => {
    expect(validateCampaignBody("Bonjour {nom}, votre {produit} est à {remise} aujourd'hui.")).toEqual([]);
  });
  it("refuses an empty body, a variable-only body, a body starting or ending with a variable", () => {
    expect(validateCampaignBody("   ")).toContain("empty");
    expect(validateCampaignBody("{nom}")).toEqual(expect.arrayContaining(["starts_with_variable", "ends_with_variable"]));
    expect(validateCampaignBody("{nom}, bonjour !")).toContain("starts_with_variable");
    expect(validateCampaignBody("Bonjour, voici {produit}")).toContain("ends_with_variable");
  });
  it("refuses unknown variables and too many of them, and over-long text", () => {
    expect(validateCampaignBody("Bonjour {name}, ok.")).toContain("unknown_variable");
    expect(validateCampaignBody("x {nom} {nom} {nom} {nom} {nom} {nom} {nom} {nom} {nom} {nom} {nom} y")).toContain("too_many_variables");
    expect(validateCampaignBody("x".repeat(1025))).toContain("too_long");
  });
});

describe("buildCampaignTemplate", () => {
  it("numbers variables by first appearance, keeps the names, adds the opt-out footer and the examples", () => {
    const t = buildCampaignTemplate({ body: "Bonjour {nom}, {produit} à {remise} à {ville}. {nom}, répondez OUI.", language: "fr" });
    expect(t.variables).toEqual(["name", "product", "discount", "city"]);
    expect(t.bodyText).toBe("Bonjour {{1}}, {{2}} à {{3}} à {{4}}. {{1}}, répondez OUI.");
    expect(t.components).toEqual([
      { type: "BODY", text: t.bodyText, example: { body_text: [["Amel", "Sérum vitamine C", "-20 %", "Sousse"]] } },
      { type: "FOOTER", text: "Répondez STOP pour ne plus recevoir nos messages." },
    ]);
  });
  it("adds an IMAGE header with the handle when asked", () => {
    const t = buildCampaignTemplate({ body: "مرحباً {nom}، {produit} بسعر خاص اليوم.", language: "ar", headerHandle: "4:h" });
    expect(t.components[0]).toEqual({ type: "HEADER", format: "IMAGE", example: { header_handle: ["4:h"] } });
    expect(t.components[2]).toEqual({ type: "FOOTER", text: "أرسل توقف لإيقاف رسائلنا." });
    expect(t.variables).toEqual(["name", "product"]);
  });
  it("Arabic samples in Arabic templates", () => {
    const t = buildCampaignTemplate({ body: "مرحباً {nom}، عرض {remise}.", language: "ar" });
    expect((t.components[0] as { example: { body_text: string[][] } }).example.body_text[0]).toEqual(["نور", "خصم 20%"]);
  });
  it("throws on an invalid body", () => {
    expect(() => buildCampaignTemplate({ body: "{nom}", language: "fr" })).toThrow(/starts_with_variable/);
  });
});

describe("campaignTemplateName", () => {
  it("is Meta-legal, dated, and derived from the campaign name", () => {
    expect(campaignTemplateName("Sérum · clients 60–120 j", new Date("2026-09-25T10:00:00Z"))).toBe("ordra_camp_serum_clients_60_120_j_260925");
    expect(campaignTemplateName("!!!", new Date("2026-09-25T10:00:00Z"))).toBe("ordra_camp_campagne_260925");
    expect(campaignTemplateName("a".repeat(200), new Date("2026-09-25T10:00:00Z")).length).toBeLessThanOrEqual(80);
    expect(campaignTemplateName("Montre X2 Benghazi", new Date("2026-09-25T10:00:00Z"), 2)).toBe("ordra_camp_montre_x2_benghazi_260925_v2");
  });
  it("exposes the manager-facing variable tokens", () => {
    expect(CAMPAIGN_VARIABLES).toEqual({ nom: "name", produit: "product", ville: "city", remise: "discount" });
  });
});

/**
 * The sheet's « Fin estimée » must agree with the drain: the outbox rows are
 * paced by SQL whatsapp_campaign_slot(), so the client estimator reproduces it
 * — row i at window_start + i / rate hours, rolling into the next day's window.
 * Libya is UTC+2 all year, Tunisia UTC+1.
 */
describe("campaignSlot — mirror of SQL whatsapp_campaign_slot()", () => {
  const TRIPOLI = "Africa/Tripoli";
  const at = (iso: string) => new Date(iso);

  it("before the window opens, row 0 leaves at the opening and row i i/rate hours later", () => {
    const from = at("2026-09-25T06:00:00Z"); // 08:00 in Tripoli
    expect(campaignSlot("10-20", 60, 0, TRIPOLI, from).toISOString()).toBe("2026-09-25T08:00:00.000Z");
    expect(campaignSlot("10-20", 60, 90, TRIPOLI, from).toISOString()).toBe("2026-09-25T09:30:00.000Z");
    expect(campaignSlot("10-20", 60, 599, TRIPOLI, from).toISOString()).toBe("2026-09-25T17:59:00.000Z");
  });

  it("a full day rolls into the next day's window", () => {
    const from = at("2026-09-25T06:00:00Z");
    expect(campaignSlot("10-20", 60, 600, TRIPOLI, from).toISOString()).toBe("2026-09-26T08:00:00.000Z");
    expect(campaignSlot("10-20", 60, 1230, TRIPOLI, from).toISOString()).toBe("2026-09-27T08:30:00.000Z");
  });

  it("inside the window the first row leaves now, and the day holds only what is left of it", () => {
    const from = at("2026-09-25T10:30:00Z"); // 12:30 in Tripoli → 7.5 h left → 450 rows at 60/h
    expect(campaignSlot("10-20", 60, 0, TRIPOLI, from).toISOString()).toBe("2026-09-25T10:30:00.000Z");
    expect(campaignSlot("10-20", 60, 449, TRIPOLI, from).toISOString()).toBe("2026-09-25T17:59:00.000Z");
    expect(campaignSlot("10-20", 60, 450, TRIPOLI, from).toISOString()).toBe("2026-09-26T08:00:00.000Z");
  });

  it("after the window closes, the first row waits for tomorrow's opening", () => {
    const from = at("2026-09-25T19:00:00Z"); // 21:00 in Tripoli
    expect(campaignSlot("10-20", 40, 0, TRIPOLI, from).toISOString()).toBe("2026-09-26T08:00:00.000Z");
    expect(campaignSlot("10-20", 40, 2, TRIPOLI, from).toISOString()).toBe("2026-09-26T08:03:00.000Z");
  });

  it("Tunisia keeps its own clock", () => {
    const from = at("2026-09-25T06:00:00Z"); // 07:00 in Tunis
    expect(campaignSlot("9-13", 60, 0, "Africa/Tunis", from).toISOString()).toBe("2026-09-25T08:00:00.000Z");
  });

  it("no window (or a malformed one) paces from now, a missing rate defaults to 60/h", () => {
    const from = at("2026-09-25T23:10:00Z");
    expect(campaignSlot(null, 30, 3, TRIPOLI, from).toISOString()).toBe("2026-09-25T23:16:00.000Z");
    expect(campaignSlot("20-10", 30, 3, TRIPOLI, from).toISOString()).toBe("2026-09-25T23:16:00.000Z");
    expect(campaignSlot(null, null, 60, TRIPOLI, from).toISOString()).toBe("2026-09-26T00:10:00.000Z");
  });
});

describe("estimateCampaignEnd — « Fin estimée »", () => {
  it("412 prospects at 60/h between 10 and 20 h, launched before opening: the last send is around 17 h", () => {
    const end = estimateCampaignEnd({ audience: 412, window: "10-20", rate: 60, tz: "Africa/Tripoli", from: new Date("2026-09-25T06:00:00Z") });
    expect(end?.toISOString()).toBe("2026-09-25T14:51:00.000Z"); // 16:51 in Tripoli
  });
  it("an empty audience has no end", () => {
    expect(estimateCampaignEnd({ audience: 0, window: "10-20", rate: 60, tz: "Africa/Tripoli", from: new Date() })).toBeNull();
  });
  it("says how many local days away the end is", () => {
    const from = new Date("2026-09-25T17:30:00Z"); // 19:30 in Tripoli: 30 rows left today at 60/h
    const end = estimateCampaignEnd({ audience: 100, window: "10-20", rate: 60, tz: "Africa/Tripoli", from })!;
    expect(localDayDiff(from, end, "Africa/Tripoli")).toBe(1);
    expect(localDayDiff(from, from, "Africa/Tripoli")).toBe(0);
  });
});

describe("parseSendWindow", () => {
  it("reads « 10-20 » and refuses what the SQL would ignore", () => {
    expect(parseSendWindow("10-20")).toEqual({ start: 10, end: 20 });
    expect(parseSendWindow("9-13")).toEqual({ start: 9, end: 13 });
    expect(parseSendWindow("20-10")).toBeNull();
    expect(parseSendWindow("")).toBeNull();
    expect(parseSendWindow(null)).toBeNull();
  });
});

describe("localTime and campaignFooterText", () => {
  it("prints the market's wall clock, not the server's", () => {
    expect(localTime(new Date("2026-09-25T14:51:00Z"), "Africa/Tripoli")).toBe("16:51");
    expect(localTime(new Date("2026-09-25T23:05:00Z"), "Africa/Tunis")).toBe("00:05");
  });
  it("the preview's footer is exactly what Meta receives, in the template's language", () => {
    expect(campaignFooterText("fr")).toBe(buildCampaignTemplate({ body: "Bonjour {nom}, ok.", language: "fr" }).footerText);
    expect(campaignFooterText("ar")).toBe(buildCampaignTemplate({ body: "مرحبا {nom}، نعم.", language: "ar" }).footerText);
  });
});

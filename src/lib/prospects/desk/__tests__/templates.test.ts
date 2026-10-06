import { describe, expect, it } from "vitest";
import { TEMPLATES, templateText, fillSample, messageErrors } from "../templates";

describe("starter WhatsApp messages", () => {
  it("every template passes Meta's rules in both languages, with or without proposed products", () => {
    for (const tpl of Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]) {
      for (const lang of ["ar", "fr"] as const) {
        expect(messageErrors(templateText(tpl, lang, ["Coran Tadabbur"])), `${tpl}/${lang}`).toEqual([]);
        expect(messageErrors(templateText(tpl, lang, [])), `${tpl}/${lang} empty`).toEqual([]);
      }
    }
  });

  it("writes the proposed products into the text, and drops their line when none", () => {
    expect(templateText("new_book", "fr", ["A", "B"])).toContain("« A ou B »");
    expect(templateText("new_book", "fr", [])).not.toContain("[proposé]");
    expect(templateText("new_book", "fr", [])).not.toContain("Nouveau chez nous");
  });

  it("fills the sample customer for the preview", () => {
    expect(fillSample("Bonjour {nom}, « {produit} » {remise} à {ville}.", { name: "Ahmed", got: "Livre", city: "Tripoli", offer: "-10 %" }))
      .toBe("Bonjour Ahmed, « Livre » -10 % à Tripoli.");
  });
});

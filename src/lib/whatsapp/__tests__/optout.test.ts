import { describe, it, expect } from "vitest";
import { isOptOutText } from "../optout";

/**
 * No consent is captured (owner's decision), so the opt-out reply is the only
 * brake a customer has. It must catch every reasonable spelling of "stop" in
 * three scripts and NOTHING else: a false positive silences a customer who
 * wanted their parcel.
 */
describe("isOptOutText", () => {
  it.each([
    "STOP", "stop", " Stop ", "STOP.", "Stop!",
    "arret", "arrêt", "ARRÊT",
    "unsubscribe", "desabonner", "désabonner", "désinscrire",
    "non",
    "توقف", "ايقاف", "إيقاف", "الغاء", "إلغاء", "وقف",
    "تَوَقُّف", // with diacritics
    "توقـــف", // with tatweel
  ])("recognises %j", (text) => {
    expect(isOptOutText(text)).toBe(true);
  });

  it.each([
    "stop it please",
    "non merci je veux le colis",
    "je ne veux pas arrêter",
    "ok",
    "oui",
    "",
    "   ",
    "توقف عن الاتصال بي مساءً", // a sentence, not the keyword alone
  ])("does not fire on %j", (text) => {
    expect(isOptOutText(text)).toBe(false);
  });

  it("tolerates Arabic-Indic digits and punctuation around the keyword", () => {
    expect(isOptOutText("«توقف»")).toBe(true);
    expect(isOptOutText("stop ١")).toBe(false);
  });
});

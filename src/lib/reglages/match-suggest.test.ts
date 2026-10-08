import { describe, it, expect } from "vitest";
import { normaliseName, suggestMatch, type MatchCandidate } from "./match-suggest";

const CITIES: MatchCandidate[] = [
  { id: "sfax", label: "Sfax", alt: "صفاقس" },
  { id: "sousse", label: "Sousse", alt: "سوسة" },
  { id: "kef", label: "Le Kef", alt: "الكاف" },
  { id: "kebili", label: "Kébili", alt: "قبلي" },
  { id: "benarous", label: "Ben Arous", alt: "بن عروس" },
];

const PRODUCTS: MatchCandidate[] = [
  { id: "stick", label: "Stick anti-frottements" },
  { id: "boxer", label: "Boxer modal homme" },
  { id: "bracelet", label: "Bracelet parfum rechargeable" },
  { id: "sun", label: "Écran solaire SPF 50+" },
  { id: "baume", label: "Baume réparateur" },
];

describe("normaliseName", () => {
  it("ignores case, accents, dashes and extra spaces", () => {
    expect(normaliseName("  Écran   Solaire – SPF 50+ ")).toBe("ecran solaire spf 50");
    expect(normaliseName("Kébili")).toBe("kebili");
  });
});

describe("suggestMatch — cities (the 10-08 Tunisian backlog)", () => {
  it("calls a name that is the same once case and accents are ignored « same »", () => {
    expect(suggestMatch("Sfax", CITIES)).toEqual({ id: "sfax", confidence: "same" });
    expect(suggestMatch("ben arous", CITIES)).toEqual({ id: "benarous", confidence: "same" });
    expect(suggestMatch("Kebili", CITIES)).toEqual({ id: "kebili", confidence: "same" });
  });

  it("matches the Arabic name too", () => {
    expect(suggestMatch("صفاقس", CITIES)).toEqual({ id: "sfax", confidence: "same" });
  });

  it("calls « Kef » → « Le Kef » only « near »: the article is not the same name", () => {
    expect(suggestMatch("Kef", CITIES)).toEqual({ id: "kef", confidence: "near" });
  });

  it("proposes nothing for an empty or unknown name", () => {
    expect(suggestMatch("", CITIES)).toBeNull();
    expect(suggestMatch("   ", CITIES)).toBeNull();
    expect(suggestMatch("Tozeur", CITIES)).toBeNull();
  });
});

describe("suggestMatch — products", () => {
  it("finds the Ordra product whose whole name is inside the shop's longer title", () => {
    expect(suggestMatch("Stick Anti-frottements – Stick au beurre", PRODUCTS)).toEqual({ id: "stick", confidence: "near" });
    expect(suggestMatch("Stick Anti-Frottements Protecteur et Réparateur", PRODUCTS)).toEqual({ id: "stick", confidence: "near" });
  });

  it("is « same » when the titles are identical but for case and punctuation", () => {
    expect(suggestMatch("Bracelet Parfum Rechargeable", PRODUCTS)).toEqual({ id: "bracelet", confidence: "same" });
    expect(suggestMatch("Écran solaire SPF 50+", PRODUCTS)).toEqual({ id: "sun", confidence: "same" });
  });

  it("accepts a strong overlap when the words are mostly shared", () => {
    expect(suggestMatch("Boxer Homme en Modal – Doux et Respirant", PRODUCTS)).toEqual({ id: "boxer", confidence: "near" });
  });

  it("does not guess on one shared word", () => {
    expect(suggestMatch("Routine visage hydratation & éclat", PRODUCTS)).toBeNull();
    expect(suggestMatch("Baume à lèvres", PRODUCTS)).toBeNull();
  });

  it("does not guess when two products fit equally well", () => {
    const twins: MatchCandidate[] = [
      { id: "a", label: "Coussin" },
      { id: "b", label: "Coussin" },
    ];
    expect(suggestMatch("Coussin", twins)).toBeNull();
  });

  it("prefers the candidate that explains more of the title", () => {
    const both: MatchCandidate[] = [
      { id: "short", label: "Stick" },
      { id: "long", label: "Stick anti-frottements" },
    ];
    expect(suggestMatch("Stick anti-frottements au beurre", both)).toEqual({ id: "long", confidence: "near" });
  });
});

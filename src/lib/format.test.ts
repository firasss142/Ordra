import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatCurrencySigned,
  formatExactTime,
  formatLongDate,
  formatMoneyParts,
  formatTime,
} from "./format";

/* ─────────────────────────────────────────────────────────────────────────────
   CORRECTIF BIDI MONÉTAIRE — pourquoi ces tests assertent des CODEPOINTS.

   L'ordonnancement fautif et l'ordonnancement correct sont VISUELLEMENT
   IDENTIQUES dans un terminal : un terminal n'applique pas l'algorithme bidi
   d'Unicode comme le fait un navigateur. Un test écrit sur une chaîne « lue à
   l'œil » passerait donc en validant le bug. Chaque assertion ci-dessous porte
   sur des points de code nommés, jamais sur une comparaison visuelle.

   De même : on n'asserte JAMAIS sur la sortie brute d'Intl. La position de
   l'affixe pour « د.ل. » dépend de la version d'ICU (suffixe sur Node ICU 77.1,
   préfixe sur l'ICU de certains navigateurs). Les assertions portent sur la
   chaîne RECOMPOSÉE, dont l'ordre est imposé par notre code.
   ────────────────────────────────────────────────────────────────────────── */

const LRI = "⁦"; // LEFT-TO-RIGHT ISOLATE
const RLI = "⁧";
const FSI = "⁨";
const PDI = "⁩"; // POP DIRECTIONAL ISOLATE
const NBSP = " "; // séparateur « montant ␣ symbole »
const NNBSP = " "; // séparateur de milliers fr-TN
const MINUS = "−"; // MINUS SIGN — jamais le tiret ASCII U+002D
const RLM = "‏";
const LRM = "‎";
const ALM = "؜";

/** Marques directionnelles résiduelles que la sortie ne doit JAMAIS contenir. */
const BIDI_MARKS = /[‎‏؜]/;

/** Plages arabe / hébreu — « fort RTL » au sens de l'algorithme bidi. */
const STRONG_RTL =
  /[֐-׿؀-ۿ܀-ݏݐ-ݿހ-޿ࡠ-ࣿיִ-﷿ﹰ-﻿]/;

/**
 * Vrai si un caractère fort-RTL se trouve HORS de tout isolat.
 * C'est la propriété qui décide si un voisin (pourcentage, séparateur « · »,
 * libellé) peut être réordonné au rendu : à l'intérieur d'un isolat équilibré,
 * le symbole arabe ne peut plus influencer ce qui l'entoure.
 */
function hasStrongRtlOutsideIsolate(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === LRI || ch === RLI || ch === FSI) {
      depth += 1;
      continue;
    }
    if (ch === PDI) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && STRONG_RTL.test(ch)) return true;
  }
  return false;
}

function isolatesAreBalanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === LRI || ch === RLI || ch === FSI) depth += 1;
    else if (ch === PDI) {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** Index du DERNIER chiffre latin, ou -1. */
function lastDigitIndex(s: string): number {
  for (let i = s.length - 1; i >= 0; i -= 1) {
    if (s[i] >= "0" && s[i] <= "9") return i;
  }
  return -1;
}

function countOf(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n += 1;
  return n;
}

describe("formatCurrency — ordre des caractères (marché LY)", () => {
  const ly = () => formatCurrency(10708.5, "LY");

  it("encadre le montant d'un isolat LRI…PDI", () => {
    const out = ly();
    expect(out.startsWith(LRI)).toBe(true);
    expect(out.endsWith(PDI)).toBe(true);
    expect(isolatesAreBalanced(out)).toBe(true);
  });

  it("place le montant AVANT le symbole, séparés par une NBSP", () => {
    const out = ly();
    const firstRtl = out.search(STRONG_RTL);
    expect(firstRtl).toBeGreaterThan(-1); // le symbole arabe est bien présent
    // tous les chiffres précèdent le premier caractère du symbole
    expect(lastDigitIndex(out)).toBeLessThan(firstRtl);
    // et le séparateur juste avant le symbole est une NBSP
    expect(out[firstRtl - 1]).toBe(NBSP);
  });

  it("ne laisse AUCUNE marque directionnelle résiduelle (RLM / LRM / ALM)", () => {
    const out = ly();
    expect(BIDI_MARKS.test(out)).toBe(false);
    expect(out).not.toContain(RLM);
    expect(out).not.toContain(LRM);
    expect(out).not.toContain(ALM);
  });

  it("groupe les milliers à la française — jamais « 10.708 », qu'un lecteur fr lit 10,708", () => {
    const out = ly();
    expect(out).toContain(`10${NNBSP}708,500`);
    expect(out).not.toContain("10.708");
  });

  it("n'emprunte au formateur devise QUE le symbole, jamais ses chiffres", () => {
    const { value, symbol } = formatMoneyParts(10708.5, "LY");
    expect(value).toBe(`10${NNBSP}708,500`);
    expect(symbol).not.toMatch(/\d/);
    expect(symbol.length).toBeGreaterThan(0);
    expect(BIDI_MARKS.test(value)).toBe(false);
    expect(BIDI_MARKS.test(symbol)).toBe(false);
  });
});

describe("formatCurrency — signe à l'intérieur de l'isolat", () => {
  it("pose le signe moins U+2212 juste après le LRI, jamais un tiret ASCII", () => {
    const out = formatCurrency(-94, "LY");
    expect(out.indexOf(MINUS)).toBe(1); // position 0 = LRI
    expect(out).not.toContain("-"); // pas de HYPHEN-MINUS U+002D
    expect(lastDigitIndex(out)).toBeLessThan(out.search(STRONG_RTL));
    expect(BIDI_MARKS.test(out)).toBe(false);
  });

  it("formatCurrencySigned préfixe « + » pour un positif, dans l'isolat", () => {
    const out = formatCurrencySigned(94, "LY");
    expect(out.startsWith(`${LRI}+`)).toBe(true);
    expect(out.endsWith(PDI)).toBe(true);
    expect(lastDigitIndex(out)).toBeLessThan(out.search(STRONG_RTL));
  });

  it("formatCurrencySigned utilise U+2212 pour un négatif", () => {
    const out = formatCurrencySigned(-94, "LY");
    expect(out.startsWith(`${LRI}${MINUS}`)).toBe(true);
    expect(out).not.toContain("-");
  });

  it("n'affiche aucun signe sur zéro", () => {
    expect(formatCurrencySigned(0, "LY").startsWith(`${LRI}0`)).toBe(true);
    expect(formatCurrency(0, "LY")).not.toContain(MINUS);
    expect(formatCurrencySigned(0, "TN")).not.toContain("+");
  });

  it("n'affiche pas « −0,000 » quand l'arrondi ramène à zéro", () => {
    const out = formatCurrency(-0.0001, "TN");
    expect(out).not.toContain(MINUS);
    expect(out).toContain("0,000");
  });
});

describe("formatCurrency — concaténation avec un voisin", () => {
  it("garde « <montant> · <pourcentage> » à l'abri de tout réordonnancement", () => {
    const line = `${formatCurrency(10708.5, "LY")} · 72,8 %`;
    // Aucun caractère fort-RTL hors isolat : le pourcentage et le séparateur ne
    // peuvent donc pas basculer de l'autre côté du montant au rendu.
    expect(hasStrongRtlOutsideIsolate(line)).toBe(false);
    expect(isolatesAreBalanced(line)).toBe(true);
    expect(line.indexOf("10")).toBeLessThan(line.indexOf("72,8"));
  });

  it("isole chaque montant d'une ligne à plusieurs montants", () => {
    const line = `${formatCurrencySigned(94, "LY")} · ${formatCurrency(-12.5, "LY")}`;
    expect(hasStrongRtlOutsideIsolate(line)).toBe(false);
    expect(isolatesAreBalanced(line)).toBe(true);
    expect(countOf(line, LRI)).toBe(2);
    expect(countOf(line, PDI)).toBe(2);
  });
});

describe("formatCurrency — marché TN non régressé", () => {
  it("rend « montant NBSP DT » dans un isolat, sans marque bidi", () => {
    const out = formatCurrency(10708.5, "TN");
    expect(out).toBe(`${LRI}10${NNBSP}708,500${NBSP}DT${PDI}`);
    expect(BIDI_MARKS.test(out)).toBe(false);
  });

  it("garde trois décimales (monnaies en millimes)", () => {
    expect(formatCurrency(1, "TN")).toContain("1,000");
    expect(formatCurrency(1, "LY")).toContain("1,000");
  });

  it("traite un code inconnu comme TN (contrat historique des appelants)", () => {
    // portfolio.ts documente qu'un « LYD » passé par erreur retombe sur TN.
    expect(formatCurrency(1, "LYD")).toBe(formatCurrency(1, "TN"));
    expect(formatCurrency(1, "")).toBe(formatCurrency(1, "TN"));
  });
});

describe("formatCurrency — bornes numériques", () => {
  it("zéro", () => {
    expect(formatCurrency(0, "TN")).toBe(`${LRI}0,000${NBSP}DT${PDI}`);
    expect(formatCurrency(0, "LY")).toContain("0,000");
  });

  it("négatif", () => {
    expect(formatCurrency(-94, "TN")).toBe(`${LRI}${MINUS}94,000${NBSP}DT${PDI}`);
  });

  it("très grand nombre — groupement homogène, aucun débordement", () => {
    const out = formatCurrency(9876543210.5, "LY");
    expect(out).toContain(`9${NNBSP}876${NNBSP}543${NNBSP}210,500`);
    expect(BIDI_MARKS.test(out)).toBe(false);
    expect(lastDigitIndex(out)).toBeLessThan(out.search(STRONG_RTL));
  });
});

describe("formatCurrency — contrat d'appel", () => {
  it("reste une chaîne simple, utilisable en gabarit et en argument ICU", () => {
    const v = formatCurrency(12.5, "LY");
    expect(typeof v).toBe("string");
    expect(`Solde ${v}`).toContain(v);
  });

  it("est déterministe — même entrée, même sortie (hydratation React)", () => {
    expect(formatCurrency(12.5, "LY")).toBe(formatCurrency(12.5, "LY"));
  });

  it("accepte un nombre de décimales optionnel sans casser l'isolat", () => {
    expect(formatCurrency(1234, "TN", { fractionDigits: 0 })).toBe(
      `${LRI}1${NNBSP}234${NBSP}DT${PDI}`
    );
    expect(formatCurrency(1234.5, "TN", { fractionDigits: 2 })).toBe(
      `${LRI}1${NNBSP}234,50${NBSP}DT${PDI}`
    );
  });

  it("formatMoneyParts expose chiffres et symbole séparément, sans caractère de contrôle", () => {
    const tn = formatMoneyParts(1234.5, "TN");
    expect(tn.value).toBe(`1${NNBSP}234,500`);
    expect(tn.symbol).toBe("DT");
    expect(tn.value).not.toContain(LRI);
    expect(tn.symbol).not.toContain(PDI);
  });
});

describe("formatTime", () => {
  it("returns a HH:MM time string", () => {
    const result = formatTime("2026-05-21T14:30:00Z", "fr");
    expect(result).toMatch(/\d{1,2}[:h]\d{2}/);
  });

  it("accepts a Date object directly", () => {
    const result = formatTime(new Date("2026-05-21T09:05:00Z"), "fr");
    expect(result).toMatch(/\d{1,2}[:h]\d{2}/);
  });
});

describe("formatLongDate", () => {
  const date = "2026-05-21T09:00:00Z";

  it("spells out the month in French (no slashes)", () => {
    const result = formatLongDate(date, "fr");
    expect(result).toMatch(/mai/i);
    expect(result).toMatch(/2026/);
    expect(result).not.toMatch(/\//);
  });

  it("includes day, full month, and year in Arabic", () => {
    const result = formatLongDate(date, "ar");
    expect(result).toMatch(/2026|٢٠٢٦/);
    expect(result).not.toMatch(/\//);
  });

  it("accepts a Date object directly", () => {
    const result = formatLongDate(new Date(date), "fr");
    expect(result).toMatch(/mai/i);
  });
});

describe("formatExactTime", () => {
  it("returns HH:MM when the date is today", () => {
    const now = new Date();
    const sameDay = new Date(now);
    sameDay.setHours(9, 35, 0, 0);
    const result = formatExactTime(sameDay.toISOString(), "fr");
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns DD/MM HH:MM when the date is a different day", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(14, 20, 0, 0);
    const result = formatExactTime(yesterday.toISOString(), "fr");
    expect(result).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
  });

  it("accepts a Date object directly", () => {
    const now = new Date();
    const result = formatExactTime(now, "fr");
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns DD/MM HH:MM for clearly past date", () => {
    const past = new Date("2024-01-15T08:30:00Z");
    const result = formatExactTime(past, "fr");
    expect(result).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
  });
});

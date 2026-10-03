import { describe, it, expect } from "vitest";
import {
  groupDigits,
  moneyText,
  pctText,
  numText,
  currencySymbol,
  dayLabel,
  dayTimeLabel,
  rangeLabel,
  LRI,
  PDI,
  NBSP,
  MINUS,
} from "@/lib/products/format";

describe("groupDigits — the prototype's numbers: space thousands, comma decimals, both languages", () => {
  it.each([
    [17356.731, 0, `17${NBSP}357`],
    [1816.269, 0, `1${NBSP}816`],
    [23.587, 1, "23,6"],
    [999, 0, "999"],
    [1234567, 0, `1${NBSP}234${NBSP}567`],
  ])("%s with %s decimals → %s", (n, d, out) => {
    expect(groupDigits(n, d)).toBe(out);
  });

  it("never prints -0", () => {
    expect(groupDigits(-0.2, 0)).toBe("0");
  });
});

describe("moneyText — for amounts inside a sentence", () => {
  it("isolates the figure left-to-right with its sign inside, the symbol after a no-break space", () => {
    expect(moneyText(-1816.269, "LYD")).toBe(`${LRI}${MINUS}1${NBSP}816${PDI}${NBSP}د.ل`);
  });

  it("signs a positive amount only when asked", () => {
    expect(moneyText(3632.7, "LYD", { signed: true })).toBe(`${LRI}+3${NBSP}633${PDI}${NBSP}د.ل`);
    expect(moneyText(3632.7, "LYD")).toBe(`${LRI}3${NBSP}633${PDI}${NBSP}د.ل`);
  });

  it("takes decimals for per-delivery figures", () => {
    expect(moneyText(47.24, "LYD", { decimals: 1 })).toBe(`${LRI}47,2${PDI}${NBSP}د.ل`);
  });

  it("rounds before signing, so a loss of 0.4 is not '−0'", () => {
    expect(moneyText(-0.4, "LYD")).toBe(`${LRI}0${PDI}${NBSP}د.ل`);
  });

  it("knows Tunisia's dinar", () => {
    expect(currencySymbol("TND")).toBe("DT");
    expect(currencySymbol("LYD")).toBe("د.ل");
  });
});

describe("pctText", () => {
  it("puts a no-break space before % in French, none in Arabic", () => {
    expect(pctText(0.55, "fr")).toBe(`${LRI}55${NBSP}%${PDI}`);
    expect(pctText(0.55, "ar")).toBe(`${LRI}55%${PDI}`);
    expect(pctText(0.0525, "fr", 1)).toBe(`${LRI}5,3${NBSP}%${PDI}`);
  });
});

describe("numText", () => {
  it("isolates a count", () => {
    expect(numText(581)).toBe(`${LRI}581${PDI}`);
  });
});

describe("dates, in the market's timezone", () => {
  const tz = "Africa/Tripoli";

  it("names a day", () => {
    expect(dayLabel("2026-09-04", "fr")).toBe("4 sept.");
    expect(dayLabel("2026-09-04", "ar")).toBe("4 سبتمبر");
  });

  it("names a range, the year once at the end", () => {
    expect(rangeLabel("2026-09-04", "2026-10-03", "fr")).toBe("4 sept. – 3 oct. 2026");
    expect(rangeLabel("2026-09-04", "2026-10-03", "ar")).toBe("4 سبتمبر – 3 أكتوبر 2026");
  });

  it("dates an instant with its weekday and time", () => {
    // 15:15 UTC = 17:15 in Tripoli.
    expect(dayTimeLabel("2026-09-29T15:15:00Z", tz, "fr")).toBe("mar. 29 sept., 17:15");
    expect(dayTimeLabel("2026-09-29T15:15:00Z", tz, "ar")).toBe("الثلاثاء 29 سبتمبر، 17:15");
  });
});

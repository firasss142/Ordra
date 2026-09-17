import { describe, test, expect } from "vitest";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * Libya reads Arabic. A key present in fr.json and missing from ar.json does
 * not fail the build — next-intl renders the key path instead, so the screen
 * ships with "duplicateOrder.review.deleteSelected" printed on a button. These
 * assertions are the only thing that catches that before an agent sees it.
 */
const keys = (o: Record<string, unknown>) => Object.keys(o).sort();

describe("duplicate review + merge i18n parity", () => {
  test("both locales define every duplicate-review key", () => {
    expect(keys(ar.duplicateOrder.review)).toEqual(keys(fr.duplicateOrder.review));
  });

  test("both locales define every merge key", () => {
    expect(keys(ar.orderMerge)).toEqual(keys(fr.orderMerge));
  });

  test("both locales name the Doublons nav entry", () => {
    expect(fr.nav.items.duplicates).toBeTruthy();
    expect(ar.nav.items.duplicates).toBeTruthy();
  });

  test("no review string was left in French inside the Arabic catalog", () => {
    // A copy-paste that forgets to translate is invisible until someone reads
    // the screen in Arabic; Latin letters in these values are the tell.
    //
    // ICU placeholder NAMES are Latin by design ({count}, {hours}) and must be
    // stripped before the check, or every interpolated string reads as a miss.
    const suspicious = Object.entries(ar.duplicateOrder.review).filter(
      ([, v]) =>
        typeof v === "string" && /[A-Za-zÀ-ÿ]{4,}/.test(v.replace(/\{\w+\}/g, "")),
    );
    expect(suspicious).toEqual([]);
  });

  test("interpolation placeholders match between locales", () => {
    // {count} in one locale and {n} in the other throws at render time.
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const [key, frVal] of Object.entries(fr.duplicateOrder.review)) {
      const arVal = (ar.duplicateOrder.review as Record<string, string>)[key];
      if (typeof frVal !== "string" || typeof arVal !== "string") continue;
      expect({ key, p: placeholders(arVal) }).toEqual({ key, p: placeholders(frVal) });
    }
  });
});

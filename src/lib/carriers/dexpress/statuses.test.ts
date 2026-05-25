import { describe, test, expect } from "vitest";
import {
  DEXPRESS_STATUSES,
  findStatusById,
  findStatusByLabel,
  findStatusBySlug,
  normalizeArabic,
  type DexpressStatusEntry,
} from "./statuses";

describe("normalizeArabic", () => {
  test("strips tatweel (ـ) characters", () => {
    expect(normalizeArabic("فى الشـركة")).toBe("فى الشركة");
    expect(normalizeArabic("تـم التسـليم")).toBe("تم التسليم");
  });

  test("collapses internal runs of whitespace to a single space", () => {
    expect(normalizeArabic("فى   الشركة")).toBe("فى الشركة");
    expect(normalizeArabic("تم\tالتسليم")).toBe("تم التسليم");
  });

  test("trims leading and trailing whitespace", () => {
    expect(normalizeArabic("  فى الشركة  ")).toBe("فى الشركة");
    expect(normalizeArabic("\nتم التسليم\n")).toBe("تم التسليم");
  });

  test("returns empty string for empty input", () => {
    expect(normalizeArabic("")).toBe("");
    expect(normalizeArabic("   ")).toBe("");
  });

  test("leaves already-normalized strings unchanged", () => {
    expect(normalizeArabic("فى الشركة")).toBe("فى الشركة");
  });
});

describe("DEXPRESS_STATUSES taxonomy invariants", () => {
  test("contains exactly 19 entries (the known Dexpress statuses)", () => {
    expect(DEXPRESS_STATUSES).toHaveLength(19);
  });

  test("every entry has a unique numeric id", () => {
    const ids = DEXPRESS_STATUSES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every entry has a unique slug", () => {
    const slugs = DEXPRESS_STATUSES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("every entry has non-empty timeline and sidebar labels", () => {
    for (const entry of DEXPRESS_STATUSES) {
      expect(entry.timelineLabel.length).toBeGreaterThan(0);
      expect(entry.sidebarLabel.length).toBeGreaterThan(0);
    }
  });

  test("exactly 7 entries are marked confirmed (per the 2026-05-25 briefing + probes)", () => {
    // Briefing-confirmed labels: AT_CUSTOMER, BEING_PREPARED, IN_COMPANY,
    // OUT_FOR_DELIVERY, DELIVERED, AWAITING_COURIER_SETTLEMENT, SENT_TO_COURIER.
    // The other 12 are unconfirmed guesses from the sidebar-prefix-stripping rule.
    const confirmed = DEXPRESS_STATUSES.filter((e) => e.confirmed);
    expect(confirmed).toHaveLength(7);
  });
});

describe("findStatusById — primary lookup path for ajax-order-case", () => {
  // These three IDs were empirically confirmed via the 2026-05-25 probes
  // against real Dexpress orders (1343188, 1339630, 1341657).
  test("id 3 → IN_COMPANY (probe: 1343188)", () => {
    const entry = findStatusById(3);
    expect(entry).not.toBeNull();
    expect(entry!.slug).toBe("IN_COMPANY");
    expect(entry!.timelineLabel).toBe("فى الشركة");
  });

  test("id 7 → OUT_FOR_DELIVERY (probe: 1341657)", () => {
    const entry = findStatusById(7);
    expect(entry).not.toBeNull();
    expect(entry!.slug).toBe("OUT_FOR_DELIVERY");
    expect(entry!.timelineLabel).toBe("جارى التوصيل");
  });

  test("id 10 → DELIVERED (probe: 1339630)", () => {
    const entry = findStatusById(10);
    expect(entry).not.toBeNull();
    expect(entry!.slug).toBe("DELIVERED");
    expect(entry!.timelineLabel).toBe("تم التسليم");
  });

  test("id 29 → SENT_TO_COURIER (gap-jump id, briefing-confirmed)", () => {
    const entry = findStatusById(29);
    expect(entry).not.toBeNull();
    expect(entry!.slug).toBe("SENT_TO_COURIER");
  });

  test("id 25 → AWAITING_COURIER_SETTLEMENT (gap-jump id, briefing-confirmed)", () => {
    const entry = findStatusById(25);
    expect(entry).not.toBeNull();
    expect(entry!.slug).toBe("AWAITING_COURIER_SETTLEMENT");
  });

  test("returns null for an id that doesn't exist in the taxonomy", () => {
    expect(findStatusById(9999)).toBeNull();
    expect(findStatusById(0)).toBeNull();
    expect(findStatusById(-1)).toBeNull();
  });

  test("returns null for NaN", () => {
    expect(findStatusById(Number.NaN)).toBeNull();
  });
});

describe("findStatusBySlug — symmetric lookup for UI label rendering", () => {
  test("returns the full entry for a known slug", () => {
    const entry = findStatusBySlug("IN_COMPANY");
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe(3);
    expect(entry!.timelineLabel).toBe("فى الشركة");
  });

  test("DELIVERED slug → entry with id 10 and 'تم التسليم'", () => {
    const entry = findStatusBySlug("DELIVERED");
    expect(entry!.id).toBe(10);
    expect(entry!.timelineLabel).toBe("تم التسليم");
  });
});

describe("findStatusByLabel — fallback lookup for ajax-order-case + future HTML parser", () => {
  test("matches the 3 probe-confirmed timeline labels exactly", () => {
    expect(findStatusByLabel("فى الشركة")?.slug).toBe("IN_COMPANY");
    expect(findStatusByLabel("جارى التوصيل")?.slug).toBe("OUT_FOR_DELIVERY");
    expect(findStatusByLabel("تم التسليم")?.slug).toBe("DELIVERED");
  });

  test("matches the remaining 4 briefing-confirmed timeline labels", () => {
    expect(findStatusByLabel("عند العميل")?.slug).toBe("AT_CUSTOMER");
    expect(findStatusByLabel("جارى التجهيز")?.slug).toBe("BEING_PREPARED");
    expect(findStatusByLabel("إلى المندوب")?.slug).toBe("SENT_TO_COURIER");
    expect(findStatusByLabel("تسليم تحت تسويه المندوب")?.slug).toBe(
      "AWAITING_COURIER_SETTLEMENT"
    );
  });

  test("matches sidebar vocabulary too (طلبات … prefix)", () => {
    // Sidebar labels are the prefixed variants from /merchant/all-orders/{id}.
    expect(findStatusByLabel("طلبات تم تسليمها")?.slug).toBe("DELIVERED");
    expect(findStatusByLabel("طلبات فى الشركة")?.slug).toBe("IN_COMPANY");
  });

  test("matches with surrounding whitespace + tatweel padding (normalization)", () => {
    expect(findStatusByLabel("  فى الشـركة  ")?.slug).toBe("IN_COMPANY");
    expect(findStatusByLabel("تـم  التسـليم")?.slug).toBe("DELIVERED");
  });

  test("returns null for an obviously-wrong string", () => {
    expect(findStatusByLabel("not a real status")).toBeNull();
    expect(findStatusByLabel("")).toBeNull();
    expect(findStatusByLabel("   ")).toBeNull();
  });

  test("entries carry through the full DexpressStatusEntry shape", () => {
    const entry: DexpressStatusEntry | null = findStatusByLabel("تم التسليم");
    expect(entry).not.toBeNull();
    expect(entry).toEqual(
      expect.objectContaining({
        id: 10,
        slug: "DELIVERED",
        timelineLabel: expect.any(String),
        sidebarLabel: expect.any(String),
        confirmed: true,
      })
    );
  });
});

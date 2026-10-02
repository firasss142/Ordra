import { describe, expect, test } from "vitest";
import { familyKey, buildFamilies, type FamilyProduct } from "../product-family";

// The Libyan catalogue fakes sizes as separate products: the boxing dummy is four rows,
// one of them retired and spelled differently. The page's product tabs show it as one.
describe("familyKey", () => {
  test("the four boxing dummies share one key", () => {
    const keys = new Set([
      familyKey("دميه ملاكمه حجم متوسط"),
      familyKey("دميه ملاكمه حجم صغير"),
      familyKey("دميه ملاكمه حجم كبير"),
      familyKey("دمية الملاكمة حجم كبير (179 دل)"),
    ]);
    expect(keys.size).toBe(1);
  });

  test("different books keep different keys", () => {
    expect(familyKey("القرآن تدبر وعمل")).not.toBe(familyKey("مصحف التهجد و قيام الليل"));
    expect(familyKey("كتاب الحفظ الميسر")).not.toBe(familyKey("كتاب الداء والدواء للإمام ابن القيم"));
  });
});

describe("buildFamilies", () => {
  const P = (id: string, name: string, is_active = true, image_url: string | null = `img-${id}`): FamilyProduct => ({
    id, name, is_active, image_url,
  });

  test("groups sizes, labels the family without the size, prefers an active member's image", () => {
    const fams = buildFamilies([
      P("retired", "دمية الملاكمة حجم كبير (179 دل)", false),
      P("small", "دميه ملاكمه حجم صغير"),
      P("medium", "دميه ملاكمه حجم متوسط"),
      P("quran", "القرآن تدبر وعمل"),
    ]);
    expect(fams).toHaveLength(2);
    const bag = fams.find((f) => f.productIds.includes("medium"))!;
    expect(bag.productIds.sort()).toEqual(["medium", "retired", "small"]);
    expect(bag.id).toBe("small");
    expect(bag.label).toBe("دميه ملاكمه");
    expect(bag.imageUrl).toBe("img-small");
    const quran = fams.find((f) => f.id === "quran")!;
    expect(quran.label).toBe("القرآن تدبر وعمل");
    expect(quran.productIds).toEqual(["quran"]);
  });

  test("a family with no image anywhere has a null image", () => {
    expect(buildFamilies([P("x", "Biovera", true, null)])[0].imageUrl).toBeNull();
  });

  test("familyOf finds the family of any member", async () => {
    const { familyOf } = await import("../product-family");
    const fams = buildFamilies([P("small", "دميه ملاكمه حجم صغير"), P("medium", "دميه ملاكمه حجم متوسط")]);
    expect(familyOf(fams, "medium")?.id).toBe("small");
    expect(familyOf(fams, "nope")).toBeNull();
  });
});

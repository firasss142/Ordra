import { describe, test, expect } from "vitest";
import {
  staticDestinations,
  groupByCity,
  searchDestinations,
  destinationLabel,
  findDestination,
  findDestinationById,
  type DarbDestinationOption,
} from "./darb-destination-search";

const ALL = staticDestinations();

describe("staticDestinations (catalogue JSON flattened, no ids)", () => {
  test("one option per validated (city, area) pair, ids unknown", () => {
    expect(ALL.length).toBe(304);
    expect(ALL.every((o) => o.id === null)).toBe(true);
    expect(ALL).toContainEqual({ id: null, city: "الجفرة", area: "سوكنة" });
  });
});

describe("groupByCity", () => {
  test("the two cities that carry most of the volume come first, then the rest", () => {
    const groups = groupByCity(ALL);
    expect(groups[0].city).toBe("طرابلس");
    expect(groups[1].city).toBe("بنغازي");
    expect(groups.map((g) => g.city)).toHaveLength(25);
  });

  test("a city's own pair (area === city) leads its group so 'the centre' is one click", () => {
    const groups = groupByCity(ALL);
    const benghazi = groups.find((g) => g.city === "بنغازي")!;
    expect(benghazi.areas[0]).toEqual({ id: null, city: "بنغازي", area: "بنغازي" });
    expect(benghazi.areas.length).toBeGreaterThan(20);
  });

  test("a single-area city is a group of one", () => {
    const groups = groupByCity(ALL);
    const ajdabiya = groups.find((g) => g.city === "اجدابيا")!;
    expect(ajdabiya.areas).toEqual([{ id: null, city: "اجدابيا", area: "اجدابيا" }]);
  });

  test("scoping to one city keeps only that city's group", () => {
    const groups = groupByCity(ALL, "الجفرة");
    expect(groups).toHaveLength(1);
    expect(groups[0].areas.map((a) => a.area)).toContain("هون");
  });
});

describe("searchDestinations", () => {
  test("empty query → nothing (the browse view handles that case)", () => {
    expect(searchDestinations(ALL, "   ")).toEqual([]);
  });

  test("a city prefix finds that city's pairs first; unrelated cities stay out", () => {
    const hits = searchDestinations(ALL, "بنغ");
    expect(hits[0]).toEqual({ id: null, city: "بنغازي", area: "بنغازي" });
    // مصراتة's "شارع بنغازي" legitimately matches too — an area name is a hit.
    expect(hits.every((h) => h.city === "بنغازي" || h.area.includes("بنغازي"))).toBe(true);
    expect(hits.some((h) => h.city === "طرابلس")).toBe(false);
  });

  test("an area name finds its pair under the parent city", () => {
    const hits = searchDestinations(ALL, "جنزور");
    expect(hits).toEqual([{ id: null, city: "طرابلس", area: "جنزور" }]);
  });

  test("Arabic spelling variants match (ta marbuta / hamza folding)", () => {
    // سوكنه (ه) for سوكنة (ة); الابرق for الأبرق.
    expect(searchDestinations(ALL, "سوكنه")).toEqual([{ id: null, city: "الجفرة", area: "سوكنة" }]);
    expect(searchDestinations(ALL, "الابرق")).toEqual([{ id: null, city: "القبة", area: "الأبرق" }]);
  });

  test("a city's own pair ranks before its sub-areas when the city matches", () => {
    const hits = searchDestinations(ALL, "مصراتة");
    expect(hits[0]).toEqual({ id: null, city: "مصراتة", area: "مصراتة" });
  });

  test("scoped search never leaves the scope city", () => {
    const hits = searchDestinations(ALL, "ا", "الجفرة");
    expect(hits.every((h) => h.city === "الجفرة")).toBe(true);
  });
});

describe("destinationLabel", () => {
  test("a city's own pair reads as the city alone", () => {
    expect(destinationLabel({ id: 1, city: "اجدابيا", area: "اجدابيا" })).toBe("اجدابيا");
  });
  test("a sub-area reads as city — area", () => {
    expect(destinationLabel({ id: 1, city: "طرابلس", area: "جنزور" })).toBe("طرابلس — جنزور");
  });
});

describe("lookups", () => {
  const rows: DarbDestinationOption[] = [
    { id: 10, city: "طرابلس", area: "جنزور" },
    { id: 11, city: "اجدابيا", area: "اجدابيا" },
  ];
  test("findDestinationById", () => {
    expect(findDestinationById(rows, 11)).toEqual(rows[1]);
    expect(findDestinationById(rows, 99)).toBeNull();
    expect(findDestinationById(rows, null)).toBeNull();
  });
  test("findDestination by (city, area) is spelling-tolerant", () => {
    expect(findDestination(rows, "طرابلس", "جنزور")).toEqual(rows[0]);
    expect(findDestination(rows, "أجدابيا", "اجدابيا")).toEqual(rows[1]);
    expect(findDestination(rows, "طرابلس", "nope")).toBeNull();
  });
});

describe("matchRange (where to highlight the query inside a result)", () => {
  test("plain substring", async () => {
    const { matchRange } = await import("./darb-destination-search");
    expect(matchRange("عين زارة", "زار")).toEqual([4, 7]);
  });
  test("survives the folding the search uses (hamza, ta marbuta), mapping back to the original text", async () => {
    const { matchRange } = await import("./darb-destination-search");
    expect(matchRange("الأبرق", "الابرق")).toEqual([0, 6]);
    expect(matchRange("سوكنة", "سوكنه")).toEqual([0, 5]);
  });
  test("null when the query is absent or empty", async () => {
    const { matchRange } = await import("./darb-destination-search");
    expect(matchRange("طرابلس", "zzz")).toBeNull();
    expect(matchRange("طرابلس", "  ")).toBeNull();
  });
});

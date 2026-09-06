import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DARB_ZONES,
  zoneForColor,
  normalizeHex,
  DARB_ZONE_ORDER,
  zoneLabels,
} from "./darb-zones";

/**
 * The nine sticker-roll colours.
 *
 * Darb's own branch directory is the authority on which branch carries which
 * colour (`GET /api/local/branches/public` → `color`). This module adds only
 * the human NAME of each colour, which the API does not carry — it comes from
 * the carrier's printed poster.
 *
 * The fixture test below is the guard that keeps the two in step: if Darb ever
 * repaints a branch or adds a tenth roll, `report/darb-branches.json` changes
 * and this suite fails rather than the bench quietly showing a wrong colour.
 */

interface ProbeReport {
  [account: string]: {
    groups: Record<string, { colors: string[]; cities: string[]; areas: string[] }>;
  };
}

function loadProbe(): ProbeReport {
  const path = resolve(__dirname, "../../../report/darb-branches.json");
  return JSON.parse(readFileSync(path, "utf8")) as ProbeReport;
}

describe("DARB_ZONES", () => {
  test("covers exactly the nine colours Darb's branch directory returns", () => {
    const probe = loadProbe();
    const fromApi = new Set<string>();
    for (const account of Object.values(probe)) {
      for (const group of Object.values(account.groups)) {
        for (const colour of group.colors) fromApi.add(normalizeHex(colour));
      }
    }

    expect([...fromApi].sort()).toEqual(Object.keys(DARB_ZONES).sort());
    expect(fromApi.size).toBe(9);
  });

  test("every branch group maps to exactly one colour", () => {
    const probe = loadProbe();
    const perGroup = new Map<string, Set<string>>();
    for (const account of Object.values(probe)) {
      for (const [group, value] of Object.entries(account.groups)) {
        if (!perGroup.has(group)) perGroup.set(group, new Set());
        for (const colour of value.colors) perGroup.get(group)!.add(normalizeHex(colour));
      }
    }
    const multi = [...perGroup.entries()].filter(([, colours]) => colours.size > 1);
    expect(multi).toEqual([]);
  });

  test("both Darb accounts publish the same colour for the same branch group", () => {
    const probe = loadProbe();
    const accounts = Object.keys(probe);
    expect(accounts.length).toBe(2);

    const [a, b] = accounts;
    for (const group of Object.keys(probe[a].groups)) {
      expect(probe[b].groups[group]?.colors ?? []).toEqual(probe[a].groups[group].colors);
    }
  });

  test("names each zone in French and Arabic", () => {
    for (const [hex, zone] of Object.entries(DARB_ZONES)) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(zone.nameFr.length).toBeGreaterThan(0);
      expect(zone.nameAr.length).toBeGreaterThan(0);
      expect(zone.colourFr.length).toBeGreaterThan(0);
    }
  });

  test("the poster's nine cards are all present", () => {
    const cards = Object.values(DARB_ZONES).map((z) => z.nameFr).sort();
    expect(cards).toEqual(
      [
        "Tripoli et banlieue",
        "Sud de Tripoli",
        "Ouest de Tripoli",
        "Est de Tripoli",
        "Région centrale",
        "Région orientale",
        "Djebel occidental",
        "Région méridionale",
        "Sud-Est",
      ].sort(),
    );
  });

  test("DARB_ZONE_ORDER lists every zone once, west to east", () => {
    expect([...DARB_ZONE_ORDER].sort()).toEqual(Object.keys(DARB_ZONES).sort());
  });
});

describe("zoneForColor", () => {
  test("resolves a colour Darb published", () => {
    expect(zoneForColor("#339307")?.nameFr).toBe("Région orientale");
    expect(zoneForColor("#0cbceb")?.nameFr).toBe("Région méridionale");
  });

  test("is case- and whitespace-insensitive, as the API is not guaranteed to be", () => {
    expect(zoneForColor("  #D80A0A ")?.nameFr).toBe("Tripoli et banlieue");
  });

  test("returns null for an unknown colour rather than guessing a zone", () => {
    expect(zoneForColor("#123456")).toBeNull();
    expect(zoneForColor("")).toBeNull();
    expect(zoneForColor(null)).toBeNull();
  });
});

describe("zoneLabels — the colour in the operator's language", () => {
  // The roll colour is the whole control on the Libyan bench, and the Libyan
  // agent reads Arabic. Naming "Rouge — Tripoli et banlieue" to them is a
  // label they cannot act on.
  test("returns Arabic colour and zone names for the ar locale", () => {
    const l = zoneLabels("#d80a0a", "ar");
    expect(l).toEqual({ colour: "أحمر", name: "طرابلس وضواحيها" });
  });

  test("returns French names for the fr locale", () => {
    expect(zoneLabels("#339307", "fr")).toEqual({ colour: "Vert", name: "Région orientale" });
  });

  test("accepts a zone-shaped object as well as a hex", () => {
    const zone = { colorHex: "#0cbceb", colourFr: "Cyan", nameFr: "Région méridionale", nameAr: "المنطقة الجنوبية" };
    expect(zoneLabels(zone, "ar").colour).toBe("سماوي");
    expect(zoneLabels(zone, "fr").colour).toBe("Cyan");
  });

  test("returns nulls for an unknown colour rather than guessing", () => {
    expect(zoneLabels("#123456", "ar")).toEqual({ colour: null, name: null });
    expect(zoneLabels(null, "fr")).toEqual({ colour: null, name: null });
    expect(zoneLabels({ colorHex: null }, "ar")).toEqual({ colour: null, name: null });
  });
});

import { describe, it, expect } from "vitest";
import {
  buildRejectionTree,
  validateRejectionPair,
  findRejectionConfig,
  SEED_GROUP_HUES,
} from "./rejection-config";
import { REJECTION_GROUPS, REJECTION_SUBREASONS } from "./rejection-taxonomy";
import type { RejectionReasonConfig } from "@/types/rejection-config";

const MARKET = "m-tn";

let seq = 0;
function row(over: Partial<RejectionReasonConfig>): RejectionReasonConfig {
  seq += 1;
  return {
    id: `r${seq}`,
    market_id: MARKET,
    parent_key: null,
    key: `k${seq}`,
    label_fr: "Label",
    label_ar: "تسمية",
    short_fr: "L",
    short_ar: "ت",
    hue: "red",
    sort_order: 0,
    is_active: true,
    requires_note: false,
    created_at: "2026-09-19T00:00:00Z",
    updated_at: "2026-09-19T00:00:00Z",
    ...over,
  };
}

/** The shape the seed produces: two groups, each with two sub-reasons. */
function sampleRows(): RejectionReasonConfig[] {
  return [
    row({ key: "refus_client", hue: "red", sort_order: 0 }),
    row({ key: "prix_eleve", parent_key: "refus_client", sort_order: 0 }),
    row({ key: "achete_ailleurs", parent_key: "refus_client", sort_order: 1 }),
    row({ key: "injoignable", hue: "amber", sort_order: 1 }),
    row({ key: "raccroche", parent_key: "injoignable", sort_order: 0 }),
    row({ key: "pas_de_reponse", parent_key: "injoignable", sort_order: 1 }),
    row({ key: "autre", hue: "neutral", sort_order: 2, requires_note: true }),
  ];
}

describe("buildRejectionTree", () => {
  it("nests sub-reasons under their group", () => {
    const tree = buildRejectionTree(sampleRows());

    expect(tree.map((g) => g.key)).toEqual([
      "refus_client",
      "injoignable",
      "autre",
    ]);
    expect(tree[0].subreasons.map((s) => s.key)).toEqual([
      "prix_eleve",
      "achete_ailleurs",
    ]);
    expect(tree[2].subreasons).toEqual([]);
  });

  it("sorts groups and sub-reasons by sort_order, not insertion order", () => {
    const rows = [
      row({ key: "injoignable", sort_order: 5 }),
      row({ key: "refus_client", sort_order: 1 }),
      row({ key: "b", parent_key: "refus_client", sort_order: 9 }),
      row({ key: "a", parent_key: "refus_client", sort_order: 2 }),
    ];

    const tree = buildRejectionTree(rows);
    expect(tree.map((g) => g.key)).toEqual(["refus_client", "injoignable"]);
    expect(tree[0].subreasons.map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("drops retired rows when activeOnly is set, and keeps them otherwise", () => {
    const rows = [
      ...sampleRows(),
      row({ key: "doublon", parent_key: "refus_client", is_active: false }),
    ];

    const picker = buildRejectionTree(rows, { activeOnly: true });
    expect(picker[0].subreasons.map((s) => s.key)).not.toContain("doublon");

    const all = buildRejectionTree(rows);
    expect(all[0].subreasons.map((s) => s.key)).toContain("doublon");
  });

  it("hides a whole group when the group row itself is retired", () => {
    const rows = sampleRows().map((r) =>
      r.key === "injoignable" ? { ...r, is_active: false } : r,
    );

    expect(
      buildRejectionTree(rows, { activeOnly: true }).map((g) => g.key),
    ).toEqual(["refus_client", "autre"]);
  });

  it("ignores a sub-reason whose parent group does not exist", () => {
    const rows = [
      ...sampleRows(),
      row({ key: "orphelin", parent_key: "groupe_supprime" }),
    ];

    const tree = buildRejectionTree(rows);
    expect(tree.flatMap((g) => g.subreasons).map((s) => s.key)).not.toContain(
      "orphelin",
    );
  });
});

describe("findRejectionConfig", () => {
  it("finds a row by key regardless of level", () => {
    const rows = sampleRows();
    expect(findRejectionConfig(rows, "injoignable")?.parent_key).toBeNull();
    expect(findRejectionConfig(rows, "raccroche")?.parent_key).toBe(
      "injoignable",
    );
  });

  it("returns null for an unknown or empty key", () => {
    expect(findRejectionConfig(sampleRows(), "nope")).toBeNull();
    expect(findRejectionConfig(sampleRows(), null)).toBeNull();
  });
});

describe("validateRejectionPair", () => {
  const tree = () => buildRejectionTree(sampleRows(), { activeOnly: true });

  it("accepts a group with one of its own sub-reasons", () => {
    expect(validateRejectionPair(tree(), "refus_client", "prix_eleve")).toBe(
      true,
    );
  });

  it("rejects a sub-reason borrowed from another group", () => {
    expect(validateRejectionPair(tree(), "refus_client", "raccroche")).toBe(
      false,
    );
  });

  it("rejects an unknown group and an unknown sub-reason", () => {
    expect(validateRejectionPair(tree(), "inconnu", "prix_eleve")).toBe(false);
    expect(validateRejectionPair(tree(), "refus_client", "inconnu")).toBe(false);
  });

  // The rule that stops the taxonomy decaying back to "everything is autre".
  it("rejects a bare group when that group has sub-reasons to offer", () => {
    expect(validateRejectionPair(tree(), "refus_client", null)).toBe(false);
  });

  it("requires a bare group for a note-only group, and refuses a sub-reason there", () => {
    expect(validateRejectionPair(tree(), "autre", null)).toBe(true);
    expect(validateRejectionPair(tree(), "autre", "prix_eleve")).toBe(false);
  });

  // A manager who retires every sub-reason must not create a dead end where the
  // group can no longer be picked at all.
  it("accepts a bare group once all of its sub-reasons are retired", () => {
    const rows = sampleRows().map((r) =>
      r.parent_key === "injoignable" ? { ...r, is_active: false } : r,
    );
    const t = buildRejectionTree(rows, { activeOnly: true });

    expect(validateRejectionPair(t, "injoignable", null)).toBe(true);
  });

  it("refuses a retired sub-reason on a new rejection", () => {
    const rows = sampleRows().map((r) =>
      r.key === "prix_eleve" ? { ...r, is_active: false } : r,
    );
    const t = buildRejectionTree(rows, { activeOnly: true });

    expect(validateRejectionPair(t, "refus_client", "prix_eleve")).toBe(false);
  });
});

describe("SEED_GROUP_HUES", () => {
  // The fallback used before the config loads, and for legacy rows. If a group
  // is ever added to the taxonomy without a hue here, the badge silently turns
  // grey — so this asserts the two lists stay in step.
  it("covers every group in the hardcoded taxonomy", () => {
    for (const g of REJECTION_GROUPS) {
      expect(SEED_GROUP_HUES[g]).toBeTruthy();
    }
  });

  it("gives the four groups that carry sub-reasons four distinct hues", () => {
    const withSubs = REJECTION_GROUPS.filter(
      (g) => REJECTION_SUBREASONS[g].length > 0,
    );
    const hues = withSubs.map((g) => SEED_GROUP_HUES[g]);

    expect(new Set(hues).size).toBe(withSubs.length);
  });
});

import { describe, it, expect } from "vitest";
import { presentRejection } from "./rejection-presentation";
import type { RejectionReasonConfig } from "@/types/rejection-config";

let seq = 0;
function row(over: Partial<RejectionReasonConfig>): RejectionReasonConfig {
  seq += 1;
  return {
    id: `r${seq}`,
    market_id: "m",
    parent_key: null,
    key: `k${seq}`,
    label_fr: "Label long",
    label_ar: "تسمية طويلة",
    short_fr: "Court",
    short_ar: "قصير",
    sort_order: 0,
    is_active: true,
    requires_note: false,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

const CONFIG: RejectionReasonConfig[] = [
  row({
    key: "injoignable",
    short_fr: "Injoignable",
    short_ar: "تعذر",
    label_fr: "Injoignable long",
    label_ar: "تعذر طويل",
  }),
  row({
    key: "numero_invalide",
    parent_key: "injoignable",
    short_fr: "Faux n°",
    short_ar: "رقم خاطئ",
    label_fr: "Numéro faux ou inexistant",
    label_ar: "رقم خاطئ طويل",
  }),
  row({ key: "refus_client", short_fr: "Refus" }),
  row({ key: "autre", short_fr: "Autre", label_fr: "Autre long", requires_note: true }),
];

describe("presentRejection — icon", () => {
  // The group lives in the glyph, never in the colour: every hue in the status
  // palette already means a LIVE state (amber = still calling, violet =
  // confirmed, teal = shipped), so a group colour made dead orders look alive.
  it("takes the icon from the sub-reason's own group", () => {
    const { icon } = presentRejection(
      { reason: "injoignable", subreason: "numero_invalide" },
      CONFIG,
    );
    expect(icon).toBe("rejectedUnreachable");
  });

  it("resolves the group from the sub-reason when the reason column is empty", () => {
    const { icon } = presentRejection({ subreason: "numero_invalide" }, CONFIG);
    expect(icon).toBe("rejectedUnreachable");
  });

  it("gives each of the five groups its own icon, config loaded or not", () => {
    expect(presentRejection({ reason: "refus_client" }, []).icon).toBe("rejectedRefused");
    expect(presentRejection({ reason: "injoignable" }, []).icon).toBe("rejectedUnreachable");
    expect(presentRejection({ reason: "livraison_impossible" }, []).icon).toBe(
      "rejectedUndeliverable",
    );
    expect(presentRejection({ reason: "commande_invalide" }, []).icon).toBe("rejectedInvalid");
    expect(presentRejection({ reason: "autre" }, []).icon).toBe("rejectedOther");
  });

  it("gives the four legacy enum groups the icon of the group that absorbed them", () => {
    expect(presentRejection({ reason: "faux_numero" }, []).icon).toBe("rejectedUnreachable");
    expect(presentRejection({ reason: "prix" }, []).icon).toBe("rejectedRefused");
    expect(presentRejection({ reason: "doublon" }, []).icon).toBe("rejectedInvalid");
    expect(presentRejection({ reason: "non_serieux" }, []).icon).toBe("rejectedInvalid");
  });

  it("keeps the plain rejected mark when no group is known", () => {
    expect(presentRejection({}, CONFIG).icon).toBe("rejected");
    expect(presentRejection({ reason: "motif_invente" }, []).icon).toBe("rejected");
  });

  it("ignores any hue a stale config row still carries", () => {
    const stale = CONFIG.map((r) =>
      r.key === "injoignable" ? ({ ...r, hue: "teal" } as typeof r) : r,
    );
    const out = presentRejection({ reason: "injoignable" }, stale);
    expect(out).not.toHaveProperty("hue");
    expect(out.icon).toBe("rejectedUnreachable");
  });
});

describe("presentRejection — detail", () => {
  // The column fits "Faux n°"; the hover has room for the whole sentence, and
  // for an agent's note it is the only place the full text can be read.
  it("spells out group and sub-reason in full", () => {
    expect(
      presentRejection({ reason: "injoignable", subreason: "numero_invalide" }, CONFIG, "fr")
        .detail,
    ).toBe("Injoignable long · Numéro faux ou inexistant");
  });

  it("uses the Arabic labels in Arabic", () => {
    expect(
      presentRejection({ reason: "injoignable", subreason: "numero_invalide" }, CONFIG, "ar")
        .detail,
    ).toBe("تعذر طويل · رقم خاطئ طويل");
  });

  it("carries the agent's note whole, however long", () => {
    const note = "Le client dit avoir déjà reçu le même produit d'un autre vendeur hier soir";
    expect(presentRejection({ reason: "autre", note }, CONFIG, "fr").detail).toBe(
      `Autre long · ${note}`,
    );
  });

  it("appends a note left on a group that also has a sub-reason", () => {
    expect(
      presentRejection(
        { reason: "injoignable", subreason: "numero_invalide", note: "rappelé 2x" },
        CONFIG,
        "fr",
      ).detail,
    ).toBe("Injoignable long · Numéro faux ou inexistant · rappelé 2x");
  });

  it("is null until the config has loaded", () => {
    expect(presentRejection({ reason: "injoignable" }, []).detail).toBeNull();
  });
});

describe("presentRejection — label", () => {
  it("prefers the sub-reason's short label, in the active locale", () => {
    expect(
      presentRejection(
        { reason: "injoignable", subreason: "numero_invalide" },
        CONFIG,
        "fr",
      ).label,
    ).toEqual({ kind: "config", text: "Faux n°" });

    expect(
      presentRejection(
        { reason: "injoignable", subreason: "numero_invalide" },
        CONFIG,
        "ar",
      ).label,
    ).toEqual({ kind: "config", text: "رقم خاطئ" });
  });

  it("still labels a sub-reason that has since been retired", () => {
    const retired = CONFIG.map((r) =>
      r.key === "numero_invalide" ? { ...r, is_active: false } : r,
    );
    expect(
      presentRejection(
        { reason: "injoignable", subreason: "numero_invalide" },
        retired,
      ).label,
    ).toEqual({ kind: "config", text: "Faux n°" });
  });

  it("uses the agent's own words for `autre`, which is the only reason it exists", () => {
    expect(
      presentRejection(
        { reason: "autre", subreason: null, note: "  livre au voisin  " },
        CONFIG,
      ).label,
    ).toEqual({ kind: "note", text: "livre au voisin" });
  });

  it("falls back to the group's short label when there is no sub-reason", () => {
    expect(presentRejection({ reason: "refus_client" }, CONFIG).label).toEqual({
      kind: "config",
      text: "Refus",
    });
  });

  it("falls back to a translation key when the config has not loaded", () => {
    expect(
      presentRejection(
        { reason: "injoignable", subreason: "numero_invalide" },
        [],
      ).label,
    ).toEqual({
      kind: "i18n",
      ns: "orders.rejectionSubreasonsShort",
      key: "numero_invalide",
    });

    expect(presentRejection({ reason: "prix" }, []).label).toEqual({
      kind: "i18n",
      ns: "orders.rejectionReasons",
      key: "prix",
    });
  });

  it("says only 'rejected' when nothing else is known", () => {
    expect(presentRejection({}, CONFIG).label).toEqual({ kind: "status" });
    expect(presentRejection({ reason: "autre", note: "   " }, CONFIG).label).toEqual(
      { kind: "config", text: "Autre" },
    );
  });

  // A note long enough to break the column is the caller's problem to truncate,
  // but the module must not hand back a multi-line string.
  it("collapses whitespace in a free-text note", () => {
    expect(
      presentRejection({ reason: "autre", note: "pas\n  clair" }, CONFIG).label,
    ).toEqual({ kind: "note", text: "pas clair" });
  });
});

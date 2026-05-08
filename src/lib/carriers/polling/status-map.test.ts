import { describe, test, expect } from "vitest";
import { mapNavexStatus } from "./status-map";

describe("mapNavexStatus", () => {
  test.each([
    ["Au magasin", "deposit"],
    ["Enleve", "deposit"],
    ["Rtn depot", "deposit"],
    ["En cours", "in_transit"],
    ["Livrer", "delivered"],
    ["Rtn definitif", "to_be_returned"],
    ["Rtn client/agence", "returned"],
    ["Retour recu", "returned"],
    ["Retour paye", "returned"],
    ["Retour Expediteur", "returned"],
    ["A verifier", "unverified"],
    ["Supprime", "cancelled"],
  ])("maps %s → %s", (etat, expectedStatus) => {
    const result = mapNavexStatus(etat);
    expect(result).not.toBeNull();
    expect(result?.statusTo).toBe(expectedStatus);
    expect(result?.isDamaged).toBe(false);
    expect(result?.note).toContain(etat);
  });

  test.each([
    "En attente",
    "Echange",
    "A enlever",
    "Non recu",
  ])("ignores %s (returns null)", (etat) => {
    expect(mapNavexStatus(etat)).toBeNull();
  });

  test("unknown etat returns null", () => {
    expect(mapNavexStatus("Lorem ipsum")).toBeNull();
    expect(mapNavexStatus("")).toBeNull();
  });
});

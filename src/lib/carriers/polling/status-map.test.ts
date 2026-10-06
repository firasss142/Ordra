import { describe, test, expect } from "vitest";
import { mapNavexStatus } from "./status-map";

describe("mapNavexStatus", () => {
  test.each([
    ["Au magasin", "deposit"],
    ["Enleve", "deposit"],
    ["Rtn depot", "deposit"],
    ["En cours", "in_transit"],
    ["Livrer", "delivered"],
    // delivered AND paid — 91 parcels, 5 479 TND sat unknown until 2026-10-06
    ["Livrer Paye", "delivered"],
    // a return announced by Navex waits for the bench's scan (owner, 2026-10-06)
    ["Rtn definitif", "to_be_returned"],
    ["Rtn client/agence", "to_be_returned"],
    ["Retour recu", "to_be_returned"],
    ["Retour paye", "to_be_returned"],
    ["Retour Expediteur", "to_be_returned"],
    ["A verifier", "unverified"],
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

  test("never answers « returned » or « cancelled »: the scan and the managers set those", () => {
    for (const etat of ["Livrer", "Livrer Paye", "Retour recu", "Rtn client/agence", "Supprime"]) {
      expect(["returned", "cancelled"]).not.toContain(mapNavexStatus(etat)?.statusTo);
    }
  });

  test("« Supprime » is left unknown, so Journaux shows it instead of Ordra guessing", () => {
    expect(mapNavexStatus("Supprime")).toBeNull();
  });

  test("unknown etat returns null", () => {
    expect(mapNavexStatus("Lorem ipsum")).toBeNull();
    expect(mapNavexStatus("")).toBeNull();
  });
});

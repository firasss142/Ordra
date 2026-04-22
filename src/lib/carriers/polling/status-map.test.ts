import { describe, test, expect } from "vitest";
import { mapNavexStatus, mapDexpressStatus } from "./status-map";

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
    "A verifier",
    "Non recu",
    "Supprime",
  ])("ignores %s (returns null)", (etat) => {
    expect(mapNavexStatus(etat)).toBeNull();
  });

  test("unknown etat returns null", () => {
    expect(mapNavexStatus("Lorem ipsum")).toBeNull();
    expect(mapNavexStatus("")).toBeNull();
  });
});

describe("mapDexpressStatus", () => {
  test("status_key 10 → delivered", () => {
    const result = mapDexpressStatus(10, "تم التسليم");
    expect(result).not.toBeNull();
    expect(result?.statusTo).toBe("delivered");
    expect(result?.isDamaged).toBe(false);
  });

  test("status_key 1 → in_transit", () => {
    const result = mapDexpressStatus(1, "عند العميل");
    expect(result).not.toBeNull();
    expect(result?.statusTo).toBe("in_transit");
    expect(result?.isDamaged).toBe(false);
  });

  test.each([0, 2, 3, 4, 5, 6, 7, 8, 9, 11, 99])(
    "unknown status_key %i returns null",
    (key) => {
      expect(mapDexpressStatus(key, "مجهول")).toBeNull();
    }
  );
});

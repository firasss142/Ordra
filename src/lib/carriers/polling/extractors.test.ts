import { describe, test, expect } from "vitest";
import { parseNavexResponse } from "./extractors";

describe("parseNavexResponse", () => {
  test("extracts etat from direct object", () => {
    const body = { status: 1, etat: "En cours", status_message: "TRACK-1" };
    const result = parseNavexResponse("TRACK-1", body);
    expect(result.trackingNumber).toBe("TRACK-1");
    expect(result.etat).toBe("En cours");
    expect(result.rawBody).toBe(body);
  });

  test("extracts etat from array-wrapped response", () => {
    const body = [{ status: 1, etat: "Livrer", status_message: "TRACK-2" }];
    const result = parseNavexResponse("TRACK-2", body);
    expect(result.etat).toBe("Livrer");
  });

  test("returns null etat when empty string + ERREUR marker", () => {
    const body = { status: 0, etat: "", status_message: "ERREUR!." };
    const result = parseNavexResponse("BAD-TRACK", body);
    expect(result.etat).toBeNull();
  });

  test("returns null etat when etat is empty string without ERREUR", () => {
    const body = { status: 0, etat: "", status_message: "anything" };
    expect(parseNavexResponse("X", body).etat).toBeNull();
  });

  test("returns null etat when body shape is malformed", () => {
    expect(parseNavexResponse("X", "not-json").etat).toBeNull();
    expect(parseNavexResponse("X", null).etat).toBeNull();
    expect(parseNavexResponse("X", []).etat).toBeNull();
    expect(parseNavexResponse("X", {}).etat).toBeNull();
  });
});

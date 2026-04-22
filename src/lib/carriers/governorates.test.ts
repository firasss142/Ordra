import { describe, test, expect } from "vitest";
import {
  TUNISIAN_GOVERNORATES,
  resolveGovernorate,
} from "./governorates";

describe("TUNISIAN_GOVERNORATES", () => {
  test("contains exactly 24 governorates", () => {
    expect(TUNISIAN_GOVERNORATES).toHaveLength(24);
  });

  test("includes key governorates with correct names", () => {
    expect(TUNISIAN_GOVERNORATES).toContain("Tunis");
    expect(TUNISIAN_GOVERNORATES).toContain("Sousse");
    expect(TUNISIAN_GOVERNORATES).toContain("Sfax");
    expect(TUNISIAN_GOVERNORATES).toContain("Béja");
    expect(TUNISIAN_GOVERNORATES).toContain("Médenine");
    expect(TUNISIAN_GOVERNORATES).toContain("Kébili");
  });
});

describe("resolveGovernorate", () => {
  test("returns null for null city", () => {
    expect(resolveGovernorate(null)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(resolveGovernorate("")).toBeNull();
  });

  test("resolves known city to its governorate", () => {
    expect(resolveGovernorate("La Marsa")).toBe("Tunis");
    expect(resolveGovernorate("Hammamet")).toBe("Nabeul");
    expect(resolveGovernorate("Monastir")).toBe("Monastir");
  });

  test("resolves case-insensitively", () => {
    expect(resolveGovernorate("la marsa")).toBe("Tunis");
    expect(resolveGovernorate("LA MARSA")).toBe("Tunis");
    expect(resolveGovernorate("HAMMAMET")).toBe("Nabeul");
  });

  test("returns raw city as fallback for unknown city", () => {
    expect(resolveGovernorate("Some Unknown City")).toBe("Some Unknown City");
  });

  test("resolves governorate name directly to itself", () => {
    expect(resolveGovernorate("Tunis")).toBe("Tunis");
    expect(resolveGovernorate("Sousse")).toBe("Sousse");
    expect(resolveGovernorate("Sfax")).toBe("Sfax");
  });

  test("resolves common cities to correct governorates", () => {
    expect(resolveGovernorate("Radès")).toBe("Ben Arous");
    expect(resolveGovernorate("rades")).toBe("Ben Arous");
    expect(resolveGovernorate("Ariana")).toBe("Ariana");
    expect(resolveGovernorate("Le Bardo")).toBe("Tunis");
    expect(resolveGovernorate("Bizerte")).toBe("Bizerte");
  });
});

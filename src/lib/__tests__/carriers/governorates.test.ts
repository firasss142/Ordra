import { describe, test, expect } from "vitest";
import { mapCityToGovernorate, CITY_TO_GOVERNORATE } from "../../carriers/governorates-v2";

describe("mapCityToGovernorate", () => {
  test("returns Tunis for Tunis", () => {
    expect(mapCityToGovernorate("Tunis")).toBe("Tunis");
  });

  test("returns Sfax for Sfax", () => {
    expect(mapCityToGovernorate("Sfax")).toBe("Sfax");
  });

  test("maps La Marsa to Tunis", () => {
    expect(mapCityToGovernorate("La Marsa")).toBe("Tunis");
  });

  test("maps Hammam Sousse to Sousse", () => {
    expect(mapCityToGovernorate("Hammam Sousse")).toBe("Sousse");
  });

  test("maps Hammamet to Nabeul", () => {
    expect(mapCityToGovernorate("Hammamet")).toBe("Nabeul");
  });

  test("maps La Manouba to La Manouba", () => {
    expect(mapCityToGovernorate("La Manouba")).toBe("La Manouba");
  });

  test("unknown city passes through unchanged", () => {
    expect(mapCityToGovernorate("Unknown City XYZ")).toBe("Unknown City XYZ");
  });

  test("input is trimmed and case-insensitive: '  tunis  ' => Tunis", () => {
    expect(mapCityToGovernorate("  tunis  ")).toBe("Tunis");
  });

  test("CITY_TO_GOVERNORATE is exported and contains entries", () => {
    expect(CITY_TO_GOVERNORATE["tunis"]).toBe("Tunis");
    expect(CITY_TO_GOVERNORATE["la marsa"]).toBe("Tunis");
  });

  test("case-insensitive: TUNIS => Tunis", () => {
    expect(mapCityToGovernorate("TUNIS")).toBe("Tunis");
  });

  test("maps Rades to Ben Arous", () => {
    expect(mapCityToGovernorate("Rades")).toBe("Ben Arous");
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, test, expect } from "vitest";
import { generateSecret } from "./secret-gen";

describe("generateSecret", () => {
  test("returns 48-character hex string", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[0-9a-f]{48}$/);
  });

  test("returns different values across calls", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).not.toBe(b);
  });
});

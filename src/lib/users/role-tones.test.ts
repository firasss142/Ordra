import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Accès gives each role one hue (design-system §4.23). The hue is a fill and a
 * glyph; the -ink partner is what carries text. Reading the values out of
 * globals.css means a retuned token fails here instead of on someone's screen.
 */

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function token(name: string): string {
  const m = CSS.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} not found in globals.css`);
  const value = m[1].trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) throw new Error(`token --${name} is not a hex colour: ${value}`);
  return value;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const ROLES = ["agent", "warehouse", "manager", "investor", "admin"] as const;

describe("role tones", () => {
  for (const role of ROLES) {
    it(`${role}: ink on its tint clears 4.5:1`, () => {
      const r = contrast(token(`role-${role}-ink`), token(`role-${role}-bg`));
      expect(r, `${role} ink was ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${role}: the hue clears 3:1 on its tint, for dots and icons`, () => {
      const r = contrast(token(`role-${role}`), token(`role-${role}-bg`));
      expect(r, `${role} hue was ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    });

    it(`${role}: a wrapper class hands the hue to everything inside`, () => {
      expect(CSS).toMatch(new RegExp(`\\.tone-${role}\\s*\\{[^}]*--tone:\\s*var\\(--role-${role}\\)`));
    });
  }
});

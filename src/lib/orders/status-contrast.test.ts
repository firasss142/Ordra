import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The badge ink/tint pairs must clear WCAG AA for normal text.
 *
 * Amber shipped at 4.05:1 — on the attempt states, which are exactly the ones
 * an agent has to read. Reading the values out of globals.css rather than
 * restating them here means the test fails if someone retunes a token.
 */

const CSS = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

/** Resolves a token, following `var(--other)` aliases to the real hex. */
function token(name: string, depth = 0): string {
  if (depth > 5) throw new Error(`--${name} alias chain too deep`);
  const m = CSS.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} not found in globals.css`);
  const value = m[1].trim();
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias) return token(alias[1], depth + 1);
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
    throw new Error(`token --${name} is not a hex colour: ${value}`);
  }
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

function contrast(inkHex: string, bgHex: string): number {
  const a = luminance(inkHex);
  const b = luminance(bgHex);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const PAIRS: [string, string, string][] = [
  ["amber", "oms-warn-ink", "oms-warn-bg"],
  ["violet", "oms-accent-ink", "oms-accent-bg"],
  ["teal", "oms-info-ink", "oms-info-bg"],
  ["green", "oms-ok", "oms-ok-bg"],
  ["red", "oms-bad", "oms-bad-bg"],
  ["neutral", "oms-ink-2", "oms-surface-sunken"],
  // Chrome green. Not a status hue, but it sits on a tint in exactly the same
  // way (active KPI tile, selected row band) and drifts just as easily.
  ["brand", "brand-hover", "brand-bg"],
];

describe("status badge contrast", () => {
  for (const [name, ink, bg] of PAIRS) {
    it(`${name} ink on its own tint clears 4.5:1`, () => {
      const ratio = contrast(token(ink), token(bg));
      expect(ratio, `${ink} on ${bg} was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * The brand green is spent on filled chrome — the primary CTA, the active nav
 * pill — where the label is white. `--brand-primary` (#10B981) reaches only
 * 2.5:1 on white and must never take that job; these tests are what stops
 * someone reaching for it because it looks brighter.
 */
describe("brand chrome contrast", () => {
  it("white on the brand fill clears 4.5:1", () => {
    const ratio = contrast("#FFFFFF", token("brand"));
    expect(ratio, `white on --brand was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("the focus ring clears 3:1 on the page ground", () => {
    const ratio = contrast(token("focus-ring"), token("oms-bg"));
    expect(ratio, `--focus-ring on --oms-bg was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  it("the focus ring clears 3:1 on the sidebar ground", () => {
    const ratio = contrast(token("focus-ring"), token("sidebar-bg"));
    expect(ratio, `--focus-ring on --sidebar-bg was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });
});

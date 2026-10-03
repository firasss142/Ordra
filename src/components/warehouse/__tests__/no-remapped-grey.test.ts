import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The prototypes' neutral grey (`--selected`, #F2F2F2) — progress tracks, mute
 * chips, avatars — must not be written `bg-surface-selected` under
 * src/components/warehouse: globals.css remaps that class inside `.wh-console`
 * to the green selected-row tint (`--wh-ok-tint`), so every track and « mute »
 * chip on the Entrepôt screens rendered pale green (seen 2026-10-03 against
 * prototypes/entrepot-day-loop-*-v3.html). Use `bg-wm-track` instead.
 */
const ROOT = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("Entrepôt components — the prototype's grey stays grey", () => {
  it("never uses bg-surface-selected, which the console turns green", () => {
    const offenders = sources(ROOT).filter((f) => readFileSync(f, "utf8").includes("bg-surface-selected"));
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});

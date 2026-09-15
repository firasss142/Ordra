import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import fr from "@/messages/fr.json";

/**
 * A guard for a bug this page actually shipped: passing a pre-formatted
 * number — "1 694" — into an ICU plural argument. ICU parses the argument as
 * a number, a formatted string is not one, and the header read "NaN sans
 * agent" on the Tunisian market.
 *
 * ICU formats numbers itself, with the locale's own separators. So a numeric
 * argument must receive a number.
 */

type Leaf = [string, string];
const walk = (o: Record<string, unknown>, p = ""): Leaf[] =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? walk(v as Record<string, unknown>, `${p}${k}.`)
      : ([[`${p}${k}`, String(v)]] as Leaf[]),
  );

/** Every console key whose message treats an argument as a number. */
const numericArgs = new Set(
  walk(fr.prospects.console as unknown as Record<string, unknown>).flatMap(([key, value]) =>
    [...value.matchAll(/\{\s*(\w+)\s*,\s*(?:plural|number|selectordinal)/g)].map(
      (m) => `${key}|${m[1]}`,
    ),
  ),
);

const DIR = path.join(process.cwd(), "src/components/prospects/console");
const sources = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => [f, fs.readFileSync(path.join(DIR, f), "utf8")] as const);

describe("ICU numeric arguments receive numbers, not formatted strings", () => {
  test("the messages do declare numeric arguments", () => {
    // If this ever hits zero the guard below would pass vacuously.
    expect(numericArgs.size).toBeGreaterThan(10);
  });

  test("no call site passes fmt() into a plural or number argument", () => {
    const offenders: string[] = [];
    for (const [file, src] of sources) {
      for (const call of src.matchAll(/\bt\(\s*"([\w.]+)"\s*,\s*\{([^}]*)\}/g)) {
        const [, key, args] = call;
        for (const arg of args.matchAll(/(\w+)\s*:\s*fmt\(/g)) {
          if (numericArgs.has(`${key}|${arg[1]}`)) offenders.push(`${file}: t("${key}") → ${arg[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

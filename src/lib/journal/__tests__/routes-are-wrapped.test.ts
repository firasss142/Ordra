import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Every API handler goes through withRouteErrors(), or its 500s never reach
 * Journaux › « Ordra — erreurs et sécurité ». Deactivating a user answered 500
 * for nine days (2026-09-24 → PR #59) because nothing recorded it. A new route
 * that exports a bare `async function GET` fails here.
 */
const API = join(__dirname, "..", "..", "..", "app", "api");
const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routes(p);
    return name === "route.ts" ? [p] : [];
  });
}

describe("every API route records its server errors", () => {
  for (const file of routes(API)) {
    it(relative(API, file), () => {
      const src = readFileSync(file, "utf8");
      const bare = src.match(new RegExp(`^export (async )?function (${METHODS})\\b`, "gm")) ?? [];
      const consts = [...src.matchAll(new RegExp(`^export const (${METHODS}) = (.+)$`, "gm"))]
        .map((m) => m[2])
        .filter((rhs) => !rhs.startsWith("withRouteErrors(") && !rhs.startsWith("methodNotAllowed"));
      expect({ bare, unwrapped: consts }).toEqual({ bare: [], unwrapped: [] });
    });
  }
});

// A route's loading.tsx paints BEFORE the stylesheets the route imports have arrived: Next.js
// shows the prefetched fallback the instant a link is clicked, and only the page's own commit
// waits for its CSS. Seen on a production build (2026-10-08): /orders' skeleton painted blank
// and /products' as bare text, because each styled itself from its feature stylesheet; nine
// other routes still drew the pre-Aurore grey PageSkeleton.
//
// So a fallback may only use what is ALWAYS on the page — globals.css, through RouteSkeleton.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const APP = join(__dirname, "..");

function loadingFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : loadingFiles(p);
    return name === "loading.tsx" ? [p] : [];
  });
}

const files = loadingFiles(APP);

describe("route loading boundaries", () => {
  it("finds the loading files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [relative(APP, f), f]))("%s only uses RouteSkeleton", (_name, file) => {
    const src = readFileSync(file, "utf8");
    const imports = [...src.matchAll(/^import\s+(?:[^'"]+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]);

    expect(imports.filter((i) => i.endsWith(".css"))).toEqual([]);
    expect(imports.filter((i) => i !== "@/components/layout/RouteSkeleton")).toEqual([]);
    // the old fallback: a grey pulse with inline colours
    expect(src).not.toMatch(/animate-pulse|#[0-9A-Fa-f]{6}/);
  });
});

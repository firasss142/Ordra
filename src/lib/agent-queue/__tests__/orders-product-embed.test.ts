import { describe, expect, test } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guards the whole repo against ambiguous `orders` → `products` embeds.
 *
 * WHY THIS EXISTS
 * ---------------
 * `investor_order_facts` (migration 20260920000002_investor_facts.sql) holds a
 * FK to `orders` AND a FK to `products`. PostgREST reads that pair as a second
 * relationship between the two tables — a many-to-many join path — on top of
 * the direct `orders_product_id_fkey`. From that moment on, a bare
 * `products(...)` embed on an `orders` query is AMBIGUOUS and PostgREST refuses
 * it outright with PGRST201 / HTTP 300:
 *
 *   "Could not embed because more than one relationship was found"
 *
 * It is not a slow query or a partial result — every affected request fails.
 * That single migration silently broke six live queries at once (the agent
 * queue, the manager order list and its SSR prefetch, the team queue, the
 * unassigned list, the CSV export and the warehouse dispatch board), because
 * nothing in the app or the test suite ever asserted the embed stayed
 * unambiguous. The agent queue surfaced it as "خطأ في التحميل. إعادة
 * المحاولة..." on an endlessly retrying page.
 *
 * The fix is to name the FK explicitly — `products!orders_product_id_fkey(...)`
 * — which pins the relationship and is immune to any future table that
 * references both `orders` and `products`. This test keeps it that way: adding
 * such a table can no longer break these reads, and a new bare embed fails here
 * instead of in production.
 */

const SRC = path.resolve(__dirname, "../../..");

/**
 * Files whose `products(...)` embed hangs off an `orders` select.
 *
 * Resolved by reading each file and checking that a `.from("orders")` — or an
 * exported select constant consumed by one — governs the embed, rather than by
 * pattern-matching the column list. Embeds rooted at another table
 * (investor_deals, investor_ledger_entries, storefront_product_mappings, …)
 * have exactly one path to `products` and stay legal.
 */
function ordersScopedProductEmbeds(): string[] {
  let files: string[] = [];
  try {
    files = execSync(
      `grep -rl --include=*.ts --include=*.tsx -e 'products(' ${JSON.stringify(SRC)}`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }

  const offenders: string[] = [];
  for (const file of files) {
    if (file.includes("__tests__") || file.endsWith(".test.ts")) continue;
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");

    // A shared select constant is only reachable from an orders query, so its
    // embed counts as orders-scoped wherever it is declared.
    const isSharedOrdersSelect = /QUEUE_ROW_SELECT|LIST_SELECT|ORDERS_SELECT/.test(src);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/products\(/.test(line)) continue;
      if (/products!orders_product_id_fkey\(/.test(line)) continue;
      // Nested under another table's embed, e.g. investor_deals(label, products(name)).
      if (/\w+\(\s*[^()]*products\(/.test(line)) continue;

      // Walk back to the `.from("<table>")` that governs THIS select. A file may
      // query several tables; only an orders-rooted embed is ambiguous.
      let rooted = isSharedOrdersSelect;
      for (let j = i; j >= 0 && j > i - 25; j--) {
        const m = lines[j].match(/\.from\(\s*["'`](\w+)["'`]\s*\)/);
        if (m) {
          rooted = m[1] === "orders";
          break;
        }
      }
      if (rooted) offenders.push(`${file.replace(SRC, "src")}: ${line.trim()}`);
    }
  }
  return offenders;
}

describe("orders → products embeds are FK-disambiguated", () => {
  test("no query selecting from `orders` uses a bare products(...) embed", () => {
    expect(
      ordersScopedProductEmbeds(),
      "Bare products(...) embed on an orders select — PostgREST returns PGRST201 " +
        "(HTTP 300) because investor_order_facts creates a second orders↔products " +
        "path. Use products!orders_product_id_fkey(...) instead.",
    ).toEqual([]);
  });

  test("the agent queue select names the product FK explicitly", async () => {
    const { QUEUE_ROW_SELECT } = await import("../row-fields");
    expect(QUEUE_ROW_SELECT).toContain("products!orders_product_id_fkey(");
    expect(QUEUE_ROW_SELECT).not.toMatch(/[^!]products\(/);
  });
});

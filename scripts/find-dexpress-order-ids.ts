/**
 * Tiny helper: look up OMS order UUIDs for the tracking numbers we've probed.
 * Used to manually exercise GET /api/orders/{id}/dexpress-status in the browser.
 *
 *   npx tsx scripts/find-dexpress-order-ids.ts
 *   npx tsx scripts/find-dexpress-order-ids.ts <trackingNumber> [<trackingNumber>...]
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path: string) {
  let content: string;
  try {
    content = readFileSync(resolve(path), "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv(".env.local");

const trackings = process.argv.slice(2);
const defaults = ["1343188", "1339630", "1341657"];
const list = trackings.length > 0 ? trackings : defaults;

async function main() {
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await s
    .from("orders")
    .select(
      "id, tracking_number, status, market_id, carrier_id, carriers!inner(code)"
    )
    .in("tracking_number", list);

  if (error) {
    console.error("✗ query failed:", error);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log("No orders found for tracking numbers:", list.join(", "));
    console.log("");
    console.log("Try running with explicit tracking numbers:");
    console.log("  npx tsx scripts/find-dexpress-order-ids.ts 1234567");
    return;
  }

  console.log("");
  console.log("Found", data.length, "order(s):");
  console.log("");
  for (const row of data) {
    const r = row as {
      id: string;
      tracking_number: string | null;
      status: string;
      market_id: string;
      carrier_id: string | null;
      carriers: { code: string } | { code: string }[] | null;
    };
    const code = Array.isArray(r.carriers)
      ? r.carriers[0]?.code
      : r.carriers?.code;
    console.log(`  tracking #     : ${r.tracking_number}`);
    console.log(`  order UUID     : ${r.id}`);
    console.log(`  OMS status     : ${r.status}`);
    console.log(`  carrier code   : ${code}`);
    console.log(`  market_id      : ${r.market_id}`);
    console.log("");
    console.log(`  → URL to test  : /api/orders/${r.id}/dexpress-status`);
    console.log(
      "  ─────────────────────────────────────────────────────────"
    );
  }
}

main().catch((e) => {
  console.error("✗ failed:", e);
  process.exit(1);
});

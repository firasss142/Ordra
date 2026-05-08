/**
 * Seed dexpress_states from the static capture in
 * src/lib/carriers/dexpress/states-data.json.
 *
 * Dexpress has no API. The JSON was captured from the merchant portal's
 * destination dropdown. To refresh, re-scrape the dropdown HTML and
 * regenerate the JSON; see delivery_company_docs/Dexpress/dexpress-integration.md.
 *
 * Idempotent: re-running upserts in place. States no longer present in the
 * JSON are soft-deleted (status=0) rather than hard-deleted, so historical
 * orders keep working.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     tsx scripts/seed-dexpress-states-from-json.ts
 */

import { createClient } from "@supabase/supabase-js";
import statesData from "../src/lib/carriers/dexpress/states-data.json";

interface DexpressStateEntry {
  id: number;
  name: string;
  routeId: number;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRole) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
    );
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const entries = statesData as DexpressStateEntry[];
  console.log(`Loaded ${entries.length} entries from states-data.json`);

  // Upsert each entry. status=1 marks them as active.
  const rows = entries.map((s) => ({
    id: s.id,
    name: s.name,
    route_id: s.routeId,
    status: 1,
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertErr } = await supabase
    .from("dexpress_states")
    .upsert(rows, { onConflict: "id" });
  if (upsertErr) {
    throw new Error(`Upsert failed: ${upsertErr.message}`);
  }
  console.log(`Upserted ${rows.length} active states`);

  // Soft-delete any rows whose ids are no longer in the JSON.
  const activeIds = entries.map((s) => s.id);
  const { error: softDeleteErr, count } = await supabase
    .from("dexpress_states")
    .update({ status: 0, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("status", 1)
    .not("id", "in", `(${activeIds.join(",")})`);
  if (softDeleteErr) {
    throw new Error(`Soft-delete failed: ${softDeleteErr.message}`);
  }
  console.log(`Soft-deleted ${count ?? 0} stale states`);

  // Empty dexpress_places: the real Dexpress portal uses to_place=0 only.
  // The table stays in place for schema-compatibility but has no data.
  const { error: placesErr } = await supabase.from("dexpress_places").delete().neq("id", 0);
  if (placesErr) {
    throw new Error(`Wipe places failed: ${placesErr.message}`);
  }
  console.log("Cleared dexpress_places (unused with the portal integration)");

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

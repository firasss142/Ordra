/**
 * One-shot backfill of darb_shipments.remark_class for rows mirrored before
 * the classifier existed. New rows are classified by the sync itself
 * (darb-sync-cycle.ts); this only catches up history.
 *
 * Usage: npx tsx scripts/backfill-remark-class.ts [--dry]
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { classifyRemark } from "../src/lib/carriers/darb-remark-classifier";

const env = fs.readFileSync(".env.local", "utf8");
const get = (k: string) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_URL")!, get("SUPABASE_SERVICE_ROLE_KEY")!);
const dry = process.argv.includes("--dry");

type Row = {
  darb_id: string;
  latest_remark: string | null;
  latest_comment: string | null;
  cancellation_cause: string | null;
};

let all: Row[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from("darb_shipments")
    .select("darb_id, latest_remark, latest_comment, cancellation_cause")
    .range(from, from + 999);
  if (error) throw error;
  all = all.concat(data as Row[]);
  if (data.length < 1000) break;
}

const now = new Date().toISOString();
const counts: Record<string, number> = {};
let written = 0;

for (const r of all) {
  const c = classifyRemark({
    latestRemark: r.latest_remark,
    latestComment: r.latest_comment,
    cancellationCause: r.cancellation_cause,
  });
  counts[c.class] = (counts[c.class] ?? 0) + 1;
  if (dry) continue;
  const { error } = await sb
    .from("darb_shipments")
    .update({
      remark_class: c.class,
      remark_class_source: c.source,
      remark_classified_at: now,
    })
    .eq("darb_id", r.darb_id);
  if (error) throw error;
  written++;
}

console.log(`${all.length} shipments${dry ? " (dry run)" : `, ${written} written`}`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${String(v).padStart(5)}`);
}

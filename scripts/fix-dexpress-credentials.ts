/**
 * One-shot script to add merchant_id + from_state to the existing
 * Dexpress carrier row's encrypted credentials JSON.
 *
 * Usage:
 *   npx tsx scripts/fix-dexpress-credentials.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/crypto";

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv(".env.local");

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await supabase
    .from("carriers")
    .select("id, code, api_credentials")
    .eq("code", "dexpress")
    .single();

  if (error || !data) throw new Error(`No Dexpress carrier: ${error?.message}`);

  const decrypted = decrypt(data.api_credentials);
  const creds = JSON.parse(decrypted);

  console.log("Existing credential keys:", Object.keys(creds));

  const updated = {
    ...creds,
    merchant_id: creds.merchant_id ?? "807",
    from_state: creds.from_state ?? "62",
  };

  console.log("Updated credential keys:", Object.keys(updated));

  const reEncrypted = encrypt(JSON.stringify(updated));

  const { error: updateErr } = await supabase
    .from("carriers")
    .update({ api_credentials: reEncrypted })
    .eq("id", data.id);

  if (updateErr) throw new Error(`Update failed: ${updateErr.message}`);

  console.log("✓ Credentials updated. merchant_id=807 from_state=62");
}

main().catch((e) => { console.error(e); process.exit(1); });

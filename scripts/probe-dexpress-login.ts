import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";
import { DexpressClient } from "@/lib/carriers/dexpress/client";
import type { CarrierConfig } from "@/lib/carriers/types";

// Minimal .env.local loader — avoids the dotenv dep.
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

  const { data: carrier, error } = await supabase
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("code", "dexpress")
    .eq("is_active", true)
    .single();

  if (error || !carrier) throw new Error(`No active Dexpress carrier: ${error?.message}`);

  const creds = JSON.parse(decrypt(carrier.api_credentials));
  const config: CarrierConfig = {
    id: carrier.id,
    code: "dexpress",
    apiEndpoint: carrier.api_endpoint,
    apiCredentials: creds,
    deliveryFee: carrier.delivery_fee,
    returnFee: carrier.return_fee,
  };

  const client = new DexpressClient(carrier.id, config);

  console.log("→ ensureSession");
  const session = await client.ensureSession();
  console.log("✓ session ok, expires", session.expiresAt.toISOString());

  console.log("→ GET /merchant/add-orders");
  const page = await client.getMerchantPage("/merchant/add-orders");
  console.log("✓ status", page.status, "html length", page.html.length);
  const tokenMatch = page.html.match(/name="_token"\s+value="([^"]+)"/);
  console.log("✓ scraped _token:", tokenMatch?.[1]?.slice(0, 16) + "...");
}

main().catch((e) => { console.error(e); process.exit(1); });

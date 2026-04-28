/**
 * Seed dexpress_states and dexpress_places from the Shipping Eyes (Libya
 * carrier) live API. Authoritative source — avoids dealing with mojibake
 * SQL dumps and stays current as the carrier adds locations.
 *
 * Usage:
 *   SHIPPING_EYES_API_BASE=https://app.shippingeyes.com/api \
 *   SHIPPING_EYES_API_KEY=xxx \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   tsx scripts/seed-dexpress-from-api.ts
 */

import { createClient } from "@supabase/supabase-js";

interface DeliveryState {
  state_id: number;
  state_name: string;
  num_places: number;
}

interface DeliveryPlace {
  place_id: number;
  place_name: string;
}

interface ShippingEyesEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

async function callApi<T>(
  base: string,
  apiKey: string,
  path: string
): Promise<ShippingEyesEnvelope<T>> {
  const url = `${base.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
  });
  const json = (await res.json()) as ShippingEyesEnvelope<T>;
  if (json.code !== 4000 && json.code !== 3009) {
    throw new Error(`API ${path} → code ${json.code}: ${json.message}`);
  }
  return json;
}

async function main() {
  const apiBase = process.env.SHIPPING_EYES_API_BASE;
  const apiKey = process.env.SHIPPING_EYES_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiBase || !apiKey) {
    throw new Error(
      "SHIPPING_EYES_API_BASE and SHIPPING_EYES_API_KEY must be set"
    );
  }
  if (!supabaseUrl || !serviceRole) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });

  console.log("→ Fetching delivery-states…");
  const statesRes = await callApi<DeliveryState[]>(
    apiBase,
    apiKey,
    "/delivery-states"
  );
  const states = statesRes.data ?? [];
  console.log(`  got ${states.length} states`);

  if (states.length > 0) {
    const rows = states.map((s) => ({
      id: s.state_id,
      name: s.state_name,
      status: 1,
    }));
    const { error } = await supabase
      .from("dexpress_states")
      .upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`states upsert: ${error.message}`);
  }

  let totalPlaces = 0;
  for (const state of states) {
    if (state.num_places === 0) continue;
    process.stdout.write(`  fetching places for state ${state.state_id}… `);
    const placesRes = await callApi<DeliveryPlace[]>(
      apiBase,
      apiKey,
      `/delivery-places/${state.state_id}`
    );
    const places = placesRes.data ?? [];
    if (places.length === 0) {
      console.log("0");
      continue;
    }
    const rows = places.map((p) => ({
      id: p.place_id,
      state_id: state.state_id,
      name: p.place_name,
      status: 1,
    }));
    const { error } = await supabase
      .from("dexpress_places")
      .upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`places upsert state ${state.state_id}: ${error.message}`);
    totalPlaces += places.length;
    console.log(places.length);
  }

  console.log(
    `\n✓ Seeded ${states.length} states, ${totalPlaces} places.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

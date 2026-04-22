import { decrypt } from "@/lib/crypto";

export interface CarrierRowForPoll {
  api_credentials: string | null;
  api_endpoint: string | null;
}

function decodeCredentials(row: CarrierRowForPoll): Record<string, string> {
  if (!row.api_credentials) {
    throw new Error("Carrier has no api_credentials");
  }
  const plain = decrypt(row.api_credentials);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plain);
  } catch {
    throw new Error("Failed to parse carrier credentials");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Failed to parse carrier credentials");
  }
  return parsed as Record<string, string>;
}

function buildNavexStatusUrl(baseUrl: string, token: string): string {
  const dash = token.lastIndexOf("-");
  const etatKey =
    dash === -1
      ? `${token}-etat-`
      : `${token.slice(0, dash)}-etat-${token.slice(dash + 1)}`;
  return `${baseUrl.replace(/\/$/, "")}/${etatKey}/v1/post.php`;
}

export async function fetchNavexStatus(
  trackingNumber: string,
  row: CarrierRowForPoll
): Promise<unknown> {
  const creds = decodeCredentials(row);
  const token = creds.token;
  if (!token) throw new Error("Navex: token missing from credentials");

  const base = row.api_endpoint || "https://app.navex.tn/api";
  const url = buildNavexStatusUrl(base, token);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `code=${encodeURIComponent(trackingNumber)}`,
    signal: AbortSignal.timeout(15000),
  });

  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

export async function fetchDexpressBatch(
  trackingNumbers: string[],
  row: CarrierRowForPoll
): Promise<unknown> {
  if (trackingNumbers.length === 0) {
    return { code: 4000, data: [] };
  }

  const creds = decodeCredentials(row);
  const apiKey = creds.api_key;
  if (!apiKey) throw new Error("Dexpress: api_key missing from credentials");

  const base = creds.api_base_url || row.api_endpoint || "";
  const url = `${base.replace(/\/$/, "")}/mutable-order-tracking`;

  const body = new URLSearchParams({
    orders_codes: trackingNumbers.join(","),
  }).toString();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: apiKey,
    },
    body,
    signal: AbortSignal.timeout(20000),
  });

  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

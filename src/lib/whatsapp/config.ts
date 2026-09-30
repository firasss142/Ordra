/**
 * The per-market WhatsApp credential row, decrypted.
 *
 * `whatsapp_configs` has RLS on with zero policies and no grants to
 * `authenticated`: the access token can message every customer of a market
 * and the app secret authenticates Meta's webhooks. It is reachable only
 * through the service role, only here. Routes return `toPublicConfig` and
 * nothing else.
 */
import { decrypt, maskCredential } from "@/lib/crypto";
import type { ConfigStatus } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AdminClient = {
  from: (table: string) => any;
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const CONFIG_COLUMNS =
  "id, market_id, waba_id, phone_number_id, app_id, graph_version, access_token, app_secret, verify_token, display_phone, verified_name, quality_rating, messaging_limit_tier, status, status_reason, send_rate_per_sec, last_webhook_at, last_checked_at, last_error, created_at, updated_at";

/**
 * The last staged test (Connexions › Services), persisted so the five-stage
 * checklist survives a reload. A column list of its own on purpose: only the
 * card reads it, and the send / webhook paths keep selecting CONFIG_COLUMNS,
 * so a deploy that runs before 20260925160000 cannot break sending.
 */
export const CONFIG_LAST_TEST_COLUMNS = "last_test_at, last_test_ok, last_test_stages";

export interface ConfigRow {
  id: string;
  market_id: string;
  waba_id: string;
  phone_number_id: string;
  app_id: string;
  graph_version: string;
  access_token: string;
  app_secret: string;
  verify_token: string;
  display_phone: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  status: ConfigStatus;
  status_reason: string | null;
  send_rate_per_sec: number;
  last_webhook_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  /** Only when CONFIG_LAST_TEST_COLUMNS was selected (the card). */
  last_test_at?: string | null;
  last_test_ok?: boolean | null;
  last_test_stages?: unknown;
}

/** Decrypted, server-only. */
export interface WhatsAppConfig {
  id: string;
  marketId: string;
  wabaId: string;
  phoneNumberId: string;
  appId: string;
  graphVersion: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  displayPhone: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  status: ConfigStatus;
  statusReason: string | null;
  sendRatePerSec: number;
  lastWebhookAt: string | null;
  /** True when ENCRYPTION_KEY no longer opens this row. */
  decryptFailed: boolean;
}

function safeDecrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return "";
  try {
    return decrypt(ciphertext);
  } catch {
    return null;
  }
}

export function fromRow(row: ConfigRow): WhatsAppConfig {
  const accessToken = safeDecrypt(row.access_token);
  const appSecret = safeDecrypt(row.app_secret);
  const verifyToken = safeDecrypt(row.verify_token);
  const decryptFailed = accessToken === null || appSecret === null || verifyToken === null;
  return {
    id: row.id,
    marketId: row.market_id,
    wabaId: row.waba_id,
    phoneNumberId: row.phone_number_id,
    appId: row.app_id,
    graphVersion: row.graph_version,
    accessToken: accessToken ?? "",
    appSecret: appSecret ?? "",
    verifyToken: verifyToken ?? "",
    displayPhone: row.display_phone,
    verifiedName: row.verified_name,
    qualityRating: row.quality_rating,
    messagingLimitTier: row.messaging_limit_tier,
    // A row we cannot decrypt cannot send; report it as an auth failure so
    // every caller takes the "do not send" branch without a special case.
    status: decryptFailed ? "auth_failed" : row.status,
    statusReason: decryptFailed ? "Stored credentials could not be decrypted — ENCRYPTION_KEY may have changed." : row.status_reason,
    sendRatePerSec: Number(row.send_rate_per_sec) > 0 ? Number(row.send_rate_per_sec) : 3,
    lastWebhookAt: row.last_webhook_at,
    decryptFailed,
  };
}

async function loadOne(admin: AdminClient, column: string, value: string): Promise<WhatsAppConfig | null> {
  const { data, error } = await admin.from("whatsapp_configs").select(CONFIG_COLUMNS).eq(column, value).maybeSingle();
  if (error) throw new Error(`whatsapp_configs read failed: ${(error as { message?: string }).message ?? "unknown"}`);
  return data ? fromRow(data as ConfigRow) : null;
}

export function loadConfigForMarket(admin: AdminClient, marketId: string): Promise<WhatsAppConfig | null> {
  return loadOne(admin, "market_id", marketId);
}

export function loadConfigByPhoneNumberId(admin: AdminClient, phoneNumberId: string): Promise<WhatsAppConfig | null> {
  return loadOne(admin, "phone_number_id", phoneNumberId);
}

export function loadConfigByWabaId(admin: AdminClient, wabaId: string): Promise<WhatsAppConfig | null> {
  return loadOne(admin, "waba_id", wabaId);
}

export async function loadAllConfigs(admin: AdminClient): Promise<WhatsAppConfig[]> {
  const { data, error } = await admin.from("whatsapp_configs").select(CONFIG_COLUMNS).order("created_at", { ascending: true });
  if (error) throw new Error(`whatsapp_configs read failed: ${(error as { message?: string }).message ?? "unknown"}`);
  return ((data ?? []) as ConfigRow[]).map(fromRow);
}

export async function loadActiveConfigs(admin: AdminClient): Promise<WhatsAppConfig[]> {
  const { data, error } = await admin
    .from("whatsapp_configs")
    .select(CONFIG_COLUMNS)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`whatsapp_configs read failed: ${(error as { message?: string }).message ?? "unknown"}`);
  return ((data ?? []) as ConfigRow[]).map(fromRow).filter((c) => !c.decryptFailed);
}

export async function markConfigStatus(
  admin: AdminClient,
  configId: string,
  status: ConfigStatus,
  reason: string | null,
): Promise<void> {
  await admin
    .from("whatsapp_configs")
    .update({ status, status_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", configId);
}

/** Never let a secret past this function. */
export function toPublicConfig(row: ConfigRow) {
  const { access_token, app_secret, verify_token, ...rest } = row;
  return {
    ...rest,
    token_masked: maskCredential(access_token),
    has_app_secret: Boolean(app_secret),
    has_verify_token: Boolean(verify_token),
  };
}

export type PublicConfig = ReturnType<typeof toPublicConfig>;

/**
 * A verify token for Meta's webhook handshake. Meta only echoes it back on the
 * GET verification, so it needs no more entropy than "unguessable"; the
 * market code prefix lets an operator tell the two apart in the Meta console.
 */
export function generateVerifyToken(marketCode: string): string {
  const hex = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `ordra-${marketCode || "wa"}-${hex}`;
}

/** Template counts per market, for the Connexions card. */
export async function loadTemplateCounts(
  admin: AdminClient,
  marketIds: string[],
): Promise<Record<string, { approved: number; pending: number; rejected: number }>> {
  const out: Record<string, { approved: number; pending: number; rejected: number }> = {};
  for (const id of marketIds) out[id] = { approved: 0, pending: 0, rejected: 0 };
  if (marketIds.length === 0) return out;
  const { data } = await admin.from("whatsapp_templates").select("market_id, status").in("market_id", marketIds);
  for (const row of (data ?? []) as { market_id: string; status: string }[]) {
    const bucket = out[row.market_id];
    if (!bucket) continue;
    if (row.status === "APPROVED") bucket.approved++;
    else if (row.status === "PENDING") bucket.pending++;
    else if (row.status === "REJECTED") bucket.rejected++;
  }
  return out;
}

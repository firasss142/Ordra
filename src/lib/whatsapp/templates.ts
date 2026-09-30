/**
 * The template registry: what Meta holds, mirrored into `whatsapp_templates`
 * with the two facts Meta does not know — which lifecycle event a template
 * serves, and the NAMES bound to its numbered placeholders.
 *
 * Server-only (uses the Graph client).
 */
import type { AdminClient, WhatsAppConfig } from "./config";
import type { MetaTemplate, WhatsAppClient } from "./client";
import { CATALOGUE, SAMPLE_VALUES, templateNameFor, type CatalogueKey, type CatalogueTemplate } from "./catalogue";
import type { CustomerLang, LifecycleEventKey, TemplateVariable } from "./types";

const PLACEHOLDER = /\{\{(\d+)\}\}/g;

export function placeholderCount(text: string): number {
  return new Set(Array.from(text.matchAll(PLACEHOLDER)).map((m) => m[1])).size;
}

/** `ordra_<key>_v<n>` → the catalogue key and version, or null for anything else. */
export function catalogueKeyFromName(name: string): { key: CatalogueKey; version: number } | null {
  const m = /^ordra_([a-z_]+)_v(\d+)$/.exec(name);
  if (!m) return null;
  const key = m[1] as CatalogueKey;
  if (!CATALOGUE.some((e) => e.key === key)) return null;
  return { key, version: Number(m[2]) };
}

/** Meta's language code → ours. `ar`, `ar_EG`… → ar; `fr`, `fr_FR` → fr; else the bare prefix. */
export function normalizeLanguage(code: string): string {
  return code.toLowerCase().split(/[_-]/)[0];
}

/**
 * The components Meta's `POST /{waba}/message_templates` wants. Every
 * placeholder needs an example (Meta reviews the rendered sample), and an
 * IMAGE header needs the handle from the resumable upload.
 */
export function toMetaComponents(entry: CatalogueTemplate, lang: CustomerLang, headerHandle?: string | null): unknown[] {
  const components: unknown[] = [];
  if (entry.headerFormat === "IMAGE") {
    if (!headerHandle) throw new Error("An IMAGE header needs an upload handle");
    components.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [headerHandle] } });
  }
  const body: Record<string, unknown> = { type: "BODY", text: entry.body[lang] };
  if (entry.variables.length > 0) {
    body.example = { body_text: [entry.variables.map((v) => SAMPLE_VALUES[lang][v])] };
  }
  components.push(body);
  if (entry.footer) components.push({ type: "FOOTER", text: entry.footer[lang] });
  return components;
}

export function fromMetaComponents(components: unknown[]): { bodyText: string; headerFormat: string | null; footerText: string | null } {
  let bodyText = "";
  let headerFormat: string | null = null;
  let footerText: string | null = null;
  for (const raw of components) {
    const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const type = typeof c.type === "string" ? c.type.toUpperCase() : "";
    if (type === "BODY" && typeof c.text === "string") bodyText = c.text;
    else if (type === "HEADER" && typeof c.format === "string") headerFormat = c.format.toUpperCase();
    else if (type === "FOOTER" && typeof c.text === "string") footerText = c.text;
  }
  return { bodyText, headerFormat, footerText };
}

interface RegistryRow {
  id: string;
  market_id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  status: string;
  event_key: string | null;
  variables: string[] | null;
  source: string;
  catalogue_key: string | null;
}

const REGISTRY_COLUMNS = "id, market_id, meta_template_id, name, language, status, event_key, variables, source, catalogue_key";

async function loadRegistry(admin: AdminClient, marketId: string): Promise<RegistryRow[]> {
  const { data, error } = await admin.from("whatsapp_templates").select(REGISTRY_COLUMNS).eq("market_id", marketId);
  if (error) throw new Error(`whatsapp_templates read failed: ${(error as { message?: string }).message}`);
  return (data ?? []) as RegistryRow[];
}

/** Which (event, language) pairs are already taken — the partial unique index in memory. */
function takenEvents(rows: RegistryRow[]): Set<string> {
  return new Set(rows.filter((r) => r.event_key).map((r) => `${r.event_key}|${r.language}`));
}

function catalogueFacts(name: string): { entry: CatalogueTemplate; catalogueKey: CatalogueKey; eventKey: LifecycleEventKey | null; variables: TemplateVariable[] } | null {
  const parsed = catalogueKeyFromName(name);
  if (!parsed) return null;
  const entry = CATALOGUE.find((e) => e.key === parsed.key)!;
  return { entry, catalogueKey: entry.key, eventKey: entry.eventKey, variables: entry.variables };
}

export interface SyncResult {
  total: number;
  inserted: number;
  updated: number;
  deleted: number;
}

/**
 * Pull Meta's list and mirror it. Existing rows keep their event mapping and
 * variable names; new rows infer both from the catalogue when the name is
 * ours; rows Meta no longer lists are marked DELETED (never removed — a
 * message row may still point at them).
 */
export async function syncTemplatesFromMeta(admin: AdminClient, cfg: WhatsAppConfig, client: WhatsAppClient): Promise<SyncResult> {
  const remote = await client.listTemplates();
  const rows = await loadRegistry(admin, cfg.marketId);
  const taken = takenEvents(rows);
  const byKey = new Map(rows.map((r) => [`${r.name}|${r.language}`, r]));
  const now = new Date().toISOString();
  const result: SyncResult = { total: remote.length, inserted: 0, updated: 0, deleted: 0 };
  const seenIds = new Set<string>();

  for (const t of remote) {
    const language = normalizeLanguage(t.language);
    const parts = fromMetaComponents(t.components);
    const common = {
      meta_template_id: t.id,
      category: t.category,
      status: t.status,
      rejected_reason: t.status === "REJECTED" ? t.rejectedReason : null,
      components: t.components,
      body_text: parts.bodyText,
      header_format: parts.headerFormat,
      footer_text: parts.footerText,
      synced_at: now,
      updated_at: now,
    };
    seenIds.add(t.id);
    const existing = byKey.get(`${t.name}|${language}`);
    if (existing) {
      const { error } = await admin.from("whatsapp_templates").update(common).eq("id", existing.id);
      if (error) throw new Error(`template update failed: ${(error as { message?: string }).message}`);
      result.updated++;
      continue;
    }
    const facts = catalogueFacts(t.name);
    const mappable = facts?.eventKey && (language === "ar" || language === "fr") && !taken.has(`${facts.eventKey}|${language}`);
    const row = {
      market_id: cfg.marketId,
      name: t.name,
      language,
      ...common,
      variables: facts ? facts.variables : [],
      catalogue_key: facts ? facts.catalogueKey : null,
      event_key: mappable ? facts!.eventKey : null,
      source: facts ? "catalogue" : "synced",
    };
    const { error } = await admin.from("whatsapp_templates").insert(row);
    if (error) throw new Error(`template insert failed: ${(error as { message?: string }).message}`);
    if (mappable) taken.add(`${facts!.eventKey}|${language}`);
    result.inserted++;
  }

  for (const r of rows) {
    if (r.meta_template_id && !seenIds.has(r.meta_template_id) && r.status !== "DELETED") {
      await admin.from("whatsapp_templates").update({ status: "DELETED", synced_at: now, updated_at: now }).eq("id", r.id);
      result.deleted++;
    }
  }
  return result;
}

export interface CreateCatalogueOptions {
  /** Reads public/whatsapp/product-sample.jpg (injected so tests need no fs). */
  readSampleImage: () => Promise<{ bytes: Uint8Array; mime: string; name: string }>;
}

export interface CreateCatalogueResult {
  created: string[];
  skipped: string[];
  failed: { name: string; language: string; error: string }[];
}

const RESUBMITTABLE = new Set(["REJECTED", "DELETED", "DISABLED"]);

/**
 * « Créer les modèles Ordra »: submit every catalogue entry in both
 * languages that neither Meta nor the registry holds, register the ones Meta
 * already has, and map lifecycle events immediately. A REJECTED entry is
 * resubmitted as the next version — an approved or pending name cannot be
 * edited on Meta's side.
 */
export async function createMissingCatalogueTemplates(
  admin: AdminClient,
  cfg: WhatsAppConfig,
  client: WhatsAppClient,
  opts: CreateCatalogueOptions,
): Promise<CreateCatalogueResult> {
  const remote = await client.listTemplates();
  const remoteByKey = new Map<string, MetaTemplate>();
  for (const t of remote) remoteByKey.set(`${t.name}|${normalizeLanguage(t.language)}`, t);
  const rows = await loadRegistry(admin, cfg.marketId);
  const rowByKey = new Map(rows.map((r) => [`${r.name}|${r.language}`, r]));
  const taken = takenEvents(rows);
  const now = new Date().toISOString();
  const result: CreateCatalogueResult = { created: [], skipped: [], failed: [] };

  let headerHandle: string | null = null;
  const getHandle = async () => {
    if (headerHandle) return headerHandle;
    const img = await opts.readSampleImage();
    const session = await client.createUploadSession({ fileLength: img.bytes.byteLength, fileType: img.mime, fileName: img.name });
    headerHandle = await client.uploadChunk({ sessionId: session, bytes: img.bytes });
    return headerHandle;
  };

  const eventFor = (entry: CatalogueTemplate, lang: CustomerLang): LifecycleEventKey | null =>
    entry.eventKey && !taken.has(`${entry.eventKey}|${lang}`) ? entry.eventKey : null;

  const registerRow = async (entry: CatalogueTemplate, lang: CustomerLang, name: string, meta: { id: string; status: string; category: string }, components: unknown[]) => {
    const eventKey = eventFor(entry, lang);
    const parts = fromMetaComponents(components);
    const { error } = await admin.from("whatsapp_templates").insert({
      market_id: cfg.marketId,
      meta_template_id: meta.id,
      name,
      language: lang,
      category: meta.category || entry.category,
      status: meta.status || "PENDING",
      rejected_reason: null,
      components,
      body_text: parts.bodyText || entry.body[lang],
      header_format: parts.headerFormat ?? entry.headerFormat,
      footer_text: parts.footerText ?? entry.footer?.[lang] ?? null,
      variables: entry.variables,
      event_key: eventKey,
      catalogue_key: entry.key,
      source: "catalogue",
      synced_at: now,
    });
    if (error) throw new Error(`template insert failed: ${(error as { message?: string }).message}`);
    if (eventKey) taken.add(`${eventKey}|${lang}`);
  };

  for (const entry of CATALOGUE) {
    for (const lang of ["fr", "ar"] as const) {
      // Highest version already known for this entry/lang, in Meta or in the registry.
      const versions = [...rows, ...remote.map((t) => ({ name: t.name, language: normalizeLanguage(t.language), status: t.status }))]
        .filter((r) => r.language === lang && catalogueKeyFromName(r.name)?.key === entry.key)
        .map((r) => ({ v: catalogueKeyFromName(r.name)!.version, status: r.status, name: r.name }));
      const latest = versions.sort((a, b) => b.v - a.v)[0];
      const label = (n: string) => `${n}/${lang}`;

      if (latest && !RESUBMITTABLE.has(latest.status)) {
        // Exists and is usable (or pending). Make sure the registry knows it.
        const key = `${latest.name}|${lang}`;
        if (!rowByKey.has(key)) {
          const meta = remoteByKey.get(key);
          if (meta) {
            try {
              await registerRow(entry, lang, latest.name, { id: meta.id, status: meta.status, category: meta.category }, meta.components);
            } catch (err) {
              result.failed.push({ name: latest.name, language: lang, error: err instanceof Error ? err.message : String(err) });
              continue;
            }
          }
        }
        result.skipped.push(label(latest.name));
        continue;
      }

      const version = latest ? latest.v + 1 : 1;
      const name = templateNameFor(entry.key, version);
      try {
        const components = toMetaComponents(entry, lang, entry.headerFormat === "IMAGE" ? await getHandle() : null);
        const created = await client.createTemplate({ name, language: lang, category: entry.category, components });
        await registerRow(entry, lang, name, created, components);
        result.created.push(label(name));
      } catch (err) {
        result.failed.push({ name, language: lang, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return result;
}

/**
 * Submit a campaign's MARKETING template to Meta and register it. The
 * campaign is created first (the row id is the registry's `campaign_id`);
 * the webhook later flips the template AND the campaign together.
 */
export async function submitCampaignTemplate(
  admin: AdminClient,
  cfg: WhatsAppConfig,
  client: WhatsAppClient,
  input: { campaignId: string; name: string; language: CustomerLang; components: unknown[]; bodyText: string; variables: TemplateVariable[]; footerText: string; headerFormat: "IMAGE" | null },
): Promise<{ templateId: string; metaTemplateId: string; status: string }> {
  const created = await client.createTemplate({ name: input.name, language: input.language, category: "MARKETING", components: input.components });
  const { data, error } = await admin
    .from("whatsapp_templates")
    .insert({
      market_id: cfg.marketId,
      meta_template_id: created.id,
      name: input.name,
      language: input.language,
      category: "MARKETING",
      status: created.status || "PENDING",
      components: input.components,
      body_text: input.bodyText,
      header_format: input.headerFormat,
      footer_text: input.footerText,
      variables: input.variables,
      event_key: null,
      catalogue_key: null,
      source: "campaign",
      campaign_id: input.campaignId,
      synced_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`template insert failed: ${(error as { message?: string } | null)?.message ?? "no row"}`);
  return { templateId: (data as { id: string }).id, metaTemplateId: created.id, status: created.status || "PENDING" };
}

/**
 * A manager's campaign text → a Meta MARKETING template.
 *
 * The composer speaks in French tokens ({nom} {produit} {ville} {remise});
 * Meta wants {{1}}..{{n}} numbered by first appearance with an example for
 * each; the registry keeps the names so the drain can bind lead fields.
 * Client-safe (no server imports): the composer validates as the manager
 * types, the route validates again before submitting.
 */
import { OPT_OUT_FOOTER_TEXT, SAMPLE_VALUES } from "./catalogue";
import type { CustomerLang, TemplateVariable } from "./types";

export const CAMPAIGN_VARIABLES: Record<string, TemplateVariable> = {
  nom: "name",
  produit: "product",
  ville: "city",
  remise: "discount",
};

export const CAMPAIGN_BODY_MAX = 1024;
export const CAMPAIGN_MAX_VARIABLES = 10;

export type CampaignBodyError =
  | "empty"
  | "too_long"
  | "starts_with_variable"
  | "ends_with_variable"
  | "unknown_variable"
  | "too_many_variables"
  | "no_text";

const TOKEN = /\{([a-zé]+)\}/g;

export function validateCampaignBody(body: string): CampaignBodyError[] {
  const errors: CampaignBodyError[] = [];
  const text = body.trim();
  if (!text) return ["empty"];
  if (text.length > CAMPAIGN_BODY_MAX) errors.push("too_long");
  if (/^\{[a-zé]+\}/.test(text)) errors.push("starts_with_variable");
  if (/\{[a-zé]+\}$/.test(text)) errors.push("ends_with_variable");
  const tokens = Array.from(text.matchAll(TOKEN)).map((m) => m[1]);
  if (tokens.some((t) => !(t in CAMPAIGN_VARIABLES))) errors.push("unknown_variable");
  if (tokens.length > CAMPAIGN_MAX_VARIABLES) errors.push("too_many_variables");
  if (text.replace(TOKEN, "").replace(/[\s\p{P}]/gu, "").length === 0) errors.push("no_text");
  return errors;
}

export interface CampaignTemplateBuild {
  bodyText: string;
  variables: TemplateVariable[];
  components: unknown[];
  footerText: string;
}

export function buildCampaignTemplate(input: { body: string; language: CustomerLang; headerHandle?: string | null }): CampaignTemplateBuild {
  const errors = validateCampaignBody(input.body);
  if (errors.length > 0) throw new Error(`invalid campaign body: ${errors.join(", ")}`);
  const text = input.body.trim();
  const variables: TemplateVariable[] = [];
  const bodyText = text.replace(TOKEN, (_m, token: string) => {
    const name = CAMPAIGN_VARIABLES[token];
    let idx = variables.indexOf(name);
    if (idx === -1) {
      variables.push(name);
      idx = variables.length - 1;
    }
    return `{{${idx + 1}}}`;
  });
  const components: unknown[] = [];
  if (input.headerHandle) components.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [input.headerHandle] } });
  const body: Record<string, unknown> = { type: "BODY", text: bodyText };
  if (variables.length > 0) body.example = { body_text: [variables.map((v) => SAMPLE_VALUES[input.language][v])] };
  components.push(body);
  const footerText = OPT_OUT_FOOTER_TEXT[input.language];
  components.push({ type: "FOOTER", text: footerText });
  return { bodyText, variables, components, footerText };
}

/** `ordra_camp_<slug>_<yymmdd>[_vN]` — Meta-legal, ≤ 80 chars. */
export function campaignTemplateName(campaignName: string, at: Date = new Date(), version = 1): string {
  const slug = campaignName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  const yymmdd = `${String(at.getUTCFullYear()).slice(2)}${String(at.getUTCMonth() + 1).padStart(2, "0")}${String(at.getUTCDate()).padStart(2, "0")}`;
  const base = `ordra_camp_${slug || "campagne"}_${yymmdd}`;
  return version > 1 ? `${base}_v${version}` : base;
}

/** The manager-side preview: tokens replaced by sample values, kept as {text, variable} runs. */
export function previewCampaignBody(body: string, language: CustomerLang): { text: string; variable: boolean }[] {
  const parts: { text: string; variable: boolean }[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ text: body.slice(last, idx), variable: false });
    const name = CAMPAIGN_VARIABLES[m[1]];
    parts.push({ text: name ? SAMPLE_VALUES[language][name] : m[0], variable: Boolean(name) });
    last = idx + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), variable: false });
  return parts;
}

/** The opt-out footer Meta receives for a campaign template in this language. */
export function campaignFooterText(language: CustomerLang): string {
  return OPT_OUT_FOOTER_TEXT[language];
}

// ─────────────────────────────────────────────────────────────
// Pacing — the client mirror of SQL whatsapp_campaign_slot()
// ─────────────────────────────────────────────────────────────
// The drain sends row i of a campaign at window_start + i / rate hours,
// rolling into the next day's window when the day is full. The sheet's
// « Fin estimée » is that formula applied to the last row, so what the
// manager reads is what the outbox will do. Keep the two in step: the
// tests in campaign-template.test.ts were checked against the SQL.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** « 10-20 » → { start: 10, end: 20 }; null for what the SQL would ignore. */
export function parseSendWindow(window: string | null | undefined): { start: number; end: number } | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(window ?? "");
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start < 0 || start > 23 || end < 1 || end > 24 || start >= end) return null;
  return { start, end };
}

/** The wall clock of `t` in `tz`, expressed as a UTC epoch (so arithmetic stays naive, like SQL `timestamp`). */
function wallClock(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const p: Record<string, number> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = Number(part.value);
  const ms = ((t % 1000) + 1000) % 1000;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) + ms;
}

/** The instant whose wall clock in `tz` is `wall` (SQL `timestamp AT TIME ZONE tz`). */
function fromWallClock(wall: number, tz: string): number {
  const guess = wall - (wallClock(wall, tz) - wall);
  return wall - (wallClock(guess, tz) - guess);
}

/** When row `index` (0-based) of a paced campaign leaves. */
export function campaignSlot(window: string | null | undefined, rate: number | null | undefined, index: number, tz: string, from: Date): Date {
  const perHour = Math.max(1, Math.trunc(rate ?? 60) || 60);
  const step = HOUR_MS / perHour;
  const w = parseSendWindow(window);
  if (!w) return new Date(from.getTime() + index * step);

  const local = wallClock(from.getTime(), tz);
  const day = Math.floor(local / DAY_MS) * DAY_MS;
  const open = day + w.start * HOUR_MS;
  const close = day + w.end * HOUR_MS;
  const first = local < open ? open : local >= close ? open + DAY_MS : local;

  const firstDay = Math.floor(first / DAY_MS) * DAY_MS;
  const perDay = Math.max(1, Math.floor(((firstDay + w.end * HOUR_MS - first) / HOUR_MS) * perHour));
  if (index < perDay) return new Date(fromWallClock(first + index * step, tz));

  const inDay = (w.end - w.start) * perHour;
  const days = 1 + Math.floor((index - perDay) / inDay);
  const offset = ((index - perDay) % inDay) * step;
  return new Date(fromWallClock(firstDay + days * DAY_MS + w.start * HOUR_MS + offset, tz));
}

/** « Fin estimée »: when the last of `audience` rows leaves if launched at `from`. */
export function estimateCampaignEnd(input: {
  audience: number; window: string | null | undefined; rate: number | null | undefined; tz: string; from: Date;
}): Date | null {
  if (!(input.audience > 0)) return null;
  return campaignSlot(input.window, input.rate, input.audience - 1, input.tz, input.from);
}

/** Calendar days between two instants on the market's clock (0 = same day, 1 = tomorrow). */
export function localDayDiff(from: Date, to: Date, tz: string): number {
  const a = Math.floor(wallClock(from.getTime(), tz) / DAY_MS);
  const b = Math.floor(wallClock(to.getTime(), tz) / DAY_MS);
  return b - a;
}

/** The wall-clock « HH:MM » of an instant on the market's clock. */
export function localTime(t: Date, tz: string): string {
  const wall = wallClock(t.getTime(), tz);
  const d = new Date(wall);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

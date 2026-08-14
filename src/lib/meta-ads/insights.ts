/**
 * Meta Marketing API insights — parsing and normalisation.
 *
 * This module is pure. It performs no network I/O and holds no credentials, so
 * every rule below is unit-testable and is in fact tested; the client that
 * actually talks to Graph lives next door in client.ts.
 *
 * ── Why this file exists at all ────────────────────────────────────────────
 * The Graph API serialises *every* insights metric as a JSON string, including
 * ones that are obviously numeric: spend, impressions, reach, clicks, ctr, cpc,
 * cpm, frequency, and the `value` inside each AdsActionStats entry. A row comes
 * back as {"spend":"128.50","clicks":"1187"}, not as numbers.
 *
 * That is not a cosmetic problem. JavaScript's `+` concatenates strings, so an
 * unparsed spend flowing into the aggregation in realized-metrics.ts turns
 * "12" + "34" into "1234" — a silent hundredfold error in a financial figure,
 * with no exception raised anywhere to notice it. Every field is therefore
 * parsed explicitly here, at the single boundary where Meta's wire format
 * enters the system, and nothing downstream is ever handed a raw string.
 *
 * The one field that must NOT be parsed is campaign_id. Meta campaign ids are
 * 17-18 digits, comfortably past Number.MAX_SAFE_INTEGER (~9.007e15), so
 * Number("23859123456789012") silently returns 23859123456789016 — a different
 * campaign. The id stays TEXT end to end, matching its storage column.
 */

import { toMillimes, fromMillimes } from "@/lib/calculations/math";

/**
 * One action row inside an insights row's `actions` array. Meta sends the
 * count as a string here too, exactly as it does for the top-level metrics.
 */
export interface MetaActionStat {
  action_type: string;
  value: string;
}

/**
 * A single insights row as Meta returns it at level=campaign with
 * time_increment=1 — that is, one campaign on one day.
 *
 * The metric fields are typed as `string` rather than `number` on purpose: the
 * type mirrors the wire format so the compiler refuses to let a caller do
 * arithmetic on a row before it has passed through normaliseInsightsRow. They
 * are optional because Meta omits a metric entirely on a day with no delivery
 * rather than returning it as zero.
 */
export interface MetaInsightsRow {
  campaign_id: string;
  campaign_name: string;
  spend: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  actions?: MetaActionStat[];
  /**
   * Campaign objective, e.g. OUTCOME_LEADS / OUTCOME_SALES. Requested purely so
   * the lead-source choice below has something to go on; without it every
   * campaign falls through to the pixel default.
   */
  objective?: string;
  account_currency: string;
  date_start: string;
  date_stop: string;
}

/**
 * A row after normalisation: every metric is a real number, or null where Meta
 * reported nothing.
 *
 * Null is deliberate and load-bearing. A day with no delivery is genuinely
 * *unknown*, not zero — collapsing it to 0 would drag averages down and would
 * make a broken sync indistinguishable from a paused campaign. Callers that
 * want to display a dash instead of a figure need that distinction preserved.
 *
 * `spendOriginal` is in the ad account's own currency (`currency`), not the
 * market's. Conversion is a separate, explicit step — see
 * convertToMarketCurrency — because the FX rate comes from the database and
 * this module must not reach for it.
 */
export interface NormalisedInsight {
  externalCampaignId: string;
  campaignName: string;
  date: string;
  spendOriginal: number;
  currency: string;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  platformResults: number | null;
}

/**
 * Which of the two lead action types to believe when a campaign reports both.
 * See extractLeadCount for why this is a choice and not a sum.
 */
export type LeadSourceHint = "pixel" | "onsite";

/**
 * Which lead action to believe for a given campaign objective.
 *
 * An Instant-Form lead campaign whose landing page also fires the site pixel
 * reports BOTH action types for the same person. Defaulting to the pixel count
 * on such a campaign records the smaller, wrong-bucket number, and cost-per-lead
 * is spend divided by that number — so CPL comes out overstated on exactly the
 * campaign type the onsite branch exists to serve.
 *
 * OUTCOME_LEADS is Meta's current lead objective; LEAD_GENERATION is the legacy
 * name, still returned on older campaigns.
 */
export function hintForObjective(objective?: string): LeadSourceHint | undefined {
  if (!objective) return undefined;
  const o = objective.toUpperCase();
  if (o === "OUTCOME_LEADS" || o === "LEAD_GENERATION") return "onsite";
  return "pixel";
}

/** Leads fired by the website pixel — the standard off-Meta conversion. */
const PIXEL_LEAD_ACTION = "offsite_conversion.fb_pixel_lead";

/** Leads submitted through an Instant Form, which never leaves Meta. */
const ONSITE_LEAD_ACTION = "onsite_conversion.lead_grouped";

/**
 * Float-parse a metric, returning null for anything Meta did not actually
 * report. Empty strings, whitespace and non-numeric text all become null
 * rather than NaN: NaN propagates silently through arithmetic and poisons every
 * total it touches, whereas null forces a caller to decide what to display.
 */
function parseFloatOrNull(value: string | undefined): number | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Integer-parse a counter. Impressions, reach and clicks are counts of discrete
 * events and people, so a fractional value is meaningless; Meta occasionally
 * sends "1187.0" and we truncate rather than carry a phantom decimal into a
 * column typed as an integer.
 */
function parseIntOrNull(value: string | undefined): number | null {
  const parsed = parseFloatOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

/**
 * Pull the lead count out of an insights row's `actions` array.
 *
 * Two action types can represent a lead, and which one is correct depends on
 * how the campaign was built:
 *
 *   offsite_conversion.fb_pixel_lead  — the visitor landed on our site and the
 *                                       pixel fired a Lead event.
 *   onsite_conversion.lead_grouped    — the visitor filled in an Instant Form
 *                                       without ever leaving Facebook.
 *
 * Meta can report BOTH for a single campaign — a lead-gen campaign whose form
 * also drives site traffic will populate each of them — and the two count
 * overlapping populations. Adding them therefore inflates the lead count and,
 * because cost-per-lead is spend divided by this number, understates CPL by
 * roughly the size of the overlap. So we always pick exactly one.
 *
 * The rule: honour `objectiveHint` when the caller knows the campaign's
 * objective; otherwise prefer the pixel action, which is the one that reflects
 * a lead our own systems can see and reconcile against an actual order. If the
 * hinted source is missing we fall back to the other rather than reporting
 * nothing, since a present count from the wrong bucket beats a null.
 *
 * Returns null — not 0 — when neither action type appears, because that means
 * Meta reported no lead data for the row, not that the campaign produced zero.
 */
export function extractLeadCount(
  actions: MetaActionStat[] | undefined,
  objectiveHint?: LeadSourceHint,
): number | null {
  if (!actions || actions.length === 0) return null;

  const valueFor = (actionType: string): number | null => {
    const match = actions.find((a) => a.action_type === actionType);
    // Integer-parsed like every other counter here: the destination column is
    // platform_results INTEGER, and Meta does return fractional values on some
    // attributed action rows. Rounding at the boundary beats letting Postgres
    // do it invisibly on insert.
    return match ? parseIntOrNull(match.value) : null;
  };

  const pixel = valueFor(PIXEL_LEAD_ACTION);
  const onsite = valueFor(ONSITE_LEAD_ACTION);

  // Never `pixel + onsite`. The ordering below is the whole policy: hint first,
  // pixel as the default tie-break, the other source only as a fallback.
  if (objectiveHint === "onsite") return onsite ?? pixel;
  if (objectiveHint === "pixel") return pixel ?? onsite;
  return pixel ?? onsite;
}

/**
 * Convert one Meta insights row into the shape the rest of the system uses.
 *
 * Spend is the only metric that falls back to 0 rather than null. Meta always
 * returns `spend` on a row it returns at all — a row exists because money was
 * charged — so an unparseable spend is a malformed row, and 0 keeps a total
 * honest where null would either crash the sum or need special-casing at every
 * call site. Every other metric can legitimately be absent and stays null.
 */
export function normaliseInsightsRow(row: MetaInsightsRow): NormalisedInsight {
  return {
    // Never Number() this — 17-18 digit ids lose precision past 2^53.
    externalCampaignId: row.campaign_id,
    campaignName: row.campaign_name,
    // date_start equals date_stop under time_increment=1; the row is one day.
    date: row.date_start,
    spendOriginal: parseFloatOrNull(row.spend) ?? 0,
    currency: row.account_currency,
    impressions: parseIntOrNull(row.impressions),
    reach: parseIntOrNull(row.reach),
    clicks: parseIntOrNull(row.clicks),
    ctr: parseFloatOrNull(row.ctr),
    cpc: parseFloatOrNull(row.cpc),
    cpm: parseFloatOrNull(row.cpm),
    frequency: parseFloatOrNull(row.frequency),
    platformResults: extractLeadCount(row.actions, hintForObjective(row.objective)),
  };
}

/**
 * Convert spend from the ad account's currency into the market's.
 *
 * Money in this system is dinars stored as NUMERIC(10,3) — TND and LYD are both
 * millime currencies — so the exact unit is the millime and the arithmetic is
 * done there before coming back to dinars. Multiplying dinars by an FX rate in
 * floating point and storing the result would push a value like 15.001499999
 * into a 3dp column and let the database do the rounding for us, inconsistently
 * and invisibly. Rounding here, once, in integer millimes, is the same
 * discipline the investor path uses.
 *
 * Note this is the millime pair (3dp), NOT toCents/fromCents (2dp). The cents
 * pair belongs to the market P&L path and mixing the two silently drops a
 * decimal place — see the header of calculations/math.ts.
 */
export function convertToMarketCurrency(spendOriginal: number, fxRate: number): number {
  return fromMillimes(Math.round(toMillimes(spendOriginal) * fxRate));
}

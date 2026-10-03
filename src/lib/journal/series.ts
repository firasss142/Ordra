import type { FeedItem, FeedRow } from "./types";

const WINDOW_MS = 10 * 60_000;
/** Each of these is its own event, however close in time. */
const NEVER_MERGED = new Set(["issue.opened", "issue.resolved", "settings.changed"]);

/** What makes two rows « the same thing »: who, what, and the outcome. */
function seriesKey(r: FeedRow, day: string): string | null {
  if (NEVER_MERGED.has(r.kind)) return null;
  const p = r.params ?? {};
  return [
    day,
    r.family,
    r.kind,
    r.severity ?? "",
    r.actor_id ?? "",
    r.market_id ?? "",
    p.to ?? "",
    p.carrier ?? "",
    p.route ?? "",
    p.method ?? "",
    p.entity ?? "",
    p.job ?? "",
    p.shop ?? "",
  ].join("|");
}

/**
 * Merges a newest-first feed into series: the same person (or system) doing
 * the same thing, with the same outcome, each row within 10 minutes of the
 * previous one, on the same local day. Rows of other series interleaved in
 * between do not break it. A series sits at its newest row.
 */
export function groupSeries(rows: FeedRow[], dayOf: (iso: string) => string): FeedItem[] {
  const out: FeedItem[] = [];
  const open = new Map<string, FeedItem>();
  for (const r of rows) {
    const key = seriesKey(r, dayOf(r.at));
    const cur = key ? open.get(key) : undefined;
    if (cur && Date.parse(cur.since) - Date.parse(r.at) <= WINDOW_MS) {
      cur.count += 1;
      cur.since = r.at;
      cur.members.push(r);
      continue;
    }
    const item: FeedItem = { ...r, count: 1, since: r.at, members: [r] };
    out.push(item);
    if (key) open.set(key, item);
  }
  return out;
}

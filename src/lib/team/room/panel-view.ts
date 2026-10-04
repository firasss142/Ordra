/**
 * Salle de contrôle — the agent panel: her four numbers, her products, her
 * rejection groups, her last 30 days of uploads, and her commission. The
 * prototype's `agentPeriod()` / `commSection()` (prototypes/team-v5.html).
 * Money arrives computed by the RPC; this only shapes it for display.
 */
import type { AgentPanel } from "./types";

/** The shortest bar drawn for a product with no decision, so the row is never blank. */
const STUB_PCT = 4;

export interface PanelProductRow {
  key: string;
  name: string | null;
  imageUrl: string | null;
  assigned: number;
  uploaded: number;
  rejected: number;
  attempts: number;
  decided: number;
  rate: number | null;
  barPct: number;
}

export interface PanelView {
  totals: { assigned: number; uploaded: number; rejected: number; attempts: number };
  rate: number | null;
  products: PanelProductRow[];
  rejections: { total: number; rows: { group: string; n: number; pct: number; barPct: number }[] };
  delivered30: { delivered: number; returned: number; enRoute: number; total: number };
  commission: AgentPanel["commission"] & {
    off: boolean;
    bars: { day: string; net: number; paid: number; heightPct: number; payday: boolean }[];
  };
}

export function buildPanelView(p: AgentPanel): PanelView {
  const totals = p.products.reduce(
    (s, x) => ({
      assigned: s.assigned + x.assigned,
      uploaded: s.uploaded + x.uploaded,
      rejected: s.rejected + x.rejected,
      attempts: s.attempts + x.attempts,
    }),
    { assigned: 0, uploaded: 0, rejected: 0, attempts: 0 },
  );
  const decided = totals.uploaded + totals.rejected;
  const maxDecided = Math.max(1, ...p.products.map((x) => x.uploaded + x.rejected));

  const rejTotal = p.rejections.reduce((s, r) => s + r.n, 0);
  const rejMax = Math.max(1, ...p.rejections.map((r) => r.n));

  const c = p.commission;
  const maxNet = Math.max(1, ...c.days.map((d) => d.net));

  return {
    totals,
    rate: decided ? (totals.uploaded / decided) * 100 : null,
    products: p.products
      .filter((x) => x.assigned + x.uploaded + x.rejected + x.attempts > 0)
      .map((x) => {
        const d = x.uploaded + x.rejected;
        return {
          key: x.product_id ?? "none",
          name: x.name,
          imageUrl: x.image_url,
          assigned: x.assigned,
          uploaded: x.uploaded,
          rejected: x.rejected,
          attempts: x.attempts,
          decided: d,
          rate: d ? (x.uploaded / d) * 100 : null,
          barPct: Math.max(STUB_PCT, (d / maxDecided) * 100),
        };
      }),
    rejections: {
      total: rejTotal,
      rows: p.rejections
        .filter((r) => r.n > 0)
        .map((r) => ({ group: r.group, n: r.n, pct: rejTotal ? (r.n / rejTotal) * 100 : 0, barPct: (r.n / rejMax) * 100 })),
    },
    delivered30: {
      delivered: p.delivered_30.delivered,
      returned: p.delivered_30.returned,
      enRoute: p.delivered_30.en_route,
      total: p.delivered_30.delivered + p.delivered_30.returned + p.delivered_30.en_route,
    },
    commission: {
      ...c,
      off: !c.enabled && c.entries === 0,
      bars: c.days.map((d) => ({ ...d, heightPct: (Math.max(0, d.net) / maxNet) * 100, payday: d.paid > 0 })),
    },
  };
}

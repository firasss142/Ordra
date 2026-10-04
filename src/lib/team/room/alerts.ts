/**
 * The control room's three alerts for the sidebar bell (prototypes/team-v5.html,
 * `alertsNow()`): orders stopped arriving, orders not called N h after their
 * assignment, an agent online but not calling. `get_team_alerts` applies the
 * thresholds; this shapes its rows for the alerts engine (/api/alerts/summary).
 */
import { marketIdToCode } from "@/lib/markets";
import { INTAKE_SILENCE_MIN } from "./day-view";
import type { TeamAlerts } from "./types";

export type TeamAlertType = "intake_silent" | "agent_uncalled" | "agent_idle";

export interface TeamAlertInput {
  type: TeamAlertType;
  entityId: string;
  entityKind: "market" | "agent";
  href: string;
  primary: string;
  secondary: string | null;
  anchor: string;
  meta: Record<string, number> | null;
  marketId: string;
}

/** Market names as the other alert labels write them (French, like « Import Google Sheets »). */
const MARKET_NAME = { tn: "Tunisie", ly: "Libye" } as const;

export function teamAlertInputs(payload: TeamAlerts | null | undefined, nowMs: number): TeamAlertInput[] {
  const markets = Array.isArray(payload?.markets) ? payload!.markets : [];
  const out: TeamAlertInput[] = [];
  for (const m of markets) {
    if (m.last_order_at && (nowMs - Date.parse(m.last_order_at)) / 60_000 > INTAKE_SILENCE_MIN) {
      const code = marketIdToCode(m.market_id);
      out.push({
        type: "intake_silent",
        entityId: m.market_id,
        entityKind: "market",
        href: "/system/settings/shops",
        primary: code ? MARKET_NAME[code] : "",
        secondary: null,
        anchor: m.last_order_at,
        meta: null,
        marketId: m.market_id,
      });
    }
    for (const a of m.agents ?? []) {
      if (a.uncalled > 0 && a.oldest_min !== null) {
        out.push({
          type: "agent_uncalled",
          entityId: a.agent_id,
          entityKind: "agent",
          href: `/team?agent=${a.agent_id}`,
          primary: a.name,
          secondary: null,
          anchor: new Date(nowMs - a.oldest_min * 60_000).toISOString(),
          meta: { count: a.uncalled, hours: m.call_delay_hours },
          marketId: m.market_id,
        });
      }
      if (a.idle_since) {
        out.push({
          type: "agent_idle",
          entityId: a.agent_id,
          entityKind: "agent",
          href: `/team?agent=${a.agent_id}`,
          primary: a.name,
          secondary: null,
          anchor: a.idle_since,
          meta: { to_call: a.to_call },
          marketId: m.market_id,
        });
      }
    }
  }
  return out;
}

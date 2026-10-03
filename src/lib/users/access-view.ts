import { IDLE_THRESHOLD_MS, ONLINE_THRESHOLD_MS } from "@/lib/presence";
import { marketIdToCode, type MarketScope } from "@/lib/markets";
import type { Role, UserWithStats } from "@/types";

/**
 * Accès — what the /users page shows, derived from GET /api/users rows.
 * Pure, so the page renders it and the tests pin it (prototypes/acces-v2.html).
 */

/** Agents first: half the accounts and nearly every creation or departure. */
export const ACCESS_ROLE_ORDER: Role[] = ["agent", "warehouse_agent", "market_manager", "investor", "super_admin"];

export type RoleTab = "all" | Role;

/** A manager's list is agents and warehouse agents of their market (the API scopes it). */
export function roleTabsFor(actorRole: Role): RoleTab[] {
  return actorRole === "super_admin" ? ["all", ...ACCESS_ROLE_ORDER] : ["all", "agent", "warehouse_agent"];
}

export type AccessStatus = "active" | "invited" | "disabled";

export function accessStatus(u: UserWithStats): AccessStatus {
  if (u.is_active) return "active";
  if (u.invitation_sent_at && !u.invitation_accepted_at) return "invited";
  return "disabled";
}

const LOCAL_DOMAIN = "@oms.local";

/** What the person types on the login screen — `resolveEmail` adds @oms.local back. */
export function loginIdentifier(email: string): string {
  return email.endsWith(LOCAL_DOMAIN) ? email.slice(0, -LOCAL_DOMAIN.length) : email;
}

/** The rule POST /api/users and the login screen both apply to a username. */
export function identifierFromUsername(username: string): string {
  return username.trim().toLowerCase().replace(/\s+/g, ".");
}

/** « roqaya » under « roqaya » says nothing; « agent1.tn » under « Agent TN 1 » does. */
export function showsIdentifier(u: UserWithStats): boolean {
  return identifierFromUsername(u.full_name) !== loginIdentifier(u.email);
}

export type Activity =
  | { kind: "online" }
  | { kind: "idle"; minutes: number }
  | { kind: "minutes"; minutes: number }
  | { kind: "hours"; hours: number }
  | { kind: "yesterday"; at: Date }
  | { kind: "weekday"; at: Date }
  | { kind: "date"; at: Date }
  | { kind: "none" };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * The last presence beat, in words: the console's own online / idle lines
 * (lib/presence), then a relative time the same day, « hier », a weekday
 * inside a week, and a date beyond — « il y a 156 j » reads as nothing.
 */
export function activityOf(lastSeenAt: string | null, now: Date): Activity {
  if (!lastSeenAt) return { kind: "none" };
  const at = new Date(lastSeenAt);
  const ms = now.getTime() - at.getTime();
  if (ms < ONLINE_THRESHOLD_MS) return { kind: "online" };
  const minutes = Math.floor(ms / 60_000);
  if (ms < IDLE_THRESHOLD_MS) return { kind: "idle", minutes };
  if (minutes < 60) return { kind: "minutes", minutes };
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return { kind: "hours", hours: Math.floor(minutes / 60) };
  if (days === 1) return { kind: "yesterday", at };
  if (days < 7) return { kind: "weekday", at };
  return { kind: "date", at };
}

function presenceRank(u: UserWithStats, now: Date): number {
  const k = activityOf(u.last_seen_at, now).kind;
  return k === "online" ? 0 : k === "idle" ? 1 : 2;
}

function compare(now: Date) {
  return (a: UserWithStats, b: UserWithStats) =>
    ACCESS_ROLE_ORDER.indexOf(a.role) - ACCESS_ROLE_ORDER.indexOf(b.role) ||
    Number(accessStatus(a) === "invited") - Number(accessStatus(b) === "invited") ||
    presenceRank(a, now) - presenceRank(b, now) ||
    (b.last_seen_at ? Date.parse(b.last_seen_at) : 0) - (a.last_seen_at ? Date.parse(a.last_seen_at) : 0) ||
    a.full_name.localeCompare(b.full_name);
}

export interface AccessFilters {
  tab: RoleTab;
  market: MarketScope;
  query: string;
  dormantOnly: boolean;
}

export interface RoleTile {
  role: RoleTab;
  count: number;
  online: number;
  faces: UserWithStats[];
}

export interface AccessView {
  tiles: RoleTile[];
  marketCounts: Record<MarketScope, number>;
  /** Active accounts in the current tile and market with no recorded activity. */
  dormantCount: number;
  rows: UserWithStats[];
  disabled: UserWithStats[];
  /** Active warehouse agents with no building — they see nothing and scan nothing. */
  unassignedWarehouse: UserWithStats[];
}

export function buildAccessView(users: UserWithStats[], actorRole: Role, f: AccessFilters, now: Date): AccessView {
  const byOrder = compare(now);
  const market: MarketScope = actorRole === "super_admin" ? f.market : "all";
  const inMarket = (u: UserWithStats, m: MarketScope = market) => m === "all" || marketIdToCode(u.market_id) === m;
  const inTab = (u: UserWithStats) => f.tab === "all" || u.role === f.tab;
  const q = f.query.trim().toLowerCase();
  const matches = (u: UserWithStats) => !q || u.full_name.toLowerCase().includes(q) || loginIdentifier(u.email).toLowerCase().includes(q);
  const dormant = (u: UserWithStats) => accessStatus(u) === "active" && !u.last_seen_at;

  const live = users.filter((u) => accessStatus(u) !== "disabled");
  const tiles = roleTabsFor(actorRole).map((role) => {
    const members = live.filter((u) => inMarket(u) && (role === "all" || u.role === role)).sort(byOrder);
    return {
      role,
      count: members.length,
      online: members.filter((u) => accessStatus(u) === "active" && activityOf(u.last_seen_at, now).kind === "online").length,
      faces: members.slice(0, 3),
    };
  });

  const liveInTab = live.filter(inTab);
  const marketCounts = {
    all: liveInTab.length,
    tn: liveInTab.filter((u) => inMarket(u, "tn")).length,
    ly: liveInTab.filter((u) => inMarket(u, "ly")).length,
  };

  const scope = users.filter((u) => inMarket(u) && inTab(u));
  return {
    tiles,
    marketCounts,
    dormantCount: scope.filter(dormant).length,
    rows: scope.filter((u) => accessStatus(u) !== "disabled" && matches(u) && (!f.dormantOnly || dormant(u))).sort(byOrder),
    disabled: f.dormantOnly ? [] : scope.filter((u) => accessStatus(u) === "disabled" && matches(u)).sort(byOrder),
    unassignedWarehouse: users.filter((u) => u.role === "warehouse_agent" && accessStatus(u) === "active" && !u.warehouse_id),
  };
}

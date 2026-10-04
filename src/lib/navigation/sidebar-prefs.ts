import { NAV_GROUPS, type NavGroupId } from "./sidebar-nav";

/*
 * Per-browser conveniences for the sidebar: which groups this person folded,
 * and whether they want the 64 px rail. Storage can be blocked or wiped, so
 * every read falls back to "nothing chosen" and every write may silently fail.
 */

const COLLAPSED_KEY = "ordra.sidebar.collapsed";
const RAIL_KEY = "ordra.sidebar.rail";
const GROUP_IDS = new Set<string>(NAV_GROUPS.map((g) => g.id));

export function readCollapsedGroups(): NavGroupId[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is NavGroupId => typeof v === "string" && GROUP_IDS.has(v))
      : [];
  } catch {
    return [];
  }
}

export function writeCollapsedGroups(ids: readonly NavGroupId[]): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
  } catch {
    // A convenience, not state: losing it costs one click.
  }
}

/** true/false once the person has chosen, null until then. */
export function readRailPref(): boolean | null {
  try {
    const raw = localStorage.getItem(RAIL_KEY);
    return raw === "1" ? true : raw === "0" ? false : null;
  } catch {
    return null;
  }
}

export function writeRailPref(rail: boolean): void {
  try {
    localStorage.setItem(RAIL_KEY, rail ? "1" : "0");
  } catch {
    // Same as above.
  }
}

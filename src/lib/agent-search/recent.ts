// The agent's recent searches (« Recherches récentes »), best-effort in localStorage.

export const RECENT_SEARCHES_KEY = "oms.agent.recentSearches";
const MAX_RECENT = 5;

export function readRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentSearch(query: string): void {
  if (typeof window === "undefined") return;
  const term = query.trim();
  if (term.length < 2) return;
  const next = [term, ...readRecentSearches().filter((q) => q.toLowerCase() !== term.toLowerCase())].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable — recent searches are best-effort */
  }
}

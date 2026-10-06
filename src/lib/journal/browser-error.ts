/**
 * Browser crashes → public.app_errors with source = 'browser'
 * (plans/journal-detection-and-settings-v2.md §C).
 *
 * Until 2026-10-06 the app had no error.tsx: a page that crashed showed
 * Next's blank error and nobody ever knew. The page now reports, and this
 * file decides what is worth keeping and how crashes group into one problem.
 */

export interface BrowserErrorReport {
  kind?: "error" | "unhandledrejection" | "boundary";
  name?: string;
  message?: string;
  stack?: string;
  page?: string;
  digest?: string;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** `/ar/orders/<uuid>?tab=x` → `/orders/[id]`: one crash, one problem. */
export function normalisePage(page: string): string {
  const path = page.split(/[?#]/)[0] ?? "/";
  const parts = path
    .split("/")
    .filter(Boolean)
    .map((p) => p.replace(UUID, "[id]"))
    .map((p) => (/^\d+$/.test(p) ? "[id]" : p));
  if (parts[0] === "fr" || parts[0] === "ar") parts.shift();
  return "/" + parts.join("/");
}

const NOISE = [
  /^ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Loading chunk \d+ failed/i,
  /^NetworkError when attempting to fetch/i,
];

/** Things the owner cannot fix: extensions, cross-origin scripts, cancelled requests. */
export function isNoise(r: BrowserErrorReport): boolean {
  const message = (r.message ?? "").trim();
  if (!message) return true;
  if (r.name === "AbortError") return true;
  if (NOISE.some((re) => re.test(message))) return true;
  if (/(chrome|moz|safari(-web)?)-extension:\/\//.test(r.stack ?? "")) return true;
  return false;
}

/** The first frame from our own code, as `File.tsx:120`. */
export function firstFrame(stack: string | undefined): string | null {
  if (!stack) return null;
  const m = stack.match(/\/src\/[^\s)]*?\/([\w.-]+\.(?:tsx?|jsx?)):(\d+)/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** 6 characters, stable per message: groups the same crash, splits different ones. */
export function shortHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(6, "0").slice(-6);
}

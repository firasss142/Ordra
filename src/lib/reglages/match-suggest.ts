/**
 * « Produits et villes à associer » — Ordra's proposal for a name a shop sent
 * that intake did not recognise.
 *
 *   same — the same name once case, accents and punctuation are ignored
 *          (« Sfax » ↔ « Sfax », « Bracelet Parfum Rechargeable » ↔ its product).
 *          Safe to accept in bulk.
 *   near — a likely match a person should glance at: the same name but for a
 *          leading article (« Kef » ↔ « Le Kef »), an Ordra product whose whole
 *          name sits inside the shop's longer title, or most words shared.
 *
 * Never guesses on one shared word, and returns nothing when two candidates fit
 * equally well — a wrong proposal clicked in bulk would misroute real parcels.
 */
export interface MatchCandidate {
  id: string;
  label: string;
  /** Another spelling of the same thing (the Arabic name of a city). */
  alt?: string | null;
}

export interface MatchSuggestion {
  id: string;
  confidence: "same" | "near";
}

const ARTICLES = new Set(["le", "la", "les", "l", "el", "al"]);
const STOP = new Set([...ARTICLES, "de", "du", "des", "d", "et", "en", "a", "au", "aux", "pour", "avec", "sur", "the", "and", "of", "for", "with"]);

export function normaliseName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const withoutArticle = (n: string) => n.split(" ").filter((w, i) => !(i === 0 && ARTICLES.has(w))).join(" ");
const words = (n: string) => new Set(n.split(" ").filter((w) => w && !STOP.has(w)));

/** How well `cand` explains `recv` (higher is better), or 0 for « not a match ». */
function nearScore(recv: string, cand: string): number {
  if (withoutArticle(recv) && withoutArticle(recv) === withoutArticle(cand)) return 3000;
  const r = words(recv);
  const c = words(cand);
  if (r.size === 0 || c.size === 0) return 0;
  let shared = 0;
  c.forEach((w) => {
    if (r.has(w)) shared += 1;
  });
  // The whole candidate inside the title — but one word is not a name.
  if (shared === c.size && c.size >= 2) return 2000 + shared;
  const jaccard = shared / (r.size + c.size - shared);
  if (shared >= 2 && jaccard >= 0.6) return 1000 + Math.round(jaccard * 100);
  return 0;
}

export function suggestMatch(received: string, candidates: MatchCandidate[]): MatchSuggestion | null {
  const recv = normaliseName(received ?? "");
  if (!recv) return null;

  const same = candidates.filter((c) => normaliseName(c.label) === recv || (c.alt ? normaliseName(c.alt) === recv : false));
  if (same.length === 1) return { id: same[0].id, confidence: "same" };
  if (same.length > 1) return null;

  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const c of candidates) {
    const score = Math.max(nearScore(recv, normaliseName(c.label)), c.alt ? nearScore(recv, normaliseName(c.alt)) : 0);
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { id: c.id, score };
      tie = false;
    } else if (score === best.score && c.id !== best.id) {
      tie = true;
    }
  }
  return best && !tie ? { id: best.id, confidence: "near" } : null;
}

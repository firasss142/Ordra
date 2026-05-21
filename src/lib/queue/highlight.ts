import type { ParsedQuery, SearchField } from "./search";

export interface HighlightSegment {
  text: string;
  match: boolean;
}

const COMBINING = /[\u0300-\u036f\u064b-\u065f\u0670]/g;

/**
 * Per-character fold that maps 1:1 onto the original string's characters, so a
 * match range found on the folded string slices the original cleanly. Unlike
 * `normalize` in search.ts, this does NOT collapse whitespace or drop
 * characters — it only lowercases and strips combining marks attached to each
 * base character. The result has the same length as the input.
 */
function foldAligned(value: string): string {
  let out = "";
  for (const ch of value) {
    const folded = ch.normalize("NFKD").replace(COMBINING, "").toLowerCase();
    // A base char folds to one char; if NFKD expanded oddly, keep first unit so
    // alignment holds. Empty fold (pure combining mark) maps back to a space.
    out += folded.length > 0 ? folded[0] : " ";
  }
  return out;
}

/**
 * Split `value` into segments, marking the ranges that match the query's terms.
 * Case- and accent-insensitive. Returns a single non-match segment when there's
 * nothing to highlight (blank query, phone field, or field-scope mismatch).
 */
export function highlightSegments(
  value: string,
  q: ParsedQuery,
  field: SearchField,
): HighlightSegment[] {
  const plain: HighlightSegment[] = [{ text: value, match: false }];

  if (!value) return plain;
  if (q.terms.length === 0) return plain;
  // Phone matching relies on digit-only normalization, which loses index
  // alignment — show the field plainly rather than mis-highlighting.
  if (field === "phone" || q.field === "phone") return plain;
  // A field-scoped query only highlights its own field.
  if (q.field !== null && q.field !== field) return plain;

  const folded = foldAligned(value);

  // Collect match ranges for every term occurrence.
  const ranges: Array<[number, number]> = [];
  for (const term of q.terms) {
    if (!term) continue;
    let from = 0;
    for (;;) {
      const idx = folded.indexOf(term, from);
      if (idx === -1) break;
      ranges.push([idx, idx + term.length]);
      from = idx + term.length;
    }
  }

  if (ranges.length === 0) return plain;

  // Merge overlapping/adjacent ranges.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  // Build segments from the merged ranges against the ORIGINAL string.
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: value.slice(cursor, start), match: false });
    segments.push({ text: value.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), match: false });

  return segments;
}

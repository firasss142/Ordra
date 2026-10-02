/**
 * Which part of a result the query matched, as written on the row.
 *
 * Folding (accents, tashkeel, أ/ا, ة/ه, ى/ي) is the matcher's own
 * (`lib/queue/search.foldChar`), applied letter by letter so a hit found in
 * the folded text maps back onto the original letters: typing « احمد » marks
 * « أحمد ». A number typed in any format marks the whole phone it found, since
 * which digits matched depends on how that phone happened to be stored.
 */
import { foldChar, parseQuery } from "@/lib/queue/search";
import { toNationalDigits } from "@/lib/orders/search-query";

export interface Segment {
  text: string;
  hit: boolean;
}

const NUMBER = /^[+\d][\d\s\-.()]*$/;

export function highlight(text: string | null | undefined, raw: string): Segment[] {
  const s = text ?? "";
  if (!s) return [];

  const q = parseQuery(raw);
  const typed = (q.field === "phone" ? q.terms.join(" ") : raw).trim();
  if (NUMBER.test(typed) && typed.replace(/\D/g, "").length >= 3) {
    const needle = toNationalDigits(typed);
    const hay = s.replace(/\D/g, "").length >= 3 ? toNationalDigits(s) : "";
    return [{ text: s, hit: !!needle && hay.includes(needle) }];
  }

  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < s.length; i++) {
    for (const ch of foldChar(s[i])) {
      folded += ch;
      origin.push(i);
    }
  }

  const marked = new Array<boolean>(s.length).fill(false);
  for (const term of q.terms) {
    if (!term) continue;
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      for (let k = at; k < at + term.length; k++) marked[origin[k]] = true;
    }
  }

  const out: Segment[] = [];
  for (let i = 0; i < s.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marked[i]) last.text += s[i];
    else out.push({ text: s[i], hit: marked[i] });
  }
  return out;
}

/**
 * Product « families » for the manager page's product tabs.
 *
 * The Libyan catalogue fakes sizes as separate products — the boxing dummy is four rows
 * (صغير / متوسط / كبير, plus a retired كبير at another price, spelled « دمية الملاكمة »). The
 * owner reads them as one product, and the approved prototype shows one tab for them. There
 * is no family column in the database, so a family is derived: two products are one family
 * when their names match once the size (« حجم … »), a price in brackets, the Arabic article
 * and letter variants are set aside. Rows still show each product's own name.
 */

export interface FamilyProduct {
  id: string;
  name: string;
  image_url: string | null;
  is_active: boolean;
}

export interface Family {
  /** The id of the family's first member — stable, and short enough for a URL. */
  id: string;
  label: string;
  imageUrl: string | null;
  productIds: string[];
}

function stripSize(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/حجم\s+\S+/g, " ")
    .replace(/\b(taille|size)\s+\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function familyKey(name: string): string {
  return stripSize(name)
    .replace(/[ً-ْـ]/g, "") // diacritics and tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .split(" ")
    .map((w) => w.replace(/^ال(?=\S{2,})/, ""))
    .join(" ")
    .toLowerCase();
}

/**
 * Groups products into families, keeping the input order: a family takes the place of its
 * first member. Its image is the first active member's, else any member's.
 */
export function buildFamilies(products: FamilyProduct[]): Family[] {
  const byKey = new Map<string, FamilyProduct[]>();
  for (const p of products) {
    const k = familyKey(p.name);
    const list = byKey.get(k);
    if (list) list.push(p);
    else byKey.set(k, [p]);
  }
  return [...byKey.values()].map((members) => {
    const first = members.find((m) => m.is_active) ?? members[0];
    const withImage = members.find((m) => m.is_active && m.image_url) ?? members.find((m) => m.image_url);
    return {
      id: first.id,
      label: members.length > 1 ? stripSize(first.name) : first.name,
      imageUrl: withImage?.image_url ?? null,
      productIds: members.map((m) => m.id),
    };
  });
}

export function familyOf(families: Family[], productId: string | null | undefined): Family | null {
  if (!productId) return null;
  return families.find((f) => f.productIds.includes(productId)) ?? null;
}

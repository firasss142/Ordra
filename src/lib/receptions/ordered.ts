import type { createClient } from "@/lib/supabase/server";

/**
 * CE QUI ÉTAIT COMMANDÉ, par ligne de comptage.
 *
 * L'écart d'une réception se mesure contre NOTRE PROPRE PLAN — les bons de
 * commande auxquels le quai a rattaché ses comptages — et non contre
 * `reception_lines.expected_qty`, qui est NULL partout et le restera : personne
 * n'écrit un attendu dans un formulaire vide.
 *
 * Un comptage peut toucher PLUSIEURS lignes de commande (120 unités soldent une
 * commande de 100 et entament la suivante) : le commandé est alors la somme des
 * lignes touchées, DÉDOUBLONNÉE — deux comptages sur la même ligne de commande
 * ne la comptent pas deux fois.
 *
 * LE COMPTAGE À L'AVEUGLE SE GARDE EN BASE. La RLS de
 * `purchase_order_receipts` est fermée au `warehouse_agent` : sa requête rend
 * zéro ligne, la Map est vide, et sa feuille n'affiche aucun attendu. Aucun
 * filtrage par rôle n'est écrit ici, parce qu'il serait le deuxième endroit où
 * la règle vit — et donc celui qui finirait par mentir.
 */
export async function orderedByReceptionLine(
  supabase: Awaited<ReturnType<typeof createClient>>,
  receptionLineIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (receptionLineIds.length === 0) return out;

  const { data } = await supabase
    .from("purchase_order_receipts")
    .select("reception_line_id, purchase_order_line_id, purchase_order_lines(ordered_qty)")
    .in("reception_line_id", receptionLineIds);

  // (ligne de comptage → lignes de commande déjà comptées), pour dédoublonner.
  const seen = new Map<string, Set<string>>();
  for (const raw of (data ?? []) as unknown as Array<{
    reception_line_id: string;
    purchase_order_line_id: string;
    purchase_order_lines: { ordered_qty: number } | null;
  }>) {
    const ordered = raw.purchase_order_lines?.ordered_qty;
    if (ordered === undefined || ordered === null) continue;

    const already = seen.get(raw.reception_line_id) ?? new Set<string>();
    if (already.has(raw.purchase_order_line_id)) continue;
    already.add(raw.purchase_order_line_id);
    seen.set(raw.reception_line_id, already);

    out.set(raw.reception_line_id, (out.get(raw.reception_line_id) ?? 0) + Number(ordered));
  }
  return out;
}

import { describe, test, expect, vi } from "vitest";
import { attachOrderLines } from "./order-lines";

/*
 * LE PRÉPARATEUR DOIT POUVOIR NOMMER CE QU'IL PREND.
 *
 * `order_items` porte `variant_id` ET `variant_label`. Jusqu'ici cette
 * fonction ne lisait que le libellé — un INSTANTANÉ de texte, figé au moment
 * de la commande. Deux conséquences :
 *
 *   · renommer une variante (« Grand » → « Large ») laisse les commandes en
 *     cours afficher l'ancien mot, sans moyen de savoir qu'il s'agit de la
 *     même étagère ;
 *   · deux lignes au même libellé mais de variantes différentes — ou deux
 *     variantes au libellé vide — sont indiscernables.
 *
 * Le libellé reste affiché : c'est ce que l'agent a vendu, et l'historique
 * doit le dire. Mais l'IDENTITÉ vient désormais de `variant_id`.
 */
describe("attachOrderLines — la ligne porte l'identité de sa variante", () => {
  function client(items: Record<string, unknown>[]) {
    const selects: string[] = [];
    return {
      selects,
      supabase: {
        from: vi.fn((table: string) => {
          const c: Record<string, unknown> = {};
          c.select = vi.fn((cols: string) => {
            if (table === "order_items") selects.push(cols);
            return c;
          });
          c.in = vi.fn(() => c);
          c.order = vi.fn(() => c);
          c.range = vi.fn(() => c);
          c.then = (res: (v: unknown) => unknown) =>
            Promise.resolve({
              data: table === "order_items" ? items : [],
              error: null,
            }).then(res);
          return c;
        }),
      },
    };
  }

  const ITEM = {
    order_id: "o-1",
    product_id: "p-1",
    product_name: "Doudoune",
    variant_id: "v-grand",
    variant_label: "Grand",
    quantity: 2,
  };

  test("demande variant_id à la base", async () => {
    const { supabase, selects } = client([ITEM]);
    await attachOrderLines(supabase as never, [{ id: "o-1" }]);
    expect(selects[0]).toContain("variant_id");
  });

  test("expose variant_id sur la ligne, sans perdre le libellé", async () => {
    const { supabase } = client([ITEM]);
    const [row] = await attachOrderLines(supabase as never, [{ id: "o-1" }]);

    expect(row.items[0]).toMatchObject({
      product_id: "p-1",
      variant_id: "v-grand",
      variant_label: "Grand",
      quantity: 2,
    });
  });

  // Une commande d'avant les variantes n'en a pas : la colonne arrive nulle et
  // la ligne reste parfaitement valable.
  test("une ligne sans variante porte variant_id null", async () => {
    const { supabase } = client([{ ...ITEM, variant_id: null, variant_label: null }]);
    const [row] = await attachOrderLines(supabase as never, [{ id: "o-1" }]);
    expect(row.items[0].variant_id).toBeNull();
  });

  test("deux tailles du même produit restent deux lignes distinctes", async () => {
    const { supabase } = client([
      ITEM,
      { ...ITEM, variant_id: "v-petit", variant_label: "Petit", quantity: 1 },
    ]);
    const [row] = await attachOrderLines(supabase as never, [{ id: "o-1" }]);

    expect(row.items).toHaveLength(2);
    expect(row.items.map((l) => l.variant_id)).toEqual(["v-grand", "v-petit"]);
  });
});

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { ProductAvatar } from "@/components/orders/ProductAvatar";

/**
 * Chercher un produit, en direct.
 *
 * LE PANNEAU S'OUVRE DANS LE SÉLECTEUR, PAS PAR-DESSUS. Il faut voir les lignes
 * déjà posées en même temps que les résultats, sinon on ajoute deux fois le même
 * produit — et l'index unique `(reception_id, product_id, variant_id)` le
 * refuserait à l'enregistrement, longtemps après le geste.
 *
 * UN PRODUIT DÉJÀ POSÉ RESTE VISIBLE ET DIT POURQUOI. Il était retiré
 * silencieusement de la liste : on tapait son nom, rien n'apparaissait, et on en
 * concluait qu'il n'existait pas. Une absence inexpliquée est pire qu'une ligne
 * barrée.
 *
 * LA CORRESPONDANCE EST EN GRAS, PAS SURLIGNÉE EN COULEUR. Dans cette section la
 * couleur fonctionnelle appartient aux statuts ; un surlignage ambre ici se
 * lirait « attention ».
 *
 * « EN STOCK 0 » EST EN ROUGE, parce que c'est le chiffre qui décide : un produit
 * à zéro rend la réception urgente, neuf cents en stock la laissent attendre.
 */

export interface ProductVariant {
  id: string;
  label: string;
  /** `attribute` porte le stock ; `pack` est un conditionnement de vente. */
  kind?: string | null;
  current_stock?: number | null;
  is_active?: boolean | null;
}

export interface SearchableProduct {
  id: string;
  name: string;
  sku?: string | null;
  image_url?: string | null;
  current_stock: number;
  /** Tel que PostgREST le renvoie ; d'autres écrans lisent déjà ce nom. */
  product_variants?: ProductVariant[] | null;
}

/**
 * Une entrée choisissable : soit un produit nu, soit UNE taille d'un produit.
 *
 * LE STOCK VIT AU GRAIN (produit, variante, bâtiment). Choisir « دميه ملاكمه »
 * sans dire laquelle déclarait 100 unités de produit nu, qui tombent dans le
 * NON VENTILÉ — et sur un produit ventilé à 100 %, `scan_order_out` refuse
 * ensuite de les sortir, parce que « quelle taille le client a-t-il reçue ? »
 * n'a pas de réponse. Le sélecteur créait donc du stock invendable.
 */
export interface PickEntry {
  /** `<produit>` ou `<produit>:<variante>` — la clé que `chosenIds` porte. */
  key: string;
  product: SearchableProduct;
  variant: ProductVariant | null;
  label: string;
  stock: number;
}

/** Les tailles vivantes d'un produit. Un palier n'est pas un objet sur une étagère. */
export function stockBearingVariants(p: SearchableProduct): ProductVariant[] {
  return (p.product_variants ?? []).filter(
    (v) => v.kind === "attribute" && v.is_active !== false,
  );
}

export function entryKey(productId: string, variantId: string | null): string {
  return variantId ? `${productId}:${variantId}` : productId;
}

/**
 * Aplatit les résultats en entrées choisissables.
 *
 * Un produit ventilé n'apparaît PAS lui-même : seules ses tailles le font. On ne
 * peut donc pas enregistrer le produit nu quand il est ventilé, ce qui est la
 * règle du domaine, appliquée là où la main se pose.
 */
export function pickEntries(results: SearchableProduct[]): PickEntry[] {
  return results.flatMap((product): PickEntry[] => {
    const variants = stockBearingVariants(product);
    if (variants.length === 0) {
      return [
        {
          key: entryKey(product.id, null),
          product,
          variant: null,
          label: product.name,
          stock: product.current_stock,
        },
      ];
    }
    return variants.map((variant) => ({
      key: entryKey(product.id, variant.id),
      product,
      variant,
      label: variant.label,
      stock: variant.current_stock ?? 0,
    }));
  });
}

/** La requête minimale. Une lettre renverrait le catalogue entier. */
export const MIN_QUERY = 2;

/**
 * Découpe un nom autour de la correspondance, sans `innerHTML`.
 *
 * La comparaison est insensible à la casse mais rend le texte D'ORIGINE : un nom
 * arabe ou un SKU ne doivent pas changer de graphie en passant par la surbrillance.
 */
export function splitOnMatch(text: string, query: string): [string, string, string] {
  const q = query.trim();
  if (!q) return [text, "", ""];
  const at = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  if (at < 0) return [text, "", ""];
  return [text.slice(0, at), text.slice(at, at + q.length), text.slice(at + q.length)];
}

function Highlight({ text, query }: { text: string; query: string }) {
  const [before, hit, after] = splitOnMatch(text, query);
  if (!hit) return <>{text}</>;
  return (
    <>
      {before}
      <mark className="rounded-[3px] bg-wh-sunken px-px font-bold text-inherit">{hit}</mark>
      {after}
    </>
  );
}

export function ProductSearchPanel({
  query,
  onQueryChange,
  results,
  isLoading,
  chosenIds,
  onPick,
  inputRef,
  gridClassName,
  trailing,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  results: SearchableProduct[];
  isLoading: boolean;
  chosenIds: Set<string>;
  /** `variant` est `null` pour un produit sans taille. */
  onPick: (product: SearchableProduct, variant: ProductVariant | null) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
  /** Les colonnes de la rangée, pour que le champ s'aligne sur les lignes posées. */
  gridClassName: string;
  /** Les en-têtes « Quantité » / « Coût unit. », dans la même grille. */
  trailing?: React.ReactNode;
}) {
  const t = useTranslations("warehouse.receptions");
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  /*
   * LA LISTE S'OUVRE AU FOCUS, AVANT QU'ON AIT TAPÉ.
   *
   * Chercher suppose qu'on sache déjà quoi chercher. Devant un bon de livraison
   * on reconnaît un produit bien plus vite qu'on ne l'épelle — surtout un titre
   * arabe — donc le catalogue s'ouvre dès que le champ prend le focus, et la
   * frappe le FILTRE au lieu de le faire apparaître.
   */
  const [focused, setFocused] = useState(false);
  const own = useRef<HTMLInputElement>(null);
  const field = inputRef ?? own;

  const trimmed = query.trim();
  const browsing = trimmed.length === 0;
  // Une seule lettre ne lance pas de requête ; on garde donc le catalogue ouvert
  // plutôt que de le remplacer par un message qui gronde.
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY;
  const active = (trimmed.length >= MIN_QUERY || (focused && browsing)) && !dismissed;

  const entries = useMemo(() => pickEntries(results), [results]);
  // Les entrées déjà posées restent dans la liste, mais ne sont pas choisissables :
  // le curseur clavier ne doit donc jamais s'arrêter dessus.
  const pickable = useMemo(
    () => entries.filter((e) => !chosenIds.has(e.key)),
    [entries, chosenIds],
  );

  useEffect(() => setCursor(0), [trimmed, results.length]);
  // Taper après avoir fermé la liste la rouvre : on redemande quelque chose.
  useEffect(() => {
    if (trimmed.length > 0) setDismissed(false);
  }, [trimmed]);

  function pick(entry: PickEntry) {
    onPick(entry.product, entry.variant);
    // Le champ se vide pour le produit suivant : on saisit une réception de dix
    // lignes d'affilée, sans jamais lâcher le clavier.
    onQueryChange("");
    setCursor(0);
    field.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      // Fermer la LISTE, pas la modale : on perdrait toute la saisie.
      if (active) {
        e.stopPropagation();
        setDismissed(true);
      }
      return;
    }
    if (!active || pickable.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, pickable.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = pickable[Math.min(cursor, pickable.length - 1)];
      if (target) pick(target);
    }
  }

  return (
    /*
     * La rangée de saisie est une grille — le champ s'aligne exactement sur la
     * colonne « produit » des lignes déjà posées — mais les RÉSULTATS sont un
     * frère pleine largeur de cette grille. Rendus dans sa première cellule, ils
     * se seraient écrasés dans une colonne.
     */
    <div className="border-t border-wh-border bg-wh-sunken">
      <div className={`grid items-center gap-x-2.5 px-3.5 py-2.5 ${gridClassName}`}>
        <div className="flex w-full items-center gap-2.5">
          {/* La loupe devient un rouet pendant la requête : le même point de
              l'écran porte l'état, au lieu d'un indicateur ailleurs. */}
          <span className="grid flex-none place-items-center text-wh-ink-3">
            {isLoading && active ? (
              <span
                className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-wh-border border-t-wh-ink-3"
                aria-hidden
              />
            ) : (
              <Search size={15} strokeWidth={2.2} />
            )}
          </span>
          <input
            ref={field}
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setDismissed(false);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => {
              setFocused(true);
              setDismissed(false);
            }}
            placeholder={t("searchProduct")}
            dir="auto"
            className="min-w-0 flex-1 rounded-[8px] border border-wh-border px-2.5 py-2 text-[13px]"
          />
          {trimmed ? (
            <button
              type="button"
              aria-label={t("clearSearch")}
              onClick={() => {
                onQueryChange("");
                field.current?.focus();
              }}
              className="grid flex-none place-items-center p-0.5 text-wh-ink-3 hover:text-wh-ink-1"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        {trailing}
      </div>

      {tooShort ? (
        <p className="border-t border-wh-border px-4 py-5 text-center text-[12.5px] text-wh-ink-3">
          {t("searchTypeMore")}
        </p>
      ) : null}

      {active && results.length > 0 ? (
        <div className="border-t border-wh-border">
          <ul>
            {results.map((product) => {
              const variants = stockBearingVariants(product);

              /* ── Un produit SANS taille : la rangée d'avant, inchangée. ── */
              if (variants.length === 0) {
                const key = entryKey(product.id, null);
                const entry = entries.find((e) => e.key === key)!;
                return (
                  <li key={product.id} className="border-b border-wh-border last:border-b-0">
                    <Row
                      entry={entry}
                      taken={chosenIds.has(key)}
                      pickable={pickable}
                      cursor={cursor}
                      trimmed={trimmed}
                      setCursor={setCursor}
                      pick={pick}
                      t={t}
                    />
                  </li>
                );
              }

              /*
               * ── Un produit VENTILÉ : un en-tête, puis ses tailles. ──
               * L'en-tête n'est pas un bouton : le produit nu n'est pas un
               * choix possible, et le rendre cliquable serait un piège.
               */
              return (
                <li key={product.id} className="border-b border-wh-border last:border-b-0">
                  <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 pb-1 pt-2.5">
                    <ProductAvatar imageUrl={product.image_url ?? null} productName={product.name} size={34} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold" dir="auto">
                        <Highlight text={product.name} query={trimmed} />
                      </span>
                      {product.sku ? (
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-wh-ink-3">
                          <Highlight text={product.sku} query={trimmed} />
                        </span>
                      ) : null}
                    </span>
                    <span className="flex-none text-[11px] font-semibold text-wh-ink-3">
                      {t("pickSize", { count: variants.length })}
                    </span>
                  </div>
                  <ul className="ps-[30px]">
                    {variants.map((variant) => {
                      const key = entryKey(product.id, variant.id);
                      const entry = entries.find((e) => e.key === key)!;
                      return (
                        <li key={variant.id} className="border-t border-wh-border">
                          <Row
                            entry={entry}
                            taken={chosenIds.has(key)}
                            pickable={pickable}
                            cursor={cursor}
                            trimmed={trimmed}
                            setCursor={setCursor}
                            pick={pick}
                            t={t}
                            variantRow
                          />
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-wh-border bg-wh-sunken px-3.5 py-2 text-[11.5px] text-wh-ink-3">
            <span>
              {browsing
                ? t("catalogueCount", { count: results.length })
                : t("searchResults", { count: results.length })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> {t("kbdChoose")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd> {t("kbdAdd")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>esc</Kbd> {t("kbdClose")}
            </span>
          </div>
        </div>
      ) : null}

      {/* Rien trouvé : on NOMME ce qui a été cherché, et on dit ce qui n'est pas
          cherché du tout — un produit désactivé ou archivé est exclu en amont. */}
      {active && !isLoading && results.length === 0 ? (
        <div className="border-t border-wh-border px-4 py-5 text-center">
          <p className="text-[12.5px] text-wh-ink-3">
            {browsing ? t("catalogueEmpty") : t("searchEmpty", { query: trimmed })}
          </p>
          <p className="mt-1 text-[11.5px] text-wh-ink-3">{t("searchEmptyHint")}</p>
        </div>
      ) : null}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[4px] border border-wh-border-strong bg-wh-surface px-1.5 font-mono text-[10.5px] text-wh-ink-2">
      {children}
    </kbd>
  );
}

/**
 * Une rangée choisissable — produit nu ou taille.
 *
 * « EN STOCK 0 » EST EN ROUGE, parce que c'est le chiffre qui décide : à zéro
 * la réception est urgente, à neuf cents elle peut attendre. Sur une taille,
 * c'est le stock de CETTE taille qui compte, jamais le total du produit.
 */
function Row({
  entry,
  taken,
  pickable,
  cursor,
  trimmed,
  setCursor,
  pick,
  t,
  variantRow,
}: {
  entry: PickEntry;
  taken: boolean;
  pickable: PickEntry[];
  cursor: number;
  trimmed: string;
  setCursor: (n: number) => void;
  pick: (e: PickEntry) => void;
  t: ReturnType<typeof useTranslations>;
  variantRow?: boolean;
}) {
  const index = pickable.findIndex((e) => e.key === entry.key);
  const onCursor = !taken && index >= 0 && index === Math.min(cursor, pickable.length - 1);
  const pad = variantRow ? "px-3.5 py-2" : "px-3.5 py-2.5";
  const cols = variantRow
    ? "grid-cols-[minmax(0,1fr)_auto]"
    : "grid-cols-[34px_minmax(0,1fr)_auto]";

  const body = (
    <>
      {variantRow ? null : (
        <ProductAvatar
          imageUrl={entry.product.image_url ?? null}
          productName={entry.product.name}
          size={34}
        />
      )}
      <span className="min-w-0">
        <span
          className={`block truncate text-[13px] ${variantRow ? "font-medium" : "font-medium"} ${taken ? "text-wh-ink-3" : ""}`}
          dir="auto"
        >
          <Highlight text={entry.label} query={trimmed} />
        </span>
        {!variantRow && entry.product.sku ? (
          <span className="mt-0.5 block truncate font-mono text-[11px] text-wh-ink-3">
            <Highlight text={entry.product.sku} query={trimmed} />
          </span>
        ) : null}
      </span>
      {taken ? (
        <span className="flex-none rounded-[6px] border border-wh-border bg-wh-sunken px-2 py-px text-[11px] font-semibold text-wh-ink-2">
          {t("alreadyAdded")}
        </span>
      ) : (
        <span
          className={`flex-none font-mono text-[12.5px] font-semibold tabular-nums ${
            entry.stock <= 0 ? "text-wh-bad" : "text-wh-ink-2"
          }`}
        >
          {t("inStock", { count: entry.stock })}
        </span>
      )}
    </>
  );

  if (taken) {
    return <div className={`grid ${cols} items-center gap-x-3 ${pad}`}>{body}</div>;
  }
  return (
    <button
      type="button"
      onMouseEnter={() => setCursor(index)}
      onClick={() => pick(entry)}
      className={`grid w-full ${cols} items-center gap-x-3 ${pad} text-start ${
        onCursor ? "bg-wh-ok-tint" : "hover:bg-wh-ok-tint"
      }`}
    >
      {body}
    </button>
  );
}

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

export interface SearchableProduct {
  id: string;
  name: string;
  sku?: string | null;
  image_url?: string | null;
  current_stock: number;
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
  onPick: (product: SearchableProduct) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
  /** Les colonnes de la rangée, pour que le champ s'aligne sur les lignes posées. */
  gridClassName: string;
  /** Les en-têtes « Quantité » / « Coût unit. », dans la même grille. */
  trailing?: React.ReactNode;
}) {
  const t = useTranslations("warehouse.receptions");
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const own = useRef<HTMLInputElement>(null);
  const field = inputRef ?? own;

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY;
  const active = trimmed.length >= MIN_QUERY && !dismissed;

  // Les résultats déjà posés restent dans la liste, mais ne sont pas choisissables :
  // le curseur clavier ne doit donc jamais s'arrêter dessus.
  const pickable = useMemo(() => results.filter((p) => !chosenIds.has(p.id)), [results, chosenIds]);

  useEffect(() => setCursor(0), [trimmed, results.length]);
  useEffect(() => {
    if (trimmed.length < MIN_QUERY) setDismissed(false);
  }, [trimmed]);

  function pick(product: SearchableProduct) {
    onPick(product);
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
            {results.map((p) => {
              const taken = chosenIds.has(p.id);
              const index = pickable.indexOf(p);
              const onCursor = !taken && index === Math.min(cursor, pickable.length - 1);

              const body = (
                <>
                  <ProductAvatar
                    imageUrl={p.image_url ?? null}
                    productName={p.name}
                    size={34}
                  />
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-[13px] font-medium ${taken ? "text-wh-ink-3" : ""}`}
                      dir="auto"
                    >
                      <Highlight text={p.name} query={trimmed} />
                    </span>
                    {p.sku ? (
                      <span
                        className={`mt-0.5 block truncate font-mono text-[11px] ${taken ? "text-wh-ink-3" : "text-wh-ink-3"}`}
                      >
                        <Highlight text={p.sku} query={trimmed} />
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
                        p.current_stock <= 0 ? "text-wh-bad" : "text-wh-ink-2"
                      }`}
                    >
                      {t("inStock", { count: p.current_stock })}
                    </span>
                  )}
                </>
              );

              return (
                <li key={p.id} className="border-b border-wh-border last:border-b-0">
                  {taken ? (
                    <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 py-2.5">
                      {body}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => pick(p)}
                      className={`grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 py-2.5 text-start ${
                        onCursor ? "bg-wh-ok-tint" : "hover:bg-wh-ok-tint"
                      }`}
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-wh-border bg-wh-sunken px-3.5 py-2 text-[11.5px] text-wh-ink-3">
            <span>{t("searchResults", { count: results.length })}</span>
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
          <p className="text-[12.5px] text-wh-ink-3">{t("searchEmpty", { query: trimmed })}</p>
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

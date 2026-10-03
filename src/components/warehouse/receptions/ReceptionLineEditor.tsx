"use client";

import { useTranslations } from "next-intl";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import type { ProjectedLine } from "@/lib/receptions/project";

/**
 * Une ligne de réception, en saisie.
 *
 * VIDE N'EST PAS ZÉRO. Le champ « reçu » part vide et y revient : « pas encore
 * comptée » et « rien n'est arrivé » sont des faits opposés, et les confondre
 * ferait valider une réception que personne n'a comptée. Zéro reste saisissable
 * explicitement, parce que « le carton était vide » est une réponse.
 *
 * ABÎMÉ EST L'INVERSE : zéro y est la valeur normale, pas une inconnue, donc le
 * champ affiche 0.
 *
 * L'ÉCART NE S'INVENTE PAS. Il n'apparaît que si l'attendu ET le reçu existent.
 * Sans quantité annoncée, la ligne dit « non annoncé » et rien d'autre.
 */

export interface LinePatch {
  received_qty: number | null;
  damaged_qty: number;
  unit_cost: number | null;
  /** Prix fournisseur + part des frais d'approche. C'est LUI qui devient le COGS. */
  landed_unit_cost?: number | null;
}

const NUM_FIELD =
  "w-full rounded-[6px] border px-2.5 py-1.5 text-end font-mono text-[14px] font-semibold tabular-nums " +
  "focus:outline-none focus:ring-2 focus:ring-wh-ok/40";

export function ReceptionLineEditor({
  line,
  withCosts,
  readOnly = false,
  onChange,
}: {
  line: ProjectedLine;
  withCosts: boolean;
  readOnly?: boolean;
  onChange: (patch: LinePatch) => void;
}) {
  const t = useTranslations("warehouse.receptions");

  const current: LinePatch = {
    received_qty: line.received_qty,
    damaged_qty: line.damaged_qty,
    unit_cost: line.unit_cost ?? null,
  };

  /** Un entier >= 0, ou null si le champ est vide. Toute autre saisie est ignorée. */
  function parseQty(raw: string): number | null | undefined {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    if (!/^\d+$/.test(trimmed)) return undefined; // négatif, décimal, lettres
    return Number.parseInt(trimmed, 10);
  }

  function setReceived(raw: string) {
    const v = parseQty(raw);
    if (v === undefined) return;
    onChange({ ...current, received_qty: v });
  }

  function setDamaged(raw: string) {
    const v = parseQty(raw);
    if (v === undefined) return;
    // Zéro abîmée est l'état normal : un champ vidé vaut 0, pas « inconnu ».
    onChange({ ...current, damaged_qty: v ?? 0 });
  }

  function setCost(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      onChange({ ...current, unit_cost: null });
      return;
    }
    // La virgule décimale est la norme en français et en arabe.
    const parsed = Number.parseFloat(trimmed.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) return;
    onChange({ ...current, unit_cost: parsed });
  }

  const variance = line.variance;

  return (
    <>
      {/*
       * La vignette. Sur un quai on reconnaît un produit par son image avant son
       * nom, et une liste de titres arabes en police de 13 px ne se distingue
       * pas d'un coup d'oeil. `ProductAvatar` retombe sur l'initiale quand il n'y
       * a pas de photo, donc la colonne ne saute jamais.
       */}
      <span className="flex min-w-0 items-center gap-2.5">
        <ProductAvatar imageUrl={line.product_image_url ?? null} productName={line.product_name} size={36} />
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold" dir="auto">
            {line.product_name}
          </span>
          <span className="mt-0.5 block font-mono text-[11.5px] text-wh-ink-3">
            {line.variant_label ? `${line.variant_label} · ` : ""}
            {line.product_sku ?? ""}
          </span>
        </span>
      </span>

      {/* Attendu — toujours en lecture seule : il vient du bon, pas du quai. */}
      <span className="text-end">
        {line.expected_qty === null ? (
          <span className="text-[11.5px] italic text-wh-ink-3">{t("notAnnounced")}</span>
        ) : (
          <span className="font-mono text-[14px] font-medium text-wh-ink-3 tabular-nums">
            {line.expected_qty}
          </span>
        )}
      </span>

      {/* Reçu — le seul champ que l'agent remplit vraiment. */}
      <span className="text-end">
        {readOnly ? (
          line.received_qty === null ? (
            <span className="text-[11.5px] italic text-wh-ink-3">{t("notCounted")}</span>
          ) : (
            <span className="font-mono text-[14px] font-semibold tabular-nums">
              {line.received_qty}
            </span>
          )
        ) : (
          <>
            <input
              aria-label={t("colReceived")}
              inputMode="numeric"
              placeholder="—"
              value={line.received_qty ?? ""}
              onChange={(e) => setReceived(e.target.value)}
              className={`${NUM_FIELD} ${
                line.received_qty === null
                  ? "border-dashed border-wh-border bg-wh-surface"
                  : "border-wh-ok bg-wh-ok-bg/50"
              }`}
            />
            {/* Le cas courant sur un quai : tout est arrivé. Un geste, pas six touches. */}
            {line.expected_qty !== null && line.received_qty !== line.expected_qty ? (
              <button
                type="button"
                onClick={() => onChange({ ...current, received_qty: line.expected_qty })}
                className="mt-1 w-full rounded-[5px] border border-wh-border bg-wh-surface px-1 py-0.5 font-mono text-[11px] font-semibold text-wh-ink-2 hover:bg-wh-sunken"
              >
                {line.expected_qty}
              </button>
            ) : null}
          </>
        )}

        {/*
         * CE QUI SE DIT SOUS LE CHAMP, ET DANS QUEL ORDRE.
         *
         * Un écart suppose DEUX nombres. Quand le produit n'était pas sur le bon
         * de livraison il n'y a pas d'attendu dont faire la différence : ce n'est
         * donc pas un écart, c'est un autre fait — « hors bon » — et il a ses
         * propres mots. L'écran ne disait rien du tout dans ce cas, ce qui
         * laissait une ligne hors bon se confondre avec une ligne conforme.
         */}
        {line.received_qty === null ? (
          !readOnly ? (
            <span className="mt-1 block text-[11px] italic text-wh-ink-3">{t("notCounted")}</span>
          ) : null
        ) : variance !== null ? (
          <span
            className={`mt-1 block font-mono text-[11.5px] font-bold ${
              variance === 0 ? "text-wh-ok" : variance < 0 ? "text-wh-bad" : "text-wh-move"
            }`}
          >
            {variance === 0 ? t("conform") : `${variance > 0 ? "+" : "−"}${Math.abs(variance)}`}
          </span>
        ) : line.expected_qty === null && line.received_qty > 0 ? (
          <span className="mt-1 block font-mono text-[11.5px] font-bold text-wh-move">
            {t("offDocket", { delta: `+${line.received_qty}` })}
          </span>
        ) : null}
      </span>

      {/* Abîmé — un nombre distinct. Les fondre obligerait à soustraire sur un quai. */}
      <span className="text-end">
        {readOnly ? (
          <span
            className={`font-mono text-[14px] tabular-nums ${
              line.damaged_qty > 0 ? "font-bold text-wh-warn" : "font-medium text-wh-ink-3"
            }`}
          >
            {line.damaged_qty}
          </span>
        ) : (
          <input
            aria-label={t("colDamaged")}
            inputMode="numeric"
            value={line.damaged_qty}
            onChange={(e) => setDamaged(e.target.value)}
            className={`${NUM_FIELD} ${
              line.damaged_qty > 0
                ? "border-wh-warn-edge bg-wh-warn-bg text-wh-warn"
                : "border-wh-border bg-wh-surface"
            }`}
          />
        )}
      </span>

      {withCosts ? (
        <>
          <span className="hidden text-end md:block">
            {readOnly ? (
              <span className="font-mono text-[13.5px] tabular-nums">
                {line.unit_cost === null || line.unit_cost === undefined ? (
                  <span className="text-wh-ink-3">—</span>
                ) : (
                  line.unit_cost.toFixed(3)
                )}
              </span>
            ) : (
              <input
                aria-label={t("colUnitCost")}
                inputMode="decimal"
                placeholder="—"
                defaultValue={line.unit_cost ?? ""}
                onChange={(e) => setCost(e.target.value)}
                className={`${NUM_FIELD} border-wh-border bg-wh-surface`}
              />
            )}
            {/*
             * LE COÛT DE REVIENT, sous le prix du fournisseur, et seulement
             * quand les frais le déplacent. C'est ce chiffre-là qui devient le
             * COGS ; afficher « 40,000 → 40,000 » quand rien ne bouge serait du
             * bruit qui cacherait les vrais écarts.
             */}
            {line.landed_unit_cost !== null &&
            line.landed_unit_cost !== undefined &&
            line.unit_cost !== null &&
            line.unit_cost !== undefined &&
            Math.abs(line.landed_unit_cost - line.unit_cost) >= 0.0005 ? (
              <span className="mt-1 block font-mono text-[11px] tabular-nums text-wh-move">
                {t("colLanded")} {line.landed_unit_cost.toFixed(3)}
              </span>
            ) : null}
          </span>
          <span className="hidden text-end font-mono text-[13.5px] font-semibold tabular-nums md:block">
            {line.line_value === null || line.line_value === undefined ? (
              <span className="text-wh-ink-3">—</span>
            ) : (
              Math.round(line.line_value).toLocaleString("fr-FR")
            )}
          </span>
        </>
      ) : null}
    </>
  );
}

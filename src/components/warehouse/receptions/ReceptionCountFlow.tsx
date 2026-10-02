"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ArrowRight, Check, Plus } from "lucide-react";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import type { ProjectedReception } from "@/lib/receptions/project";
import type { LinePatch } from "./ReceptionLineEditor";

/**
 * Compter sur le quai — une ligne à la fois.
 *
 * MÊME GRAMMAIRE QUE LA TOURNÉE DE SCAN. On ne demande pas à quelqu'un debout
 * devant une palette, une main sur un carton, de remplir un tableau à six
 * colonnes sur un écran de 390 px. Une ligne occupe tout l'écran, le champ fait
 * 52 px, et la progression dit combien il en reste.
 *
 * LES DEUX RACCOURCIS SONT LES DEUX CAS RÉELS. Sur un quai, une livraison est
 * presque toujours « tout est arrivé » ou « rien n'est arrivé ». Les taper
 * chiffre par chiffre était du travail inutile. Et « zéro » écrit un ZÉRO, pas
 * un champ vide : « le carton était vide » est une réponse, « je n'ai pas encore
 * regardé » est son contraire, et les confondre ferait valider une réception que
 * personne n'a comptée.
 *
 * « PASSER » NE MENT PAS. Avancer sans rien affirmer doit rester possible, sinon
 * l'agent écrira n'importe quoi pour se débarrasser de l'écran.
 *
 * AUCUN PRIX, NULLE PART. Le coût est absent de la réponse API pour un agent
 * d'entrepôt ; ce composant n'en rendrait pas même si on lui en donnait un.
 *
 * Il n'écrit rien lui-même : il remonte ses saisies à la feuille, qui garde la
 * règle « enregistrer d'abord, agir ensuite » en un seul endroit.
 */
export function ReceptionCountFlow({
  reception,
  locale,
  edits,
  onPatch,
  onClose,
  onDeclare,
}: {
  reception: ProjectedReception;
  locale: string;
  edits: Record<string, LinePatch>;
  onPatch: (lineId: string, patch: LinePatch) => void;
  onClose: () => void;
  /**
   * Le geste final du récapitulatif. Il ENREGISTRE toujours, et il déclare en
   * plus si la réception peut encore l'être — c'est la feuille qui tranche,
   * puisque c'est elle qui tient la règle « enregistrer d'abord ».
   */
  onDeclare: () => void;
}) {
  const t = useTranslations("warehouse.receptions");
  const [index, setIndex] = useState(0);
  /*
   * LE PARCOURS A UNE FIN. On faisait compter la dernière ligne et on s'arrêtait :
   * il n'existait aucun moment pour déclarer, donc l'agent devait ressortir et
   * retrouver le bouton sur la feuille.
   */
  const [recap, setRecap] = useState(false);
  // L'avarie est un geste : le champ n'existe que si on l'a demandé, ou si la
  // ligne en porte déjà une.
  const [damageOpen, setDamageOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lines = reception.lines;
  const line = lines[Math.min(index, Math.max(lines.length - 1, 0))];
  if (!line) return null;

  const shown = (l: (typeof lines)[number]) => {
    const p = edits[l.id];
    return {
      received: p ? p.received_qty : l.received_qty,
      damaged: p ? p.damaged_qty : l.damaged_qty,
    };
  };

  const patch = edits[line.id];
  const received = patch ? patch.received_qty : line.received_qty;
  const damaged = patch ? patch.damaged_qty : line.damaged_qty;

  function write(next: Partial<LinePatch>) {
    onPatch(line.id, {
      received_qty: received,
      damaged_qty: damaged,
      unit_cost: patch ? patch.unit_cost : (line.unit_cost ?? null),
      ...next,
    });
  }

  function setReceived(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      write({ received_qty: null });
      return;
    }
    if (!/^\d+$/.test(trimmed)) return;
    write({ received_qty: Number.parseInt(trimmed, 10) });
  }

  function step(delta: number) {
    // Un champ vide puis « un de plus » part de 1, pas de NaN. Et on ne descend
    // jamais sous zéro : une quantité reçue négative n'existe pas.
    const base = received ?? 0;
    write({ received_qty: Math.max(base + delta, 0) });
  }

  const isLast = index >= lines.length - 1;
  const rtl = locale === "ar";

  /* ── le récapitulatif ────────────────────────────────────────────────────── */
  if (recap) {
    const figures = lines.map((l) => ({ line: l, ...shown(l) }));
    const counted = figures.filter((f) => f.received !== null);
    const units = counted.reduce((sum, f) => sum + (f.received ?? 0), 0);
    const damagedTotal = figures.reduce((sum, f) => sum + f.damaged, 0);
    const uncounted = figures.length - counted.length;

    return (
      <div
        className="fixed inset-0 z-[70] flex flex-col bg-wh-surface"
        dir={rtl ? "rtl" : "ltr"}
        role="dialog"
        aria-modal="true"
        aria-label={t("countDone")}
      >
        <div className="flex flex-none items-center gap-3 border-b border-wh-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("countExit")}
            className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[8px] border border-wh-border text-wh-ink-2"
          >
            <ChevronLeft size={17} className="rtl:-scale-x-100" />
          </button>
          <div className="min-w-0 flex-1">
            <h4 className="truncate font-mono text-[15px] font-bold">{reception.reference}</h4>
            <p className="mt-0.5 truncate text-[12px] text-wh-ink-3" dir="auto">
              {reception.supplier_name ?? ""}
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
          <div className="text-center">
            <span className="mx-auto mb-3 grid h-[52px] w-[52px] place-items-center rounded-full bg-wh-ok-bg text-wh-ok">
              <Check size={25} strokeWidth={2.3} />
            </span>
            <h4 className="text-[18px] font-bold">{t("countDone")}</h4>
            <p className="mx-auto mt-1.5 max-w-[280px] text-[12.5px] text-wh-ink-2">
              {t("countDoneHint")}
            </p>
          </div>

          <div className="grid grid-cols-2 overflow-hidden rounded-[10px] border border-wh-border">
            <Cell label={t("totalUnits")}>{units}</Cell>
            <Cell label={t("totalDamaged")} tone={damagedTotal > 0 ? "warn" : undefined} edge>
              {damagedTotal}
            </Cell>
            <Cell label={t("totalLines")} top>
              {counted.length} / {figures.length}
            </Cell>
            {/* La ligne sautée est un FAIT, pas une erreur — mais il doit la voir. */}
            <Cell label={t("sumNotCounted")} tone={uncounted > 0 ? "dim" : undefined} top edge>
              {uncounted}
            </Cell>
          </div>

          <ul className="flex flex-col gap-2">
            {figures.map((f) => (
              <li
                key={f.line.id}
                data-testid="count-summary-row"
                className={`flex items-center gap-3 rounded-[8px] border border-wh-border px-3 py-2.5 ${
                  f.received === null ? "bg-wh-bg" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium" dir="auto">
                  {f.line.product_name}
                </span>
                <span
                  className={`font-mono text-[14px] font-semibold tabular-nums ${
                    f.received === null ? "text-wh-ink-3" : ""
                  }`}
                >
                  {f.received === null ? "—" : f.received}
                </span>
                <Delta line={f.line} received={f.received} />
              </li>
            ))}
          </ul>
        </div>

        <div
          className="flex flex-none gap-2.5 border-t border-wh-border px-4 py-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={() => setRecap(false)}
            className="inline-flex min-h-[52px] flex-none items-center justify-center rounded-[10px] border border-wh-border bg-wh-surface px-4 text-[15px] font-semibold text-wh-ink-1"
          >
            {t("back")}
          </button>
          {/*
           * ON NE PROPOSE PAS DE DÉCLARER CE QUI EST DÉJÀ DÉCLARÉ. Le comptage
           * s'ouvre aussi sur une réception déjà déclarée — un manager qui
           * recompte avant de valider — et `POST …/submit` n'accepte qu'un
           * brouillon. Proposer « Déclarer » là menait à un 409 sur le dernier
           * écran du parcours : un cul-de-sac à l'instant précis où l'agent
           * croit avoir fini. Le bouton nomme donc le geste réel.
           */}
          <button
            type="button"
            onClick={onDeclare}
            className="inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-[10px] border border-wh-ok bg-wh-ok text-[15px] font-semibold text-white"
          >
            <Check size={18} strokeWidth={2.2} />
            {reception.can.submit ? t("submit") : t("saveLines")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-wh-surface"
      dir={rtl ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
      aria-label={t("countOnPhone")}
    >
      {/* ── en-tête ── */}
      <div className="flex flex-none items-center gap-3 border-b border-wh-border px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("countExit")}
          className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[8px] border border-wh-border text-wh-ink-2"
        >
          <ChevronLeft size={17} className="rtl:-scale-x-100" />
        </button>
        <div className="min-w-0 flex-1">
          <h4 className="truncate font-mono text-[15px] font-bold">{reception.reference}</h4>
          <p className="mt-0.5 truncate text-[12px] text-wh-ink-3" dir="auto">
            {reception.supplier_name ? `${reception.supplier_name} · ` : ""}
            {rtl ? (reception.warehouse_name_ar ?? reception.warehouse_name) : reception.warehouse_name}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-4">
        {/* ── progression ── */}
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[12px] font-semibold tabular-nums text-wh-ink-2">
            {index + 1} / {lines.length}
          </span>
          <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-wh-sunken">
            <div
              className="h-full rounded-full bg-wh-ok"
              style={{ width: `${((index + 1) / lines.length) * 100}%` }}
            />
          </div>
        </div>

        {/* ── la carte produit ── */}
        <div className="rounded-[10px] border border-wh-border p-4 text-center">
          <div className="mx-auto mb-3 flex justify-center">
            <ProductAvatar
              imageUrl={line.product_image_url ?? null}
              productName={line.product_name}
              size={60}
            />
          </div>
          <p className="text-[16px] font-bold leading-tight" dir="auto">
            {line.product_name}
          </p>
          <p className="mt-1 font-mono text-[12.5px] text-wh-ink-3">
            {line.variant_label ? `${line.variant_label} · ` : ""}
            {line.product_sku ?? ""}
          </p>

          {/*
           * L'attendu, en lecture seule. « non annoncé » plutôt que 0 : la ligne
           * peut très bien ne pas être sur le bon de livraison.
           */}
          <div className="mt-3.5 flex justify-around gap-2.5 rounded-[8px] bg-wh-sunken p-3">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-wh-ink-3">
                {t("colExpected")}
              </div>
              <div className="mt-0.5 font-mono text-[17px] font-bold tabular-nums">
                {line.expected_qty === null ? (
                  <span className="text-[11.5px] font-medium italic text-wh-ink-3">
                    {t("notAnnounced")}
                  </span>
                ) : (
                  line.expected_qty
                )}
              </div>
            </div>
            {line.product_stock !== null && line.product_stock !== undefined ? (
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-wh-ink-3">
                  {t("currentStock")}
                </div>
                <div className="mt-0.5 font-mono text-[17px] font-bold tabular-nums">
                  {line.product_stock}
                </div>
              </div>
            ) : null}
          </div>

          {/* ── le grand champ ── */}
          <div className="mt-3.5">
            <label
              htmlFor="count-received"
              className="mb-1.5 block text-[12px] font-semibold text-wh-ink-2"
            >
              {t("qtyReceived")}
            </label>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                aria-label={t("decrement")}
                onClick={() => step(-1)}
                className="grid h-[52px] w-[52px] flex-none place-items-center rounded-[10px] border border-wh-border text-[23px] font-semibold text-wh-ink-2"
              >
                −
              </button>
              <input
                id="count-received"
                inputMode="numeric"
                placeholder="—"
                value={received ?? ""}
                onChange={(e) => setReceived(e.target.value)}
                className={`h-[52px] min-w-0 flex-1 rounded-[10px] border text-center font-mono text-[26px] font-bold tabular-nums ${
                  received === null
                    ? "border-dashed border-wh-border bg-wh-surface"
                    : "border-wh-ok bg-wh-ok-bg/50"
                }`}
              />
              <button
                type="button"
                aria-label={t("increment")}
                onClick={() => step(1)}
                className="grid h-[52px] w-[52px] flex-none place-items-center rounded-[10px] border border-wh-border text-[23px] font-semibold text-wh-ink-2"
              >
                +
              </button>
            </div>

            <div className="mt-2.5 flex flex-wrap justify-center gap-2">
              {line.expected_qty !== null ? (
                <button
                  type="button"
                  onClick={() => write({ received_qty: line.expected_qty })}
                  className={`rounded-full border px-3 py-1.5 font-mono text-[12.5px] font-semibold ${
                    received === line.expected_qty
                      ? "border-wh-ok bg-wh-ok text-white"
                      : "border-wh-border bg-wh-surface text-wh-ink-2"
                  }`}
                >
                  {t("chipExpected", { qty: line.expected_qty })}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => write({ received_qty: 0 })}
                className={`rounded-full border px-3 py-1.5 font-mono text-[12.5px] font-semibold ${
                  received === 0
                    ? "border-wh-ok bg-wh-ok text-white"
                    : "border-wh-border bg-wh-surface text-wh-ink-2"
                }`}
              >
                {t("chipZero")}
              </button>
            </div>
          </div>

          {/*
           * ABÎMÉ EST UN SECOND NOMBRE, ET UN GESTE.
           *
           * Les fondre dans la quantité reçue obligerait l'agent à faire une
           * soustraction debout sur un quai. Mais un encadré ambre présent sur
           * CHAQUE ligne réclame une avarie qui n'arrive presque jamais, et finit
           * par ne plus rien signaler : il reste donc à un geste, et ne s'ouvre
           * de lui-même que sur une ligne qui en porte déjà une.
           */}
          {damaged > 0 || damageOpen[line.id] ? (
            <div className="mt-4 flex w-full items-center justify-between gap-3 rounded-[8px] border border-wh-warn-edge bg-wh-warn-bg px-3.5 py-3">
              <label htmlFor="count-damaged" className="text-[13px] font-semibold text-wh-warn">
                {t("damagedOnArrival")}
              </label>
              <input
                id="count-damaged"
                autoFocus={damaged === 0}
                inputMode="numeric"
                value={damaged}
                onChange={(e) => {
                  const trimmed = e.target.value.trim();
                  if (trimmed !== "" && !/^\d+$/.test(trimmed)) return;
                  write({ damaged_qty: trimmed === "" ? 0 : Number.parseInt(trimmed, 10) });
                }}
                className="h-[42px] w-16 rounded-[6px] border border-wh-warn-edge bg-wh-surface text-center font-mono text-[17px] font-bold tabular-nums text-wh-warn"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDamageOpen((d) => ({ ...d, [line.id]: true }))}
              className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-wh-warn"
            >
              <Plus size={15} strokeWidth={2.2} />
              {t("reportDamaged")}
            </button>
          )}
        </div>
      </div>

      {/* ── pied ── */}
      <div
        className="flex flex-none gap-2.5 border-t border-wh-border px-4 py-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {!isLast ? (
          <button
            type="button"
            onClick={() => setIndex((i) => i + 1)}
            className="inline-flex min-h-[52px] flex-none items-center justify-center rounded-[10px] border border-wh-border bg-wh-surface px-4 text-[15px] font-semibold text-wh-ink-1"
          >
            {t("skip")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => (isLast ? setRecap(true) : setIndex((i) => i + 1))}
          className="inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-[10px] border border-wh-ok bg-wh-ok text-[15px] font-semibold text-white"
        >
          {isLast ? (
            <>
              <Check size={18} strokeWidth={2.2} />
              {t("finishCount")}
            </>
          ) : (
            <>
              {t("next")}
              <ArrowRight size={18} strokeWidth={2.2} className="rtl:-scale-x-100" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function Cell({
  label,
  tone,
  top,
  edge,
  children,
}: {
  label: string;
  tone?: "warn" | "dim";
  top?: boolean;
  edge?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`p-3.5 ${top ? "border-t border-wh-border" : ""} ${
        edge ? "border-s border-wh-border" : ""
      }`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-wh-ink-3">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-[21px] font-bold tabular-nums ${
          tone === "warn" ? "text-wh-warn" : tone === "dim" ? "text-wh-ink-3" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * L'écart d'une ligne du récapitulatif.
 *
 * Même règle que partout : un écart suppose DEUX nombres. Sans attendu c'est un
 * autre fait — « hors bon » — et sans comptage il n'y a rien à dire.
 */
function Delta({
  line,
  received,
}: {
  line: ProjectedReception["lines"][number];
  received: number | null;
}) {
  const t = useTranslations("warehouse.receptions");
  if (received === null) {
    return <span className="font-mono text-[11px] font-bold text-wh-ink-3">{t("notCounted")}</span>;
  }
  if (line.expected_qty === null) {
    return received > 0 ? (
      <span className="font-mono text-[11px] font-bold text-wh-move">
        {t("offDocket", { delta: `+${received}` })}
      </span>
    ) : null;
  }
  const delta = received - line.expected_qty;
  return (
    <span
      className={`font-mono text-[11px] font-bold ${
        delta === 0 ? "text-wh-ok" : delta < 0 ? "text-wh-bad" : "text-wh-move"
      }`}
    >
      {delta === 0 ? t("conform") : `${delta > 0 ? "+" : "\u2212"}${Math.abs(delta)}`}
    </span>
  );
}

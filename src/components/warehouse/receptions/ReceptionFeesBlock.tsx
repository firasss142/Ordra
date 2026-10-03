"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import type { ProjectedReception } from "@/lib/receptions/project";

/**
 * Les frais d'approche d'une réception.
 *
 * LE PRIX DU FOURNISSEUR N'EST PAS CE QUE LA MARCHANDISE COÛTE. Transport,
 * douane et manutention sont payés pour qu'elle arrive ici ; sans eux, tout COGS
 * adopté depuis une réception est systématiquement TROP BAS — ce qui gonfle la
 * marge de chaque produit, le seuil de rentabilité et les relevés investisseurs.
 * Pour un importateur, c'est le plus gros écart de justesse du modèle.
 *
 * LE CRITÈRE EST UN CHOIX, PAS UN DÉFAUT CACHÉ. Une palette de livres et un
 * carton de jouets ne partagent pas le transport de la même façon.
 */

const KINDS = ["freight", "customs", "clearing", "handling", "other"] as const;
type Kind = (typeof KINDS)[number];

const KIND_KEY: Record<Kind, string> = {
  freight: "feesKindFreight",
  customs: "feesKindCustoms",
  clearing: "feesKindClearing",
  handling: "feesKindHandling",
  other: "feesKindOther",
};

export function ReceptionFeesBlock({
  reception,
  currency,
  editable,
  onChanged,
}: {
  reception: ProjectedReception;
  currency: string;
  /** Une réception validée a son coût figé : rouvrir les frais ferait mentir le registre. */
  editable: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("warehouse.receptions");
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>("freight");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const nf = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });

  const costs = reception.costs ?? [];
  const total = reception.fees_total ?? 0;
  const units = reception.totals.units;
  const perUnit = units > 0 ? total / units : null;

  async function send(init: RequestInit, qs = "") {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/warehouse/receptions/${reception.id}/costs${qs}`, init);
      if (res.ok) await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const value = Number.parseFloat(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return;
    await send({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: value, kind, label: label.trim() || null }),
    });
    setAmount("");
    setLabel("");
    setAdding(false);
  }

  async function setBasis(next: "value" | "units") {
    if (next === reception.fee_basis) return;
    await send({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fee_basis: next }),
    });
  }

  return (
    <section className="mx-4 mb-4 overflow-hidden rounded-[10px] border border-wh-border md:mx-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-wh-border bg-wh-sunken px-3.5 py-2.5">
        <span className="text-[12.5px] font-bold">{t("feesTitle")}</span>
        <span className="text-[11.5px] text-wh-ink-3">{t("feesHint")}</span>

        {editable ? (
          <span className="ms-auto inline-flex gap-0.5 rounded-[7px] bg-wh-surface-2 p-0.5">
            {(["value", "units"] as const).map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={reception.fee_basis === b}
                onClick={() => setBasis(b)}
                className={`rounded-[5px] px-2.5 py-1 text-[11.5px] font-semibold ${
                  reception.fee_basis === b
                    ? "bg-wh-surface text-wh-ink-1 shadow-[inset_0_0_0_1px_var(--wh-border)]"
                    : "text-wh-ink-2"
                }`}
              >
                {t(b === "value" ? "feesBasisValue" : "feesBasisUnits")}
              </button>
            ))}
          </span>
        ) : null}
      </header>

      {costs.length === 0 ? (
        <p className="px-3.5 py-3 text-[12.5px] text-wh-ink-3">{t("feesEmpty")}</p>
      ) : (
        costs.map((c) => (
          <div
            key={c.id}
            className="grid grid-cols-[1fr_auto_28px] items-center gap-x-3 border-b border-wh-border px-3.5 py-2 last:border-b-0"
          >
            <span className="min-w-0 truncate text-[13px]" dir="auto">
              {c.label || t(KIND_KEY[(c.kind as Kind) ?? "other"] ?? "feesKindOther")}
              {c.label ? (
                <span className="ms-2 text-[11px] text-wh-ink-3">
                  {t(KIND_KEY[(c.kind as Kind) ?? "other"] ?? "feesKindOther")}
                </span>
              ) : null}
            </span>
            <span className="text-end font-mono text-[13.5px] font-semibold tabular-nums">
              {nf.format(Number(c.amount))}
            </span>
            {editable ? (
              <button
                type="button"
                aria-label={t("feesRemove")}
                disabled={busy}
                /* `cost_id` voyage en query : le corps d'un DELETE n'est pas
                   garanti d'être lu côté serveur. */
                onClick={() => void send({ method: "DELETE" }, `?cost_id=${c.id}`)}
                className="grid place-items-center p-1 text-wh-ink-3 hover:text-wh-bad"
              >
                <Trash2 size={14} />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))
      )}

      {/* Le total, et ce qu'il représente par unité : le chiffre qui dit si les
          frais pèsent. */}
      {costs.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-wh-border bg-wh-sunken px-3.5 py-2.5">
          <span className="text-[12px] font-semibold text-wh-ink-2">
            {perUnit === null
              ? null
              : t("feesSpread", { units, perUnit: nf.format(perUnit) })}
          </span>
          <span className="font-mono text-[13.5px] font-bold tabular-nums">
            {nf.format(total)}
            <span className="ms-1.5 font-sans text-[11px] font-semibold text-wh-ink-2">
              {currency}
            </span>
          </span>
        </div>
      ) : null}

      {/* Les frais existent mais rien ne peut les porter : on le DIT, au lieu de
          basculer en douce sur l'autre critère. */}
      {reception.fees_blocked !== null && total > 0 ? (
        <p className="border-t border-wh-warn-edge bg-wh-warn-bg px-3.5 py-2.5 text-[12.5px] text-wh-warn">
          {t("feesBlocked")}
        </p>
      ) : null}

      {editable ? (
        <div className="border-t border-wh-border px-3.5 py-2.5">
          {adding ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-wh-ink-3">
                  {t("feesKind")}
                </span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Kind)}
                  className="min-h-[36px] rounded-[6px] border border-wh-border px-2 text-[13px]"
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(KIND_KEY[k])}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[150px] flex-1 flex-col gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-wh-ink-3">
                  {t("feesLabel")}
                </span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  dir="auto"
                  className="min-h-[36px] rounded-[6px] border border-wh-border px-2 text-[13px]"
                />
              </label>
              <label className="flex w-[120px] flex-col gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-wh-ink-3">
                  {t("feesAmount")}
                </span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="min-h-[36px] rounded-[6px] border border-wh-border px-2 text-end font-mono text-[13px] tabular-nums"
                />
              </label>
              <button
                type="button"
                onClick={add}
                disabled={busy}
                className="min-h-[36px] rounded-[8px] border border-wh-ok bg-wh-ok px-3 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {t("feesAdd")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-wh-ink-2"
            >
              <Plus size={15} strokeWidth={2.2} />
              {t("feesAdd")}
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

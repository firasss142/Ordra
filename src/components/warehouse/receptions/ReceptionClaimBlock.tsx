"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, TriangleAlert } from "lucide-react";
import type { ProjectedClaim } from "@/lib/receptions/project";

/**
 * LE LITIGE, SUR LE DOCUMENT QUI L'A FAIT NAÎTRE.
 *
 * `damaged_qty` était saisi sur le quai depuis le 30 septembre et lu par
 * PERSONNE : aucune somme, aucun écran, aucune décision. Ici il porte enfin un
 * montant, un interlocuteur et deux issues — et le dialogue de soldage tient la
 * promesse qu'il affiche déjà en toutes lettres.
 *
 * POURQUOI ICI ET PAS DANS ACHATS. Achats dit COMBIEN est en litige, parce que
 * c'est une question de trésorerie. Trancher demande le contexte : quelles
 * unités, à quel prix, sur quelle facture — et ce contexte est la feuille de
 * réception. Un écran de litiges séparé obligerait à revenir ici pour décider.
 *
 * DEUX ISSUES, PAS TROIS. « Retiré » ou « abandonné » auraient exactement la
 * conséquence de « renoncer », et deux noms sous un seul effet finissent
 * toujours par être comptés deux fois.
 */

type Draft = { outcome: "credited" | "conceded"; ref: string; note: string } | null;

export function ReceptionClaimBlock({
  claim,
  currency,
  editable,
  onChanged,
}: {
  claim: ProjectedClaim;
  currency: string | null;
  editable: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("warehouse.receptions");
  const tp = useTranslations("purchases");
  const [draft, setDraft] = useState<Draft>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nf = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });

  const cause =
    claim.kind === "damaged"
      ? tp("claimKindDamaged", { units: claim.units ?? 0 })
      : claim.kind === "shortage"
        ? tp("claimKindShortage")
        : tp("claimKindOverbilled");

  const statusLabel =
    claim.status === "open"
      ? tp("claimOpen")
      : claim.status === "credited"
        ? tp("claimCredited")
        : tp("claimConceded");

  async function submit() {
    if (!draft || busy) return;
    // UN AVOIR SE PROUVE. Le serveur le refuse aussi ; l'écran ne s'appuie
    // jamais sur le serveur pour dire non.
    if (draft.outcome === "credited" && draft.ref.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/purchases/claims/${claim.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: draft.outcome,
          credit_ref: draft.ref.trim() || null,
          note: draft.note.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? tp("claimErrorGeneric"));
        return;
      }
      setDraft(null);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const open = claim.status === "open";

  return (
    <section
      className={`overflow-hidden rounded-[10px] border ${
        open ? "border-wh-warn-edge bg-wh-warn-bg" : "border-wh-border bg-wh-surface"
      }`}
    >
      <header className="flex items-start gap-2.5 px-3.5 py-3">
        {open ? (
          <TriangleAlert size={15} className="mt-px flex-none text-wh-warn" />
        ) : (
          <Check size={15} strokeWidth={2.6} className="mt-px flex-none text-wh-ok" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13px] font-bold">{t("claimTitle")}</span>
            <span className="text-[11.5px] font-semibold text-wh-ink-2">{statusLabel}</span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-wh-ink-2" dir="auto">
            {cause}
          </div>
          {/* POURQUOI LE SOLDE EST SOUS LA FACTURE, dit sur le document même. */}
          {open ? (
            <div className="mt-1 text-[11.5px] text-wh-ink-3">{t("claimWithheldNote")}</div>
          ) : null}
          {claim.credit_ref ? (
            <div className="mt-1 font-mono text-[11.5px] text-wh-ink-2">{claim.credit_ref}</div>
          ) : null}
          {claim.resolution_note ? (
            <div className="mt-1 text-[11.5px] text-wh-ink-3" dir="auto">
              {claim.resolution_note}
            </div>
          ) : null}
        </div>
        <span className="flex-none text-end">
          <span className="block font-mono text-[15px] font-bold tabular-nums">
            {nf.format(claim.amount)}
          </span>
          {currency ? (
            <span className="block text-[10.5px] font-semibold text-wh-ink-3">{currency}</span>
          ) : null}
        </span>
      </header>

      {open && editable ? (
        <div className="border-t border-wh-border px-3.5 py-3">
          {draft === null ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDraft({ outcome: "credited", ref: "", note: "" })}
                className="min-h-[36px] rounded-[8px] border border-wh-ok bg-wh-ok-tint px-3 text-[12.5px] font-bold text-wh-ok"
              >
                {tp("claimCredit")}
              </button>
              <button
                type="button"
                onClick={() => setDraft({ outcome: "conceded", ref: "", note: "" })}
                className="min-h-[36px] rounded-[8px] border border-wh-border-strong bg-wh-surface px-3 text-[12.5px] font-semibold"
              >
                {tp("claimConcede")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {draft.outcome === "credited" ? (
                <div>
                  <label
                    htmlFor="claim-ref"
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-wh-ink-2"
                  >
                    {tp("claimCreditRef")}
                  </label>
                  <input
                    id="claim-ref"
                    value={draft.ref}
                    onChange={(e) => setDraft({ ...draft, ref: e.target.value })}
                    className="h-9 w-full rounded-[8px] border border-wh-border bg-wh-surface px-2.5 font-mono text-[13px]"
                  />
                  <p className="mt-1 text-[11px] text-wh-ink-3">{tp("claimCreditRefHint")}</p>
                </div>
              ) : null}

              <div>
                <label
                  htmlFor="claim-note"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-wh-ink-2"
                >
                  {tp("claimResolveNote")}
                </label>
                <input
                  id="claim-note"
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  className="h-9 w-full rounded-[8px] border border-wh-border bg-wh-surface px-2.5 text-[13px]"
                  dir="auto"
                />
              </div>

              {error ? (
                <p className="rounded-[8px] border border-wh-bad bg-wh-bad-bg px-3 py-2 text-[12.5px] text-wh-bad">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submit()}
                  className="min-h-[36px] rounded-[8px] bg-wh-ok px-3.5 text-[12.5px] font-bold text-white disabled:opacity-50"
                >
                  {t("claimSave")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setError(null);
                  }}
                  className="min-h-[36px] rounded-[8px] border border-wh-border-strong bg-wh-surface px-3 text-[12.5px] font-semibold"
                >
                  {t("claimCancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

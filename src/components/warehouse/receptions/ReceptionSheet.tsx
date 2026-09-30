"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, Check, Plus, Trash2, Image as ImageIcon } from "lucide-react";
import type { Role } from "@/types";
import { useReception } from "@/hooks/useReceptions";
import { canSeeReceptionCosts } from "@/lib/receptions/permissions";
import { WH_CARD, WH_LABEL, WH_BTN, WH_BTN_PRIMARY } from "@/components/warehouse/console/tokens";
import { ReceptionStatusChip, PaymentChip } from "./ReceptionStatusChip";
import { ReceptionPostDialog } from "./ReceptionPostDialog";

/**
 * La feuille d'une réception — plein écran, pas une modale de 480 px.
 *
 * Un document à plusieurs lignes ne tient pas dans la modale du système, et un
 * seul composant sert ainsi le bureau et le téléphone, où le plein écran est la
 * seule option possible.
 *
 * LA BARRE DE SAISIE EST LA CHOSE UTILE. Sur une réception de quarante lignes,
 * « il en reste une à compter » est invisible dans un tableau. Un champ non
 * compté reste en pointillés et dit « pas encore comptée » — pas `0`, qui
 * voudrait dire « rien n'est arrivé ».
 */

const LINE_GRID =
  "grid items-center gap-x-3 " +
  "grid-cols-[minmax(200px,2.4fr)_88px_108px_88px] md:grid-cols-[minmax(220px,2.4fr)_88px_108px_88px_108px_116px]";

export function ReceptionSheet({
  id,
  locale,
  role,
  currency,
  onClose,
  onChanged,
}: {
  id: string;
  locale: string;
  role: Role;
  currency: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("warehouse.receptions");
  const { reception, isLoading, mutate } = useReception(id);
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withCosts = canSeeReceptionCosts(role);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !posting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, posting]);

  const nf = new Intl.NumberFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
    maximumFractionDigits: 0,
  });
  const cf = new Intl.NumberFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });

  async function act(path: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/receptions/${id}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? String(res.status));
        return false;
      }
      await mutate();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "network");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !reception) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-wh-bg">
        <p className="text-[13px] text-wh-ink-3">…</p>
      </div>
    );
  }

  const r = reception;
  // « Comptée » veut dire qu'un humain a mis un nombre — y compris zéro, qui est
  // une réponse. `null` veut dire que personne n'a encore regardé.
  const counted = r.lines.filter((l) => l.received_qty !== null).length;
  const remaining = r.lines.length - counted;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-wh-bg">
      <div className="mx-auto w-full max-w-[1200px] p-4 md:p-6">
        <div className={`${WH_CARD} overflow-hidden`}>
          {/* ── en-tête ── */}
          <div className="flex flex-wrap items-start gap-4 border-b border-wh-border p-4 md:p-5">
            <button
              type="button"
              onClick={onClose}
              aria-label={t("cancel")}
              className="grid h-8 w-8 flex-none place-items-center rounded-[8px] border border-wh-border text-wh-ink-2 hover:bg-wh-sunken"
            >
              <ChevronLeft size={17} className="rtl:-scale-x-100" />
            </button>

            <div className="min-w-0 flex-1">
              <h3 className="flex flex-wrap items-center gap-2.5 font-mono text-[18px] font-semibold tracking-tight">
                {r.reference}
                <ReceptionStatusChip status={r.status} />
              </h3>
              <div className="mt-2 flex flex-wrap gap-4">
                <Fact label={t("colSite")}>
                  {locale === "ar" ? (r.warehouse_name_ar ?? r.warehouse_name) : r.warehouse_name}
                </Fact>
                {r.supplier_name ? (
                  <Fact label={t("colSupplier")}>
                    <span dir="auto">{r.supplier_name}</span>
                  </Fact>
                ) : null}
                {r.supplier_ref ? (
                  <Fact label={t("deliveryNote")}>
                    <span className="font-mono text-[12.5px]">{r.supplier_ref}</span>
                  </Fact>
                ) : null}
                {r.submitted_by_name ? (
                  <Fact label={t("declaredBy", { name: "" }).replace(/\s*\{?name\}?\s*/, "")}>
                    {r.submitted_by_name}
                  </Fact>
                ) : null}
                {r.expected_at ? <Fact label={t("fieldExpectedAt")}>{r.expected_at}</Fact> : null}
              </div>
            </div>

            {r.photo_url ? (
              <a href={r.photo_url} target="_blank" rel="noreferrer" className={WH_BTN}>
                <ImageIcon size={16} />
                {t("deliveryNote")}
              </a>
            ) : null}
          </div>

          {/* ── progression de saisie ── */}
          {(r.status === "draft" || r.status === "submitted") && r.lines.length > 0 ? (
            <div className="flex flex-wrap items-center gap-4 border-b border-wh-border bg-wh-ok-bg/40 px-4 py-3 md:px-5">
              <span className="text-[13px] font-semibold text-wh-ok">
                {t("entryProgress", { done: counted, total: r.lines.length })}
              </span>
              <div className="h-2 min-w-[160px] flex-1 overflow-hidden rounded-full border border-wh-border bg-wh-surface">
                <div
                  className="h-full rounded-full bg-wh-ok"
                  style={{ width: `${r.lines.length ? (counted / r.lines.length) * 100 : 0}%` }}
                />
              </div>
              {remaining > 0 ? (
                <span className="text-[13px] font-semibold text-wh-warn">
                  {t("entryRemaining", { count: remaining })}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* ── lignes ── */}
          <div
            className={`${LINE_GRID} border-b border-wh-border bg-wh-sunken px-4 pb-2.5 pt-3 md:px-5`}
          >
            <span className={WH_LABEL}>{t("colProduct")}</span>
            <span className={`${WH_LABEL} text-end`}>{t("colExpected")}</span>
            <span className={`${WH_LABEL} text-end`}>{t("colReceived")}</span>
            <span className={`${WH_LABEL} text-end`}>{t("colDamaged")}</span>
            {withCosts ? (
              <>
                <span className={`${WH_LABEL} hidden text-end md:block`}>{t("colUnitCost")}</span>
                <span className={`${WH_LABEL} hidden text-end md:block`}>{t("colTotal")}</span>
              </>
            ) : null}
          </div>

          <ul>
            {r.lines.map((l) => (
              <li
                key={l.id}
                className={`${LINE_GRID} border-b border-wh-border px-4 py-3 last:border-b-0 md:px-5`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold" dir="auto">
                    {l.product_name}
                  </span>
                  <span className="mt-0.5 block font-mono text-[11.5px] text-wh-ink-3">
                    {l.variant_label ? `${l.variant_label} · ` : ""}
                    {l.product_sku ?? ""}
                  </span>
                </span>

                {/* Attendu : « non annoncé » quand rien ne l'était — jamais 0. */}
                <span className="text-end">
                  {l.expected_qty === null ? (
                    <span className="text-[11.5px] italic text-wh-ink-3">{t("notAnnounced")}</span>
                  ) : (
                    <span className="font-mono text-[14px] font-medium text-wh-ink-3 tabular-nums">
                      {nf.format(l.expected_qty)}
                    </span>
                  )}
                </span>

                {/* Reçu, et l'écart seulement si les DEUX nombres existent. */}
                <span className="text-end">
                  {l.received_qty === null ? (
                    <span className="inline-block w-full rounded-[6px] border border-dashed border-wh-border px-2.5 py-1.5 text-center text-[12px] italic text-wh-ink-3">
                      {t("notCounted")}
                    </span>
                  ) : (
                    <>
                      <span className="block rounded-[6px] border border-wh-ok bg-wh-ok-bg/50 px-2.5 py-1.5 text-end font-mono text-[14px] font-semibold tabular-nums">
                        {nf.format(l.received_qty)}
                      </span>
                      {l.variance !== null ? (
                        <span
                          className={`mt-1 block font-mono text-[11.5px] font-bold ${
                            l.variance === 0
                              ? "text-wh-ok"
                              : l.variance < 0
                                ? "text-wh-bad"
                                : "text-wh-move"
                          }`}
                        >
                          {l.variance === 0
                            ? t("conform")
                            : l.variance > 0 && l.expected_qty === 0
                              ? t("offDocket", { delta: `+${l.variance}` })
                              : `${l.variance > 0 ? "+" : "−"}${Math.abs(l.variance)}`}
                        </span>
                      ) : null}
                    </>
                  )}
                </span>

                <span className="text-end">
                  {l.damaged_qty > 0 ? (
                    <span className="inline-block rounded-[6px] border border-wh-warn-edge bg-wh-warn-bg px-2.5 py-1 font-mono text-[13.5px] font-bold text-wh-warn tabular-nums">
                      {nf.format(l.damaged_qty)}
                    </span>
                  ) : (
                    <span className="font-mono text-[14px] font-medium text-wh-ink-3 tabular-nums">
                      0
                    </span>
                  )}
                </span>

                {withCosts ? (
                  <>
                    <span className="hidden text-end font-mono text-[13.5px] tabular-nums md:block">
                      {/*
                        `unit_cost` est OPTIONNEL dans la projection : absent
                        pour un agent d'entrepôt, nul quand personne n'a chiffré
                        la ligne. Les deux se lisent « — ».
                      */}
                      {l.unit_cost === null || l.unit_cost === undefined ? (
                        <span className="text-wh-ink-3">—</span>
                      ) : (
                        cf.format(l.unit_cost)
                      )}
                    </span>
                    <span className="hidden text-end font-mono text-[13.5px] font-semibold tabular-nums md:block">
                      {l.line_value === null || l.line_value === undefined ? (
                        <span className="text-wh-ink-3">—</span>
                      ) : (
                        nf.format(l.line_value)
                      )}
                    </span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>

          {/* ── totaux + action ── */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-wh-border bg-wh-sunken px-4 py-3.5 md:px-5">
            <div className="flex flex-wrap gap-5">
              <Total label={t("totalLines")}>{nf.format(r.totals.lines)}</Total>
              <Total label={t("totalUnits")}>{nf.format(r.totals.units)}</Total>
              <Total label={t("totalDamaged")} tone={r.totals.damaged > 0 ? "warn" : undefined}>
                {nf.format(r.totals.damaged)}
              </Total>
              {withCosts ? (
                <Total label={t("totalValue")}>
                  {r.totals.value === null ? (
                    <span className="text-wh-ink-3">—</span>
                  ) : (
                    <>
                      {nf.format(r.totals.value)}
                      <span className="ms-1 font-sans text-[11.5px] font-semibold text-wh-ink-2">
                        {currency}
                      </span>
                    </>
                  )}
                </Total>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2.5">
              {r.can.submit ? (
                <button
                  type="button"
                  className={WH_BTN_PRIMARY}
                  disabled={busy}
                  onClick={() => void act("/submit")}
                >
                  <Check size={17} strokeWidth={2.2} />
                  {t("submit")}
                </button>
              ) : null}
              {r.can.post ? (
                <button
                  type="button"
                  className={WH_BTN_PRIMARY}
                  disabled={busy}
                  onClick={() => setPosting(true)}
                >
                  <Check size={17} strokeWidth={2.2} />
                  {t("post")}
                </button>
              ) : null}
            </div>
          </div>

          {error ? (
            <p className="border-t border-wh-bad-edge bg-wh-bad-bg px-4 py-2.5 text-[13px] font-medium text-wh-bad md:px-5">
              {error}
            </p>
          ) : null}

          {/* ── paiements ── */}
          {withCosts && r.payment_state !== null ? (
            <PaymentsBlock
              receptionId={r.id}
              payments={r.payments}
              paidTotal={r.paid_total ?? 0}
              value={r.totals.value}
              outstanding={r.outstanding}
              state={r.payment_state}
              currency={currency}
              canPay={r.can.pay}
              onChanged={() => {
                void mutate();
                onChanged();
              }}
            />
          ) : null}
        </div>
      </div>

      {posting ? (
        <ReceptionPostDialog
          reception={r}
          currency={currency}
          onClose={() => setPosting(false)}
          onPosted={() => {
            setPosting(false);
            void mutate();
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={WH_LABEL}>{label}</div>
      <div className="mt-0.5 text-[13px] font-medium">{children}</div>
    </div>
  );
}

function Total({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className={WH_LABEL}>{label}</div>
      <div
        className={`mt-0.5 font-mono text-[19px] font-semibold tabular-nums ${
          tone === "warn" ? "text-wh-warn" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Le bloc paiement.
 *
 * « payé / partiellement payé » n'est pas stocké : il se déduit de la somme des
 * versements contre la valeur reçue. Deux acomptes sur une livraison marchent
 * donc d'emblée, et le reste à payer ne peut pas se désynchroniser de ses lignes.
 */
function PaymentsBlock({
  receptionId,
  payments,
  paidTotal,
  value,
  outstanding,
  state,
  currency,
  canPay,
  onChanged,
}: {
  receptionId: string;
  payments: { id: string; paid_at: string; amount: number; method: string | null; note: string | null }[];
  paidTotal: number;
  value: number | null;
  outstanding: number | null;
  state: string;
  currency: string;
  canPay: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("warehouse.receptions");
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cf = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  const pct = value && value > 0 ? Math.min((paidTotal / value) * 100, 100) : 0;

  async function add() {
    const parsed = Number.parseFloat(amount.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/receptions/${receptionId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parsed, method }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? String(res.status));
        return;
      }
      setAmount("");
      setAdding(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(paymentId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(
        `/api/warehouse/receptions/${receptionId}/payments?payment_id=${encodeURIComponent(paymentId)}`,
        { method: "DELETE" },
      );
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const METHODS: Record<string, string> = {
    cash: t("methodCash"),
    bank_transfer: t("methodBankTransfer"),
    cheque: t("methodCheque"),
    other: t("methodOther"),
  };

  return (
    <div className="border-t border-wh-border p-4 md:p-5">
      <h4 className={`${WH_LABEL} flex flex-wrap items-center gap-2.5`}>
        {t("payments")}
        <PaymentChip state={state} outstanding={outstanding} currency={currency} />
      </h4>

      {value !== null ? (
        <div className="my-3 h-2 overflow-hidden rounded-full bg-wh-sunken">
          <div className="h-full bg-wh-ok" style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      {payments.length > 0 ? (
        <ul>
          {payments.map((p) => (
            <li
              key={p.id}
              className="grid grid-cols-[96px_1fr_auto_28px] items-center gap-x-3 border-b border-wh-border py-2.5 last:border-b-0"
            >
              <span className="font-mono text-[12.5px] text-wh-ink-2">{p.paid_at}</span>
              <span className="truncate text-[13px]">
                {p.method ? METHODS[p.method] : "—"}
                {p.note ? <span className="ms-2 text-[12px] text-wh-ink-3">{p.note}</span> : null}
              </span>
              <span className="text-end font-mono text-[13.5px] font-semibold tabular-nums">
                {cf.format(p.amount)}
              </span>
              {canPay ? (
                <button
                  type="button"
                  aria-label={t("deletePayment")}
                  onClick={() => void remove(p.id)}
                  className="grid place-items-center text-wh-ink-3 hover:text-wh-bad"
                >
                  <Trash2 size={15} />
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {outstanding !== null ? (
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-wh-border-strong pt-3">
          <span className="text-[13px] font-semibold">
            {outstanding > 0 ? t("paymentRemaining") : t("paymentSettled")}
          </span>
          <span
            className={`font-mono text-[17px] font-bold tabular-nums ${
              outstanding > 0 ? "text-wh-bad" : "text-wh-ok"
            }`}
          >
            {cf.format(outstanding)} {currency}
          </span>
        </div>
      ) : null}

      {canPay ? (
        adding ? (
          <div className="mt-3 flex flex-wrap items-end gap-2.5">
            <label className="flex-1">
              <span className={WH_LABEL}>{t("paymentAmount")}</span>
              <input
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-[6px] border border-wh-border px-2.5 py-2 text-end font-mono text-[14px] tabular-nums"
              />
            </label>
            <label>
              <span className={WH_LABEL}>{t("paymentMethod")}</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="mt-1 rounded-[6px] border border-wh-border px-2.5 py-2 text-[13.5px]"
              >
                {Object.entries(METHODS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={WH_BTN_PRIMARY} disabled={busy} onClick={() => void add()}>
              {t("save")}
            </button>
            <button type="button" className={WH_BTN} onClick={() => setAdding(false)}>
              {t("cancel")}
            </button>
          </div>
        ) : (
          <button type="button" className={`${WH_BTN} mt-3`} onClick={() => setAdding(true)}>
            <Plus size={16} />
            {t("paymentAdd")}
          </button>
        )
      ) : null}

      {error ? <p className="mt-2 text-[12.5px] font-medium text-wh-bad">{error}</p> : null}
    </div>
  );
}

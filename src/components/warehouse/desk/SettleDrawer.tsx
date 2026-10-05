"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { jsonFetcher } from "@/lib/fetchers";
import { allocateFees } from "@/lib/receptions/landed";
import { reconcileInvoice } from "@/lib/warehouse/desk";
import type { ProjectedReception } from "@/lib/receptions/project";
import { Drawer, Eb, Ic, Sec, Thumb, fmoney, fnum } from "./ui";

/**
 * « Solder » — the office's gesture (prototypes/entrepot-desk-v1.html).
 *
 * The stock moved at the dock. Here the money is written: the supplier's
 * invoice, the price of each line, the transport spread per unit — and the
 * reconciliation is the control. When the gap is exactly the damaged units at
 * their price, the cause is proposed (they were billed and never entered
 * stock → a claim). Any other gap is decided explicitly: claimed or accepted.
 *
 * The invoice keeps the SUPPLIER's figure; transport is a separate cost, so it
 * is not part of the reconciliation (see goods-reception-model).
 */

interface Supplier {
  id: string;
  name: string;
}

const num = (s: string): number | null => {
  const v = Number.parseFloat(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

export function SettleDrawer({
  reception,
  siteName,
  currency,
  onClose,
  onSettled,
}: {
  reception: ProjectedReception;
  siteName: string;
  currency: string;
  onClose: () => void;
  onSettled: (text: string) => void;
}) {
  const t = useTranslations("warehouse.desk.receive");
  const { data: sup } = useSWR<{ suppliers: Supplier[] }>(`/api/suppliers?market_id=${reception.market_id}`, jsonFetcher);
  const lines = useMemo(() => reception.lines.filter((l) => (l.received_qty ?? 0) > 0 || l.damaged_qty > 0), [reception]);

  const [supplierId, setSupplierId] = useState(reception.supplier_id ?? "");
  const [invoice, setInvoice] = useState(reception.invoice_total !== null ? String(reception.invoice_total) : "");
  const [ref, setRef] = useState(reception.supplier_ref ?? "");
  const [fees, setFees] = useState(reception.fees_total ? String(reception.fees_total) : "");
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.unit_cost !== null && l.unit_cost !== undefined ? String(l.unit_cost) : ""])),
  );
  const [claimed, setClaimed] = useState(false);
  const [choice, setChoice] = useState<"claim" | "accept" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceOf = (id: string) => num(prices[id] ?? "");
  const feesNum = num(fees) ?? 0;
  const goods = lines.reduce((s, l) => s + (l.received_qty ?? 0) * (priceOf(l.id) ?? 0), 0);
  const damagedValue = lines.reduce((s, l) => s + l.damaged_qty * (priceOf(l.id) ?? 0), 0);
  const damagedUnits = lines.reduce((s, l) => s + l.damaged_qty, 0);
  const units = lines.reduce((s, l) => s + (l.received_qty ?? 0), 0);
  const invoiceNum = invoice.trim() === "" ? null : num(invoice);
  const recon = reconcileInvoice({ invoice: invoiceNum, goods, damagedValue, damagedUnits });
  const allocation = useMemo(
    () =>
      allocateFees(
        lines.map((l) => ({ id: l.id, receivedQty: l.received_qty, unitCost: priceOf(l.id) })),
        feesNum,
        reception.fee_basis,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, prices, feesNum, reception.fee_basis],
  );
  const landedOf = (id: string) => allocation.allocations.find((a) => a.lineId === id)?.landedUnitCost ?? null;

  const allPriced = lines.every((l) => (l.received_qty ?? 0) === 0 || (priceOf(l.id) ?? -1) >= 0);
  const decided =
    recon.state === "none" || recon.state === "match" || (recon.state === "damaged" && claimed) || (recon.state === "unexplained" && choice !== null);
  const claimAmount = recon.state === "damaged" && claimed ? recon.gap : recon.state === "unexplained" && choice === "claim" && recon.gap > 0 ? recon.gap : 0;
  const due = (invoiceNum ?? goods) - claimAmount;
  const canSettle = !!supplierId && allPriced && decided && !busy && lines.length > 0;

  const call = async (url: string, init: RequestInit) => {
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? String(res.status));
    }
  };

  const settle = async () => {
    if (!canSettle) return;
    setBusy(true);
    setError(null);
    try {
      // 1 · The prices and the invoice number — the only things the office writes on the lines.
      await call(`/api/warehouse/receptions/${reception.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          supplier_ref: ref.trim() || null,
          lines: lines.map((l) => ({ id: l.id, unit_cost: priceOf(l.id) })),
        }),
      });
      // 2 · Transport: one figure on this screen. It replaces what was there.
      if (Math.abs(feesNum - (reception.fees_total ?? 0)) > 0.0005) {
        for (const c of reception.costs) {
          await call(`/api/warehouse/receptions/${reception.id}/costs?cost_id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
        }
        if (feesNum > 0) {
          await call(`/api/warehouse/receptions/${reception.id}/costs`, {
            method: "POST",
            body: JSON.stringify({ amount: feesNum, kind: "freight", label: null }),
          });
        }
      }
      // 3 · Settle against the invoice.
      await call(`/api/warehouse/receptions/${reception.id}/settle`, {
        method: "POST",
        body: JSON.stringify({
          supplier_id: supplierId,
          invoice_total: invoiceNum,
          due_at: null,
          discrepancy_reason:
            recon.state === "damaged" ? "damaged_billed" : recon.state === "unexplained" ? (choice === "claim" ? "claim" : "accepted") : null,
          claim_amount: claimAmount > 0 ? claimAmount : null,
        }),
      });
      onSettled(claimAmount > 0 ? t("settledClaim", { amount: fmoney(claimAmount), currency }) : t("settled"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settleFailed"));
    } finally {
      setBusy(false);
    }
  };

  const day = reception.arrival_date ?? reception.created_at.slice(0, 10);

  return (
    <Drawer
      onClose={onClose}
      wide
      label={t("settleTitle", { site: siteName, day })}
      head={<span className="hold j-rec"><Ic n="receipt" /></span>}
      title={t("settleTitle", { site: siteName, day })}
      sub={t("settleSub", { units: fnum(units), damaged: damagedUnits })}
      foot={
        <>
          <button type="button" className="btn2" onClick={onClose}>{t("later")}</button>
          <span className="grow" />
          <button type="button" className="btn" disabled={!canSettle} onClick={() => void settle()}>
            <Ic n="check" />
            {t("settleBtn", { amount: fmoney(due), currency })}
          </button>
        </>
      }
    >
      <Sec>
        <Eb icon="file">{t("invoice")}</Eb>
        <div className="g2">
          <div className="fld">
            <label htmlFor="ent-sup">{t("supplier")}</label>
            <select id="ent-sup" className="inp" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t("pickSupplier")}</option>
              {(sup?.suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="fld">
            <label htmlFor="ent-inv">{t("invoiceTotal", { currency })}</label>
            <input id="ent-inv" className="inp money" inputMode="decimal" value={invoice} placeholder={fmoney(goods)} onChange={(e) => setInvoice(e.target.value)} />
          </div>
        </div>
        <div className="g2">
          <div className="fld">
            <label htmlFor="ent-ref">{t("invoiceRef")}</label>
            <input id="ent-ref" className="inp" value={ref} placeholder={t("invoiceRefPh")} onChange={(e) => setRef(e.target.value)} />
          </div>
          <div className="fld">
            <label htmlFor="ent-fees">{t("fees", { currency })}</label>
            <input id="ent-fees" className="inp money" inputMode="decimal" value={fees} placeholder="0" onChange={(e) => setFees(e.target.value)} />
          </div>
        </div>
      </Sec>

      <Sec>
        <Eb icon="coins" aside={t("spread")}>{t("prices")}</Eb>
        <div className="cost hd">
          <span />
          <span>{t("colProduct")}</span>
          <span className="e">{t("colReceived")}</span>
          <span className="e">{t("colPrice")}</span>
          <span className="e">{t("colLanded")}</span>
        </div>
        {lines.map((l) => {
          const landed = landedOf(l.id);
          return (
            <div className="cost" key={l.id}>
              <Thumb seed={l.product_id} image={l.product_image_url} />
              <span>
                <b><bdi>{l.product_name}</bdi>{l.variant_label ? ` · ${l.variant_label}` : ""}</b>
                {l.damaged_qty ? (
                  <>
                    <br />
                    <small style={{ color: "var(--bad)", fontWeight: 700 }}>{t("plusDamaged", { n: l.damaged_qty })}</small>
                  </>
                ) : null}
              </span>
              <span className="e num"><b>{l.received_qty ?? 0}</b></span>
              <input
                className="inp money"
                inputMode="decimal"
                value={prices[l.id] ?? ""}
                placeholder={l.cogs_current ? fmoney(l.cogs_current) : "0,000"}
                aria-label={t("priceOf", { name: l.product_name })}
                onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))}
              />
              <span className="e num"><b>{landed !== null ? fmoney(landed) : "—"}</b></span>
            </div>
          );
        })}
        <div className="l2" style={{ whiteSpace: "normal" }}>{t("pricesFoot")}</div>
      </Sec>

      {recon.state === "none" ? (
        <div className="blind"><Ic n="info" />{t("reconNone")}</div>
      ) : recon.state === "match" ? (
        <div className="recon h-green" data-testid="recon">
          <div className="recon-h">
            <span className="hold"><Ic n="check" /></span>
            <div><b>{t("reconMatch")}</b><small>{t("reconMatchSub")}</small></div>
          </div>
        </div>
      ) : recon.state === "damaged" ? (
        <div className="recon h-amber" data-testid="recon">
          <div className="recon-h">
            <span className="hold"><Ic n="alert" /></span>
            <div>
              <b>{t("reconDamaged", { amount: fmoney(recon.gap), currency, n: damagedUnits })}</b>
              <small>{t("reconDamagedSub")}</small>
            </div>
          </div>
          <div className="eq">
            <div><span>{t("eqInvoice")}</span><b>{fmoney(invoiceNum ?? 0)}</b></div>
            <div><span>{t("eqGoods", { n: units })}</span><b>{fmoney(goods)}</b></div>
            <div className="tot"><span>{t("eqDamaged", { n: damagedUnits })}</span><b>{fmoney(recon.gap)} {currency}</b></div>
          </div>
          <label className="mi">
            <input type="checkbox" checked={claimed} onChange={(e) => setClaimed(e.target.checked)} />
            {t("claimBox", { amount: fmoney(recon.gap), currency })}
          </label>
        </div>
      ) : (
        <div className="recon h-red" data-testid="recon">
          <div className="recon-h">
            <span className="hold"><Ic n="alert" /></span>
            <div>
              <b>{t("reconUnexplained", { amount: fmoney(Math.abs(recon.gap)), currency })}</b>
              <small>{t("reconUnexplainedSub")}</small>
            </div>
          </div>
          <div className="causes" role="radiogroup" aria-label={t("reconDecide")}>
            {recon.gap > 0 ? (
              <button type="button" role="radio" aria-checked={choice === "claim"} className={`cz ${choice === "claim" ? "on" : ""}`} onClick={() => setChoice("claim")}>
                {t("choiceClaim", { amount: fmoney(recon.gap), currency })}
              </button>
            ) : null}
            <button type="button" role="radio" aria-checked={choice === "accept"} className={`cz ${choice === "accept" ? "on" : ""}`} onClick={() => setChoice("accept")}>
              {t("choiceAccept")}
            </button>
          </div>
        </div>
      )}
      {!supplierId ? <div className="l2" style={{ whiteSpace: "normal" }}>{t("needSupplier")}</div> : !allPriced ? <div className="l2">{t("needPrices")}</div> : null}
      {error ? <div className="err" role="alert">{error}</div> : null}
    </Drawer>
  );
}

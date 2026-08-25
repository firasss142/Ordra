"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { dateTimeShort, fmtNum, money, moneySigned } from "@/lib/investors/ui-format";
import { Btn, Callout, Card, Eq, Field, inputCls, Label, Tag, td, tdL, th, thL } from "./admin-shared";

type W = { id: string; investor_id: string; amount: string; currency: string; status: "requested" | "approved" | "rejected" | "paid"; note: string | null; admin_note: string | null; requested_at: string; decided_at: string | null; paid_at: string | null; payout_reference: string | null; investors: { legal_name: string | null } | null };

export function AdminWithdrawalsPanel({ locale }: { locale: string }) {
  const t = useTranslations("investorAdmin.withdrawals");
  const tc = useTranslations("investorAdmin.common");
  const [filter, setFilter] = useState<"" | W["status"]>("");
  const { data, mutate } = useSWR<{ data: W[]; balances: Record<string, { available: number; open_claims: number }> }>(`/api/admin/investments/withdrawals${filter ? `?status=${filter}` : ""}`, fetcher);
  const rows = data?.data ?? [];
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { if (!sel && rows.length) setSel(rows[0].id); }, [rows, sel]);
  const w = rows.find((x) => x.id === sel) ?? null;
  const [ref, setRef] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function decide(action: "approve" | "reject" | "paid") {
    if (!w) return; setBusy(true); setErr(null);
    const r = await fetch(`/api/admin/investments/withdrawals/${w.id}/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reference: ref || undefined, admin_note: note || undefined }) });
    setBusy(false);
    if (r.ok) { setRef(""); setNote(""); mutate(); } else { const j = await r.json().catch(() => ({})); setErr(j.code ?? j.error ?? tc("error")); }
  }
  const tone = (s: W["status"]) => ({ requested: "warn", approved: "info", paid: "ok", rejected: "bad" } as const)[s];
  const counts = { all: rows.length };
  const bal = w ? data?.balances?.[w.investor_id] : null;
  const otherOpen = bal && w ? Math.max(0, bal.open_claims - (w.status === "requested" || w.status === "approved" ? Number(w.amount) : 0)) : 0;
  const availForThis = bal ? bal.available - otherOpen : 0;
  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_420px]">
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-oms-border">
            {(["", "requested", "approved", "paid", "rejected"] as const).map((k) => <button key={k} type="button" onClick={() => { setFilter(k); setSel(null); }} className={`h-7 border-s border-oms-border px-2.5 text-[12px] font-semibold first:border-s-0 ${filter === k ? "bg-oms-sunken text-oms-ink-1" : "bg-oms-surface text-oms-ink-2"}`}>{k === "" ? `${t("all")}${filter === "" ? ` · ${counts.all}` : ""}` : t(k)}</button>)}
          </div>
          <span className="ms-auto text-[11.5px] text-oms-ink-3">{t("perCurrency")}</span>
        </div>
        <Card pad={false}>
          <table className="w-full border-collapse text-[12.5px]"><thead><tr><th className={thL}>{t("colInvestor")}</th><th className={th}>{t("colAmount")}</th><th className={thL}>{t("colStatus")}</th><th className={thL}>{t("colRequested")}</th><th className={thL}>{t("colApproved")}</th><th className={thL}>{t("colPaid")}</th></tr></thead>
            <tbody>{rows.length === 0 && <tr><td className={`${tdL} py-6 text-center text-oms-ink-3`} colSpan={6}>{t("empty")}</td></tr>}{rows.map((x) => (
              <tr key={x.id} onClick={() => setSel(x.id)} className={`cursor-pointer ${sel === x.id ? "bg-oms-sunken" : ""}`}><td className={tdL}><b>{x.investors?.legal_name ?? "—"}</b><span className="block text-[11px] text-oms-ink-3">{x.currency}</span></td><td className={td}><b>{fmtNum(Number(x.amount), 2)}</b></td><td className={tdL}><Tag tone={tone(x.status)}>{t(x.status)}</Tag></td><td className={tdL}>{dateTimeShort(x.requested_at, locale)}</td><td className={tdL}>{x.decided_at ? dateTimeShort(x.decided_at, locale) : "—"}</td><td className={tdL}>{x.paid_at ? `${dateTimeShort(x.paid_at, locale)} · ${x.payout_reference ?? ""}` : "—"}</td></tr>
            ))}</tbody></table>
        </Card>
      </div>
      {w && bal && (
        <Card>
          {w.status === "requested" || w.status === "approved" ? (
            <>
              <Label>{t("decision", { name: w.investors?.legal_name ?? "", amount: money(Number(w.amount), w.currency, locale, 2) })}</Label>
              <div className="mt-2.5"><Eq rows={[{ k: t("eqSettled") + " ± " + t("eqCorrections").replace("± ", "") + " " + t("eqWithdrawn"), v: moneySigned(bal.available, w.currency, locale, 2) }, { k: t("eqOtherOpen"), v: moneySigned(-otherOpen, w.currency, locale, 2) }, { k: t("eqAvailable"), v: <span className={availForThis >= Number(w.amount) ? "text-oms-ok" : "text-oms-age-late"}>{money(availForThis, w.currency, locale, 2)}</span>, tot: true }]} /></div>
              <div className="mt-2.5">{availForThis >= Number(w.amount) ? <Callout>{t("covered", { amount: fmtNum(Number(w.amount), 2), available: fmtNum(availForThis, 2) })}</Callout> : <Callout tone="bad">{t("notCovered", { amount: fmtNum(Number(w.amount), 2), available: fmtNum(availForThis, 2) })}</Callout>}</div>
              <div className="mt-3 grid grid-cols-1 gap-2.5"><Field label={t("reference")}><input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="VIR-…" /></Field><Field label={t("adminNote")}><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
              {err && <div className="mt-2"><Callout tone="bad">{err}</Callout></div>}
              <div className="mt-3 flex justify-end gap-2"><Btn variant="destructive" onClick={() => decide("reject")} disabled={busy}>{t("reject")}</Btn>{w.status === "requested" && <Btn onClick={() => decide("approve")} disabled={busy}>{t("approve")}</Btn>}<Btn variant="primary" onClick={() => decide("paid")} disabled={busy || w.status !== "approved" || !ref.trim()}>{t("markPaid")}</Btn></div>
            </>
          ) : (
            <>
              <Label>{t("cycle", { name: w.investors?.legal_name ?? "", amount: money(Number(w.amount), w.currency, locale, 2) })}</Label>
              <ol className="m-0 mt-3 list-none space-y-3 border-s-2 border-oms-border ps-4">
                <li><b className="block text-[12.5px] font-semibold">{t("requested")}</b><span className="text-[11.5px] text-oms-ink-3">{dateTimeShort(w.requested_at, locale)} · {t("requestedBy")}</span></li>
                {w.decided_at && <li><b className="block text-[12.5px] font-semibold">{w.status === "rejected" ? t("rejected") : t("approved")}</b><span className="text-[11.5px] text-oms-ink-3">{dateTimeShort(w.decided_at, locale)}{w.admin_note ? ` · ${w.admin_note}` : ""}</span></li>}
                {w.paid_at && <li><b className="block text-[12.5px] font-semibold text-oms-ok">{t("paid")}</b><span className="text-[11.5px] text-oms-ink-3">{dateTimeShort(w.paid_at, locale)} · {t("paidLine", { ref: w.payout_reference ?? "", amount: fmtNum(Number(w.amount), 2) })}</span></li>}
              </ol>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

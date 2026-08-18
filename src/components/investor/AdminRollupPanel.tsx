"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { dateTimeShort, fmtNum, minutesSince } from "@/lib/investors/ui-format";
import { Btn, Callout, Card, Label, Tag, td, tdL, th, thL } from "./admin-shared";

type Run = { id: string; trigger: string; mode: string; status: string; started_at: string; finished_at: string | null; orders_scanned: number; facts_changed: number; days_written: number; deals_snapshotted: number; excluded_dexpress: number; error: string | null };
type Cov = { product_id: string; product_name: string | null; image_url: string | null; facts_as_of: string | null; received: number; outcomes: number; final_outcomes: number; pending_billing: number; in_flight: number; excluded_dexpress: number };
type Status = { last_success_at: string | null; runs: Run[]; cron: { jobname: string; schedule: string; active: boolean }[]; coverage: Cov[] };

export function AdminRollupPanel({ locale }: { locale: string }) {
  const t = useTranslations("investorAdmin.rollup");
  const tc = useTranslations("investorAdmin.common");
  const { data, mutate } = useSWR<{ data: Status }>("/api/admin/investments/rollup/status", fetcher, { refreshInterval: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const s = data?.data;
  const last = s?.runs?.[0];
  const min = minutesSince(s?.last_success_at ?? null);
  const cron15 = s?.cron?.find((c) => c.jobname === "investor-rollup-15min");
  const nightly = s?.cron?.find((c) => c.jobname === "investor-rollup-nightly");
  async function run(mode: "incremental" | "full", productId?: string) {
    setBusy(productId ?? mode); setMsg(null);
    const r = await fetch("/api/admin/investments/rollup/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, product_id: productId }) });
    setBusy(null);
    if (r.status === 409) setMsg(t("locked")); else if (!r.ok) setMsg(tc("error"));
    mutate();
  }
  const dur = (r: Run) => (r.finished_at ? `${((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000).toFixed(1)} s` : "—");
  const stTag = (st: string) => <Tag tone={st === "succeeded" ? "ok" : st === "partial" ? "warn" : st === "failed" ? "bad" : "neutral"}>{t(st as "succeeded")}</Tag>;
  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <div className="flex flex-wrap items-center gap-4 text-[12.5px]">
          <span className="flex items-center gap-1.5 font-semibold"><span className={`inline-block h-2 w-2 rounded-full ${min !== null && min <= 60 ? "bg-[#16A34A]" : "bg-oms-age-late"}`} />{t("last", { when: last?.finished_at ? dateTimeShort(last.finished_at, locale) : t("never"), status: last ? t(last.status as "succeeded") : "—" })}</span>
          <span className="h-4 w-px bg-oms-border" />
          {last && <><span><span className="text-oms-ink-3">{t("mode")}</span> {t(last.mode as "incremental")}</span><span><span className="text-oms-ink-3">{t("duration")}</span> {dur(last)}</span><span><span className="text-oms-ink-3">{t("scanned")}</span> {last.orders_scanned}</span><span><span className="text-oms-ink-3">{t("changed")}</span> {last.facts_changed}</span><span><span className="text-oms-ink-3">{t("snapshots")}</span> {last.deals_snapshotted}</span></>}
          <span className="h-4 w-px bg-oms-border" />
          <span><span className="text-oms-ink-3">{t("cron")}</span> {cron15 ? <Tag tone={cron15.active ? "ok" : "bad"}>{cron15.schedule}</Tag> : <Tag tone="bad">{tc("cronMissing")}</Tag>}</span>
          <span><span className="text-oms-ink-3">{t("nightly")}</span> {nightly ? <Tag tone={nightly.active ? "ok" : "bad"}>{nightly.schedule}</Tag> : <Tag tone="bad">{tc("cronMissing")}</Tag>}</span>
          <span className="ms-auto flex gap-2"><Btn onClick={() => run("incremental")} disabled={busy !== null}>{busy === "incremental" ? t("running") : t("runIncremental")}</Btn></span>
        </div>
      </Card>
      {msg && <Callout tone="warn">{msg}</Callout>}
      <Callout>{t("warn")}</Callout>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        {(s?.coverage ?? []).map((c) => (
          <Card key={c.product_id}>
            <div className="mb-2.5 flex items-center gap-2.5">{c.image_url && <img src={c.image_url} alt="" className="h-9 w-9 rounded-lg border border-oms-border object-cover" />}<div><div className="text-[13px] font-semibold">{c.product_name}</div><div className="text-[11px] text-oms-ink-3">{t("factsAsOf", { when: c.facts_as_of ? dateTimeShort(c.facts_as_of, locale) : "—", n: fmtNum(c.received + c.excluded_dexpress) })}</div></div></div>
            <ul className="m-0 list-none space-y-1.5 p-0 text-[12px]">
              <li className="flex items-center gap-2"><span className="text-oms-ink-2">{t("billed")}</span><span className="h-1.5 max-w-[120px] flex-1 overflow-hidden rounded bg-oms-sunken"><i className="block h-full bg-[#16A34A]" style={{ width: `${c.outcomes ? (c.final_outcomes / c.outcomes) * 100 : 0}%` }} /></span><b className="ms-auto tabular-nums">{c.final_outcomes}/{c.outcomes}</b></li>
              <li className="flex items-center gap-2"><span className="text-oms-ink-2">{t("pending")}</span><b className="ms-auto tabular-nums">{c.pending_billing}</b></li>
              <li className="flex items-center gap-2"><span className="text-oms-ink-2">{t("inFlight")}</span><b className="ms-auto tabular-nums">{c.in_flight}</b></li>
              <li className="flex items-center gap-2"><span className="text-oms-ink-2">{t("dexpress")}</span><b className={`ms-auto tabular-nums ${c.excluded_dexpress ? "text-oms-age-late" : ""}`}>{c.excluded_dexpress}</b></li>
            </ul>
            <div className="mt-2.5 flex justify-end"><Btn onClick={() => run("full", c.product_id)} disabled={busy !== null}>{busy === c.product_id ? t("running") : t("runFull")}</Btn></div>
          </Card>
        ))}
      </div>
      <Card pad={false}>
        <div className="px-3.5 pb-1 pt-3"><Label>{t("history")}</Label></div>
        <table className="w-full border-collapse text-[12.5px]"><thead><tr><th className={thL}>{t("colTime")}</th><th className={thL}>{t("colMode")}</th><th className={thL}>{t("colState")}</th><th className={th}>{t("colDuration")}</th><th className={th}>{t("colScanned")}</th><th className={th}>{t("colChanged")}</th><th className={th}>{t("colDays")}</th><th className={th}>{t("colSnaps")}</th></tr></thead>
          <tbody>{(s?.runs ?? []).length === 0 && <tr><td className={`${tdL} py-6 text-center text-oms-ink-3`} colSpan={8}>{t("noRuns")}</td></tr>}{(s?.runs ?? []).map((r) => <tr key={r.id}><td className={tdL}>{dateTimeShort(r.started_at, locale)}<span className="block text-[11px] text-oms-ink-3">{r.trigger}</span></td><td className={tdL}>{t(r.mode as "incremental")}</td><td className={tdL}>{stTag(r.status)}{r.error && <span className="block max-w-[320px] truncate text-[11px] text-oms-ink-3">{r.error}</span>}</td><td className={td}>{dur(r)}</td><td className={td}>{r.orders_scanned}</td><td className={td}>{r.facts_changed}</td><td className={td}>{r.days_written}</td><td className={td}>{r.deals_snapshotted}</td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}

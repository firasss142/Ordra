"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { CommissionRateRow, CommissionSettings } from "@/lib/commissions/types";
import { fmtCommission } from "@/lib/commissions/view-models";
import { inputClass } from "./SectionShell";

interface Props {
  marketId: string;
  marketName: string;
  tz: string;
  locale: string;
}

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function Switch({ on, label, onToggle, disabled }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-5 w-9 shrink-0 rounded-pill border-0 p-0 transition-colors duration-fast disabled:opacity-60 ${on ? "bg-brand" : "bg-[#C9CDD1]"}`}
    >
      <span className={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[inset-inline-start] duration-fast ${on ? "start-[18px]" : "start-[2px]"}`} />
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 border-b border-line-subtle py-4 last:border-b-0 md:grid-cols-[260px_1fr] md:gap-4">
      <div>
        <div className="text-[13.5px] font-medium text-ink-primary">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-ink-secondary">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Paramètres › Général › Commissions (super_admin). One RPC read
 * (`get_commission_settings`), one write path (`POST /api/settings/commissions`)
 * for the market rate, the market switch, per-agent overrides and per-agent
 * switches — every write is a new effective-dated row, never an edit.
 */
export function CommissionsSection({ marketId, marketName, tz, locale }: Props) {
  const t = useTranslations("settings.commissions");
  const [data, setData] = useState<CommissionSettings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [enabled, setEnabled] = useState(true);
  const [from, setFrom] = useState(() => todayIn(tz));
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [override, setOverride] = useState<{ agentId: string; name: string; amount: string; from: string; note: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/settings/commissions?market_id=${encodeURIComponent(marketId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { data: CommissionSettings };
      setData(body.data);
      setLoadError(false);
      if (body.data.market) {
        setAmount(String(body.data.market.amount));
        setEnabled(body.data.market.enabled);
      }
    } catch {
      setLoadError(true);
    }
  }, [marketId]);

  useEffect(() => { void load(); }, [load]);

  const currency = data?.currency ?? "";
  const marketCode = marketId.endsWith("2") ? "LY" : "TN";

  async function post(body: Record<string, unknown>, key: string): Promise<boolean> {
    setSaving(key);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMsg({ ok: true, text: t("saved") });
      await load();
      return true;
    } catch {
      setMsg({ ok: false, text: t("failed") });
      return false;
    } finally {
      setSaving(null);
      setTimeout(() => setMsg(null), 3000);
    }
  }

  function saveMarket() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return;
    void post({ market_id: marketId, agent_id: null, amount: n, enabled, effective_from: from }, "market");
  }

  function toggleAgent(agentId: string, current: CommissionRateRow | null) {
    const nextEnabled = current ? !current.enabled : false;
    // Keep the agent's own amount if they had one; a plain "off" keeps 0 and
    // a re-enable without an own rate goes back to following the market.
    if (nextEnabled && current && current.amount === 0) {
      // re-enable → drop the override entirely by closing it with a market-following row is not
      // expressible; instead re-enable at the market amount so the agent follows the market again.
      const marketAmount = data?.market?.amount ?? 0;
      void post({ market_id: marketId, agent_id: agentId, amount: marketAmount, enabled: true, effective_from: todayIn(tz), note: null }, agentId);
      return;
    }
    void post({ market_id: marketId, agent_id: agentId, amount: current?.amount ?? 0, enabled: nextEnabled, effective_from: todayIn(tz) }, agentId);
  }

  const fmtDate = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date(`${d}T12:00:00Z`));
  const history = useMemo(() => data?.history ?? [], [data]);

  return (
    <Card className="overflow-visible">
      <CardHeader className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="m-0 text-[16px] font-semibold text-ink-primary">{t("title")}</h2>
          <p className="mt-1 m-0 text-[13px] text-ink-secondary">{t("description")}</p>
        </div>
      </CardHeader>
      <CardBody>
        {loadError && <p className="text-[13px] text-status-critical">{t("loadError")}</p>}
        {!data && !loadError && <p className="text-[13px] text-ink-secondary">{t("loading")}</p>}
        {data && (
          <>
            {!data.market && (
              <p className="mb-2 rounded-md border border-[#F0D48A] bg-status-warningBg px-3 py-2 text-[12.5px] text-hue-amber-ink">{t("noRate")}</p>
            )}
            <Field label={t("enabledLabel")} hint={t("enabledHint")}>
              <label className="inline-flex items-center gap-2.5 text-[13.5px] text-ink-primary">
                <Switch on={enabled} label={t("enabledLabel")} onToggle={() => setEnabled((v) => !v)} />
                {enabled ? t("enabledFor", { market: marketName }) : t("disabledFor", { market: marketName })}
              </label>
            </Field>
            <Field label={t("rateLabel", { currency })} hint={t("rateHint")}>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="number" step="0.5" min="0" inputMode="decimal"
                  aria-label={t("rateLabel", { currency })}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={`${inputClass} w-40 tabular-nums`}
                />
                {data.market && (
                  <span className="rounded-pill border border-line-subtle bg-surface-sunken px-2.5 py-[2px] text-[12px] text-ink-secondary">
                    {fmtDate(data.market.effective_from)}{data.market.set_by_name ? ` · ${data.market.set_by_name}` : ""}
                  </span>
                )}
              </div>
            </Field>
            <Field label={t("fromLabel")} hint={t("fromHint")}>
              <div className="flex flex-wrap items-center gap-3">
                <input type="date" aria-label={t("fromLabel")} value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} w-44`} />
                <span className="text-[12.5px] text-ink-secondary">{t("fromToday")}</span>
              </div>
            </Field>

            <Field label={t("perAgentLabel")} hint={t("perAgentHint")}>
              <div className="overflow-x-auto rounded-md border border-line-subtle">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-line-subtle text-[12px] text-ink-secondary">
                      <th className="px-3 py-2 text-start font-medium">{t("colAgent")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("colCommission")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("colRate")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("colSince")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("colNote")}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.agents.map((a) => {
                      const o = a.override;
                      const on = o ? o.enabled : true;
                      const off = !on;
                      return (
                        <tr key={a.agent_id} className={`border-b border-line-subtle last:border-b-0 ${off ? "text-ink-muted" : ""}`}>
                          <td className="px-3 py-2.5 font-semibold text-ink-primary">
                            {a.name}{!a.is_active && <span className="ms-2 text-[11.5px] font-normal text-ink-muted">{t("inactive")}</span>}
                          </td>
                          <td className="px-3 py-2.5"><Switch on={on} label={`${t("colCommission")} ${a.name}`} onToggle={() => toggleAgent(a.agent_id, o)} disabled={saving === a.agent_id} /></td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {off ? (
                              <span className="rounded-pill border border-line bg-surface-sunken px-2 py-[1px] text-[11.5px] text-ink-secondary">{t("off")}</span>
                            ) : o ? (
                              <><b>{fmtCommission(o.amount, marketCode)}</b> <span className="ms-1.5 rounded-pill border border-line bg-surface-sunken px-2 py-[1px] text-[11.5px] text-ink-secondary">{t("ownRate")}</span></>
                            ) : (
                              <>{data.market ? fmtCommission(data.market.amount, marketCode) : "—"} <span className="text-ink-secondary">· {t("marketRate")}</span></>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-ink-secondary">{o ? fmtDate(o.effective_from) : data.market ? fmtDate(data.market.effective_from) : "—"}</td>
                          <td className="px-3 py-2.5 text-ink-secondary" dir="auto">{o?.note ?? "—"}</td>
                          <td className="px-3 py-2.5 text-end">
                            <button
                              type="button"
                              onClick={() => setOverride({ agentId: a.agent_id, name: a.name, amount: o ? String(o.amount) : String(data.market?.amount ?? ""), from: todayIn(tz), note: "" })}
                              className="rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
                            >
                              {o && on ? t("edit") : t("setOwnRate")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[12px] text-ink-secondary">{t("perAgentNote")}</p>
            </Field>

            <Field label={t("historyLabel")} hint={t("historyHint")}>
              {history.length === 0 && <p className="text-[12.5px] text-ink-secondary">{t("historyEmpty")}</p>}
              <ul className="m-0 list-none p-0 text-[13px]">
                {history.slice(0, 20).map((h) => (
                  <li key={h.id} className="border-b border-line-subtle py-2 last:border-b-0">
                    {fmtDate(h.effective_from)} — <b>{h.agent_name ?? t("historyMarket")}</b>{" "}
                    {h.enabled ? (h.agent_id ? t("historyRate", { amount: fmtCommission(h.amount, marketCode) }) : t("historyEnabled", { amount: fmtCommission(h.amount, marketCode) })) : t("historyDisabled")}
                    <span className="block text-[12px] text-ink-secondary">{h.note ? `« ${h.note} » · ` : ""}{h.set_by_name ?? ""}</span>
                  </li>
                ))}
              </ul>
            </Field>
          </>
        )}
      </CardBody>
      <div className="flex items-center justify-end gap-3 border-t border-line-subtle px-5 py-3">
        <span className="me-auto text-[12px] text-ink-muted">{t("visibleTo")}</span>
        {msg && <span className={`text-[13px] ${msg.ok ? "text-status-success" : "text-status-critical"}`}>{msg.text}</span>}
        <button
          type="button"
          disabled={saving !== null || !data}
          onClick={saveMarket}
          className="rounded-md bg-brand px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {saving === "market" ? t("saving") : t("save")}
        </button>
      </div>

      {override && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(26,26,26,0.5)]" onClick={() => setOverride(null)}>
          <div role="dialog" aria-modal="true" className="w-[420px] max-w-[92vw] rounded-lg bg-surface-card p-5 shadow-floating" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-ink-primary" dir="auto">{t("overrideTitle", { name: override.name })}</h3>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12.5px] font-medium">{t("overrideAmount", { currency })}
                <input type="number" step="0.5" min="0" value={override.amount} onChange={(e) => setOverride({ ...override, amount: e.target.value })} className={`${inputClass} w-full tabular-nums`} />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] font-medium">{t("overrideFrom")}
                <input type="date" value={override.from} onChange={(e) => setOverride({ ...override, from: e.target.value })} className={`${inputClass} w-full`} />
              </label>
            </div>
            <label className="mt-3 flex flex-col gap-1 text-[12.5px] font-medium">{t("overrideNote")}
              <input value={override.note} onChange={(e) => setOverride({ ...override, note: e.target.value })} className={`${inputClass} w-full`} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOverride(null)} className="rounded-md px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-surface-hover">{t("cancel")}</button>
              <button
                type="button"
                disabled={saving !== null}
                onClick={async () => {
                  const n = Number(override.amount);
                  if (!Number.isFinite(n) || n < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(override.from)) return;
                  const ok = await post({ market_id: marketId, agent_id: override.agentId, amount: n, enabled: true, effective_from: override.from, note: override.note || null }, override.agentId);
                  if (ok) setOverride(null);
                }}
                className="rounded-md bg-brand px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-brand-hover disabled:opacity-60"
              >
                {t("apply")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

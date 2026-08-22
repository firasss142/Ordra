"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  Undo2, PackageCheck, TrendingDown, Trash2, Bell, ScanLine,
  RotateCcw, Send, Lock,
} from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { ReturnsStats } from "@/app/api/warehouse/returns/stats/route";
import { RETURN_REASONS, type ReturnReason } from "@/lib/warehouse/returns-validation";
import { WhCard, WhChip, WhKpiCard, WhKpiGrid } from "./primitives";
import { WH_BTN, WH_BTN_PRIMARY, WH_BTN_SM, WH_LABEL, WH_TONE } from "./tokens";

/**
 * Retours — "which parcels came back, and what happens to each one?"
 *
 * Follows docs/design/entrepot/entrepot-light.html §Retours. One deliberate
 * departure: the prototype's "Répartition par raison" strip is absent. Nothing
 * records WHY a delivery failed — every to_be_returned order carries a null
 * carrier status — so the strip would have been four chips of nothing.
 *
 * The three decisions are not variations of one action:
 *   · restock  → scan_return_in, stock +qty
 *   · damaged  → scan_return_in with a cause, damaged_return_count +qty
 *   · redeliver→ scan_received_in, stock UNTOUCHED — the parcel goes back out,
 *                so crediting the shelf would invent a unit.
 */

type Decision = "restock" | "damage" | "redeliver";

const fetcher = (u: string) => fetch(u).then((r) => {
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
});

const REASON_KEY: Record<ReturnReason, string> = {
  packaging: "reasonPackaging",
  product_defect: "reasonProductDefect",
  customer_damage: "reasonCustomerDamage",
  carrier_damage: "reasonCarrierDamage",
  other: "reasonOther",
};

function dec(n: number, digits = 1): string {
  return n.toFixed(digits).replace(".", ",");
}

/** 21 stays "21"; 12,4 keeps its decimal. A trailing ",0" is noise. */
function pct(n: number): string {
  return Number.isInteger(n) ? String(n) : dec(n);
}

function money(n: number, currency: string): string {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/** The four-point weekly curve in the rate card. */
function Sparkline({ points }: { points: Array<{ week: number; rate: number | null }> }) {
  const usable = points.filter((p) => p.rate !== null) as Array<{ week: number; rate: number }>;
  if (usable.length < 2) return null;

  const max = Math.max(...usable.map((p) => p.rate), 1);
  const x = (i: number) => 10 + (i * 200) / (points.length - 1);
  const y = (v: number) => 34 - (v / max) * 24;

  return (
    <svg
      data-testid="wh-spark"
      viewBox="0 0 220 44"
      width="100%"
      height="44"
      className="mt-2 block"
      aria-hidden="true"
    >
      <polyline
        points={points.map((p, i) => `${x(i)},${y(p.rate ?? 0)}`).join(" ")}
        fill="none"
        stroke="var(--wh-bad)"
        strokeWidth="2"
      />
      {points.map((p, i) => (
        <circle
          key={p.week}
          cx={x(i)}
          cy={y(p.rate ?? 0)}
          r={i === points.length - 1 ? 3 : 2.5}
          fill="var(--wh-bad)"
        />
      ))}
      {points.map((p, i) => (
        <text key={`l${p.week}`} x={x(i) - 8} y={42} fontSize="9" fill="var(--wh-ink-3)">
          S-{p.week}
        </text>
      ))}
    </svg>
  );
}

/* ── The screen ───────────────────────────────────────────────────────── */

export function ReturnsConsole({ marketId }: { marketId: string | null }) {
  const t = useTranslations("warehouse.returns2");

  const { data: stats } = useSWR<ReturnsStats>("/api/warehouse/returns/stats", fetcher, {
    revalidateOnFocus: true,
  });
  const { data: page, mutate } = useSWR<{ orders: WarehouseOrderRow[]; nextCursor: string | null }>(
    `/api/warehouse/returns?limit=100${marketId ? `&market_id=${marketId}` : ""}`,
    fetcher,
    { revalidateOnFocus: true },
  );

  const orders = useMemo(
    () => [...(page?.orders ?? [])].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
    [page],
  );

  const [picked, setPicked] = useState<WarehouseOrderRow | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [scan, setScan] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const currency = stats?.currency ?? "TND";

  const take = useCallback((o: WarehouseOrderRow) => {
    setPicked(o);
    setDecision(null);
    setReason(null);
    setNote("");
    setFlash(null);
  }, []);

  const submitScan = useCallback(() => {
    const code = scan.trim().toLowerCase();
    setScan("");
    if (!code) return;
    const hit = orders.find((o) => o.id.toLowerCase().startsWith(code) || o.id.toLowerCase().endsWith(code));
    if (hit) take(hit);
    else setFlash({ ok: false, text: t("notInQueue") });
  }, [scan, orders, take, t]);

  // Damage is a financial act: it writes off units. It never lands without a
  // stated cause, and "other" never lands without a note.
  const canValidate =
    picked !== null &&
    decision !== null &&
    (decision !== "damage" || (reason !== null && (reason !== "other" || note.trim().length > 0)));

  const validate = useCallback(async () => {
    if (!picked || !decision || busy) return;
    setBusy(true);
    try {
      const res =
        decision === "redeliver"
          ? await fetch("/api/warehouse/scan-received", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order_id: picked.id }),
            })
          : await fetch("/api/warehouse/scan-return", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                order_id: picked.id,
                is_damaged: decision === "damage",
                return_reason: decision === "damage" ? reason : null,
                return_reason_note: decision === "damage" && reason === "other" ? note.trim() : null,
                return_photo_url: null,
              }),
            });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setFlash({ ok: false, text: body.error ?? t("failed") });
        return;
      }
      setFlash({ ok: true, text: t("saved") });
      setPicked(null);
      setDecision(null);
      setReason(null);
      setNote("");
      void mutate();
    } finally {
      setBusy(false);
    }
  }, [picked, decision, reason, note, busy, mutate, t]);

  const step = picked ? (decision ? 3 : 2) : 1;

  const rateDelta =
    stats?.rate28d !== null && stats?.rate28d !== undefined &&
    stats?.ratePrev28d !== null && stats?.ratePrev28d !== undefined
      ? stats.rate28d - stats.ratePrev28d
      : null;

  return (
    <div className="mx-auto w-full max-w-[1460px] px-6 py-6">
      <header className="mb-5">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-wh-ink-1">{t("title")}</h1>
        <p className="mt-[5px] text-[13px] text-wh-ink-2">{t("subtitle")}</p>
      </header>

      <div className="mb-[18px]">
        <WhKpiGrid min={250}>
          <WhKpiCard
            id="queue"
            label={t("kpiQueue")}
            icon={Undo2}
            tone={stats && stats.queueCount > 0 ? "warn" : "muted"}
            edge={stats && stats.queueCount > 0 ? "warn" : undefined}
            valueTone="warn"
            dim={!stats || stats.queueCount === 0}
            value={stats?.queueCount ?? 0}
            note={
              stats && stats.queueCount > 0
                ? t("kpiQueueOldest", { age: t("days", { count: stats.oldestDays }) })
                : t("kpiQueueEmpty")
            }
            foot={[{ value: money(stats?.queueValue ?? 0, currency), label: t("kpiQueueValue") }]}
          />

          <WhKpiCard
            id="done"
            label={t("kpiDone")}
            icon={PackageCheck}
            tone={stats && stats.doneToday > 0 ? "ok" : "muted"}
            edge={stats && stats.doneToday > 0 ? "ok" : undefined}
            valueTone="ok"
            dim={!stats || stats.doneToday === 0}
            value={stats?.doneToday ?? 0}
            note={t("kpiDoneDetail", {
              restocked: stats?.restockedToday ?? 0,
              damaged: stats?.depreciatedToday ?? 0,
            })}
            foot={[{ value: money(stats?.doneTodayValue ?? 0, currency), label: t("kpiDoneValue") }]}
          />

          <WhKpiCard
            id="rate"
            label={t("kpiRate")}
            icon={TrendingDown}
            tone="bad"
            value={stats?.rate28d === null || stats?.rate28d === undefined ? "—" : pct(stats.rate28d)}
            unit={stats?.rate28d === null || stats?.rate28d === undefined ? undefined : "%"}
            chip={
              rateDelta !== null && Math.abs(rateDelta) >= 0.05 ? (
                <WhChip tone={rateDelta > 0 ? "bad" : "ok"}>
                  {rateDelta > 0 ? "▲" : "▼"}{" "}
                  {t("kpiRateDelta", { delta: `${rateDelta > 0 ? "+" : "−"}${dec(Math.abs(rateDelta))}` })}
                </WhChip>
              ) : undefined
            }
            note={
              stats?.rate28d === null || stats?.rate28d === undefined
                ? t("kpiRateNone")
                : t("kpiRateNote")
            }
          >
            <Sparkline points={stats?.weekly ?? []} />
          </WhKpiCard>

          <WhKpiCard
            id="depreciated"
            label={t("kpiDepreciated")}
            icon={Trash2}
            tone={stats && stats.depreciatedUnits > 0 ? "bad" : "muted"}
            edge={stats && stats.depreciatedUnits > 0 ? "bad" : undefined}
            dim={!stats || stats.depreciatedUnits === 0}
            value={stats?.depreciatedUnits ?? 0}
            unit="u"
            note={
              stats && stats.depreciatedUnits > 0 ? undefined : t("kpiDepreciatedNone")
            }
            foot={[
              { value: money(stats?.depreciatedValue ?? 0, currency), label: t("kpiDepreciatedValue") },
            ]}
          />
        </WhKpiGrid>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(380px,1fr)]">
        {/* ── The queue ─────────────────────────────────────────────── */}
        <WhCard title={t("queueTitle")} hint={t("queueSort")} className="min-w-0">
          {orders.length === 0 ? (
            <p data-testid="wh-returns-empty" className="px-4 py-8 text-center text-[13px] text-wh-ink-3">
              {t("queueEmpty")}
            </p>
          ) : (
            <div className="max-h-[640px] divide-y divide-wh-border overflow-y-auto">
              {orders.map((o) => {
                const age = daysSince(o.created_at);
                const tone = age >= 10 ? "bad" : age >= 5 ? "warn" : "muted";
                return (
                  <div
                    key={o.id}
                    data-testid={`wh-return-${o.id}`}
                    className={`flex items-center gap-3.5 px-[18px] py-[13px] transition-colors hover:bg-wh-sunken ${
                      picked?.id === o.id ? "bg-wh-ok-tint" : ""
                    }`}
                  >
                    {/* Ten days on the shelf is money standing still. */}
                    <Bell
                      size={16}
                      className={`shrink-0 text-wh-bad ${age >= 10 ? "" : "invisible"}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-[1.2]">
                      <b className="block truncate text-[13.5px] font-semibold text-wh-ink-1">
                        <bdi>{o.customer_name}</bdi>
                      </b>
                      <span className="block truncate font-mono text-[11.5px] tabular-nums text-wh-ink-3">
                        {o.id.slice(0, 8).toUpperCase()} · <bdi>{o.customer_city ?? "—"}</bdi>
                      </span>
                    </span>
                    <span className="hidden min-w-0 flex-[1.1] truncate text-[12.5px] text-wh-ink-2 sm:block">
                      {o.product_name}
                      {o.variant_label ? ` · ${o.variant_label}` : ""} × {o.quantity}
                    </span>
                    <span className="w-[92px] shrink-0 text-end font-mono text-[13px] font-semibold tabular-nums text-wh-ink-1">
                      {money(o.total_price, currency)}
                    </span>
                    <span
                      className={`inline-block min-w-[46px] shrink-0 rounded-pill px-2.5 py-1 text-center font-mono text-[11.5px] font-semibold tabular-nums ${WH_TONE[tone].tint}`}
                    >
                      {t("days", { count: age })}
                    </span>
                    <button
                      type="button"
                      data-testid={`wh-take-${o.id}`}
                      onClick={() => take(o)}
                      className={`${WH_BTN} ${WH_BTN_SM} shrink-0`}
                    >
                      {t("process")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </WhCard>

        {/* ── The decision panel ────────────────────────────────────── */}
        <WhCard
          title={t("decision")}
          hint={picked ? t("decisionPicked", { ref: picked.id.slice(0, 8).toUpperCase() }) : t("decisionNone")}
          className="xl:sticky xl:top-[70px]"
        >
          <div className="mx-4 mt-4 flex items-center gap-2.5 rounded-[12px] border-2 border-wh-ok bg-wh-surface px-4 py-3.5 shadow-wh-glow">
            <ScanLine size={18} className="shrink-0 text-wh-ok" aria-hidden="true" />
            <input
              ref={scanRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitScan();
              }}
              placeholder={t("scanPlaceholder")}
              autoComplete="off"
              aria-label={t("scanPlaceholder")}
              className="w-full border-none bg-transparent font-mono text-[16px] font-semibold tracking-wide outline-none placeholder:font-sans placeholder:text-[13.5px] placeholder:font-medium placeholder:tracking-normal placeholder:text-wh-ink-3"
            />
          </div>

          {/* Where the operator is in the three-step motion. */}
          <div className="mx-4 mt-4 flex items-center gap-2 text-[12px] text-wh-ink-3">
            {[t("step1"), t("step2"), t("step3")].map((label, i) => (
              <div key={label} className="flex flex-1 items-center gap-2 last:flex-none">
                <span
                  data-testid={`wh-step-${i + 1}`}
                  data-on={step > i ? "true" : "false"}
                  className={`flex flex-col items-center gap-1.5 ${
                    step > i ? "font-semibold text-wh-ok" : ""
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-pill border-[1.5px] font-mono text-[11px] font-semibold ${
                      step > i ? "border-wh-ok bg-wh-ok-bg text-wh-ok" : "border-wh-border-strong"
                    }`}
                  >
                    {i + 1}
                  </span>
                  {label}
                </span>
                {i < 2 ? <span className="-mt-4 flex-1 border-t-[1.5px] border-dashed border-wh-border-strong" /> : null}
              </div>
            ))}
          </div>

          {picked ? (
            <div className="mx-4 mt-4 rounded-[11px] border border-wh-border bg-wh-sunken px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13.5px] font-semibold text-wh-ink-1">
                    <bdi>{picked.customer_name}</bdi>
                  </b>
                  <span className="block truncate text-[11.5px] text-wh-ink-3">
                    <span className="font-mono tabular-nums">{picked.id.slice(0, 8).toUpperCase()}</span>
                    {" · "}
                    <bdi>{picked.customer_city ?? "—"}</bdi> · {picked.product_name}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-wh-ink-1">
                  {money(picked.total_price, currency)}
                </span>
              </div>
            </div>
          ) : null}

          <div className={`mx-4 mb-1.5 mt-4 ${WH_LABEL}`}>
            {picked ? t("chooseLabel") : t("previewLabel")}
          </div>

          <div className="mx-4 grid grid-cols-3 gap-2.5">
            {(
              [
                { key: "restock", icon: RotateCcw, tone: "ok", label: t("restock"), hint: t("restockHint") },
                { key: "damage", icon: Trash2, tone: "bad", label: t("damage"), hint: t("damageHint") },
                { key: "redeliver", icon: Send, tone: "move", label: t("redeliver"), hint: t("redeliverHint") },
              ] as const
            ).map((d) => {
              const Icon = d.icon;
              const on = decision === d.key;
              return (
                <button
                  key={d.key}
                  type="button"
                  data-testid={`wh-tile-${d.key}`}
                  disabled={!picked}
                  onClick={() => {
                    setDecision(d.key);
                    if (d.key !== "damage") setReason(null);
                  }}
                  className={`rounded-[11px] border-[1.5px] px-3 py-4 text-center transition-[opacity,transform,box-shadow] ${
                    picked ? "cursor-pointer opacity-100 hover:-translate-y-0.5 hover:shadow-md" : "opacity-55"
                  } ${
                    d.tone === "ok"
                      ? "border-wh-ok-edge text-wh-ok"
                      : d.tone === "bad"
                        ? "border-wh-bad-edge text-wh-bad"
                        : "border-wh-move-edge text-wh-move"
                  } ${on ? WH_TONE[d.tone].tint : "bg-wh-surface"}`}
                >
                  <Icon size={18} className="mx-auto" aria-hidden="true" />
                  <b className="mt-2 block text-[12.5px]">{d.label}</b>
                  <span className="mt-1 block text-[11px] leading-[1.35] text-wh-ink-2">{d.hint}</span>
                </button>
              );
            })}
          </div>

          {decision === "damage" ? (
            <div data-testid="wh-damage-reasons" className="mx-4 mt-3.5">
              <div className={WH_LABEL}>{t("damageReason")}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {RETURN_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    data-testid={`wh-reason-${r}`}
                    onClick={() => setReason(r)}
                    className={`rounded-pill border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                      reason === r
                        ? "border-wh-bad-edge bg-wh-bad-bg text-wh-bad"
                        : "border-wh-border bg-wh-surface text-wh-ink-2 hover:border-wh-border-strong"
                    }`}
                  >
                    {t(REASON_KEY[r])}
                  </button>
                ))}
              </div>
              {reason === "other" ? (
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("reasonNote")}
                  aria-label={t("reasonNote")}
                  className="mt-2.5 w-full rounded-[8px] border border-wh-border bg-wh-surface px-3 py-2 text-[13px] outline-none focus:border-wh-ok"
                />
              ) : null}
              {reason === null ? (
                <p className="mt-2 text-[11.5px] text-wh-ink-3">{t("damageReasonRequired")}</p>
              ) : null}
            </div>
          ) : null}

          <div className="mx-4 mb-4 mt-4">
            <button
              type="button"
              data-testid="wh-validate"
              disabled={!canValidate || busy}
              onClick={validate}
              className={`${WH_BTN_PRIMARY} w-full justify-center disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {t("validate")}
            </button>
          </div>

          {flash ? (
            <p
              data-testid="wh-flash"
              className={`mx-4 mb-4 rounded-[10px] px-3.5 py-2.5 text-[12.5px] font-semibold ${
                flash.ok ? "bg-wh-ok-bg text-wh-ok" : "bg-wh-bad-bg text-wh-bad"
              }`}
            >
              {flash.text}
            </p>
          ) : null}

          {!picked ? (
            <div
              data-testid="wh-lock-note"
              className="mx-4 mb-4 flex items-center gap-2 text-[12px] text-wh-ink-3"
            >
              <Lock size={13} aria-hidden="true" />
              {t("lockNote")}
            </div>
          ) : null}
        </WhCard>
      </div>
    </div>
  );
}

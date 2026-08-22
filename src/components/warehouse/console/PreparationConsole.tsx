"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  Boxes, ChevronDown, Clock, PackageSearch, ScanLine, Search, TriangleAlert, Check, X, FileText,
} from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import {
  LIBYA_REGION_LABELS, REGION_ORDER, regionForCity, type LibyaRegion,
} from "@/lib/warehouse/libya-regions";
import { WhCard, WhHolder, WhPill } from "./primitives";
import { WH_LABEL } from "./tokens";

/**
 * Préparation — the packing bench.
 *
 * The floor motion is: pick a row → pack it → stick the carrier's sticker on
 * → scan. So the queue and the scanner sit side by side and the scanner keeps
 * focus: the row you took is the parcel in your hands, and the panel says so.
 *
 * Grouped by REGION because that is what picks the sticker roll. Colour is
 * not shown — the roll colours are not confirmed yet (see libya-regions.ts).
 */

const DAILY_GOAL = 40;

/** Card and figure treatments, lifted so the three KPIs cannot drift apart. */
const KPI_CARD =
  "rounded-wh border border-wh-border bg-wh-surface p-4 shadow-sm transition-[box-shadow,transform,border-color] duration-150 hover:-translate-y-px hover:border-wh-border-strong hover:shadow-md";
const KPI_VALUE =
  "mt-2.5 font-mono text-[29px] font-bold leading-none tracking-[-0.02em] tabular-nums text-wh-ink-1";

/** One accent per region, so a band is recognisable before it is read. */
const REGION_DOT: Record<LibyaRegion, string> = {
  ouest: "bg-wh-scan",
  est: "bg-wh-move",
  sud: "bg-wh-warn",
  unknown: "bg-wh-border-strong",
};
const fetcher = (u: string) => fetch(u).then((r) => {
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
});

type AgeTone = "ok" | "warn" | "bad";
function ageOf(iso: string): { label: string; tone: AgeTone; hours: number } {
  const hours = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000);
  const label = hours < 24 ? `${Math.round(hours)} h` : `${Math.floor(hours / 24)} j`;
  return { label, tone: hours >= 48 ? "bad" : hours >= 12 ? "warn" : "ok", hours };
}

interface ScanEntry {
  id: string;
  code: string;
  at: string;
  ok: boolean;
  from?: number;
  to?: number;
  message?: string;
}

export function PreparationConsole({
  market,
  initialOrders,
}: {
  market: "ly" | "tn";
  initialOrders: WarehouseOrderRow[];
}) {
  const t = useTranslations("warehouse.prep2");
  const isLy = market === "ly";

  const { data, mutate } = useSWR<{ orders: WarehouseOrderRow[] }>(
    "/api/warehouse/to-label",
    fetcher,
    { fallbackData: { orders: initialOrders }, revalidateOnFocus: true },
  );

  const [query, setQuery] = useState("");
  const [ageFilter, setAgeFilter] = useState<"all" | "fresh" | "late">("all");
  const [product, setProduct] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [region, setRegion] = useState<LibyaRegion | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hand, setHand] = useState<WarehouseOrderRow | null>(null);
  const [scans, setScans] = useState<ScanEntry[]>([]);
  const [scanValue, setScanValue] = useState("");
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const currency = isLy ? t("currency") : t("currencyTn");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      const hours = ageOf(o.created_at).hours;
      if (ageFilter === "late" && hours < 48) return false;
      if (ageFilter === "fresh" && hours > 24) return false;
      if (product && o.product_name !== product) return false;
      if (region && regionForCity(o.customer_city) !== region) return false;
      if (!q) return true;
      return [o.customer_name, o.customer_city, o.product_name, o.id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [orders, query, ageFilter, product, region]);

  const productNames = useMemo(
    () => Array.from(new Set(orders.map((o) => o.product_name))).sort(),
    [orders],
  );

  const groups = useMemo(() => {
    const by = new Map<LibyaRegion, WarehouseOrderRow[]>();
    for (const o of filtered) {
      const r = isLy ? regionForCity(o.customer_city) : "unknown";
      if (!by.has(r)) by.set(r, []);
      by.get(r)!.push(o);
    }
    return REGION_ORDER.filter((r) => by.has(r)).map((r) => ({ region: r, rows: by.get(r)! }));
  }, [filtered, isLy]);

  const lateCount = useMemo(
    () => orders.filter((o) => ageOf(o.created_at).hours >= 48).length,
    [orders],
  );
  const oldest = useMemo(
    () => orders.reduce((max, o) => Math.max(max, ageOf(o.created_at).hours), 0),
    [orders],
  );
  const scannedToday = scans.filter((s) => s.ok).length;
  const goalPct = Math.round((scannedToday / DAILY_GOAL) * 100);

  useEffect(() => {
    scanRef.current?.focus();
  }, [hand]);

  // The chip in the search field promises ⌘K; make it true.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const take = useCallback((o: WarehouseOrderRow) => {
    setHand(o);
    scanRef.current?.focus();
  }, []);

  const submitScan = useCallback(async () => {
    const code = scanValue.trim();
    if (!code || busy) return;
    setScanValue("");

    // In Libya the code on the parcel is the carrier's sticker, which the OMS
    // cannot resolve on its own — the row the operator took is the order. In
    // Tunisia the QR *is* the order id, so it resolves itself.
    const target = isLy ? hand : orders.find((o) => o.id === code || o.id.startsWith(code)) ?? null;

    if (!target) {
      setScans((s) => [
        { id: `${Date.now()}`, code, at: new Date().toISOString(), ok: false, message: t("notFound") },
        ...s,
      ].slice(0, 8));
      return;
    }

    setBusy(true);
    const before = target.current_stock ?? 0;
    try {
      const res = await fetch("/api/warehouse/scan-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: target.id }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        stock_after?: number; message?: string; error_code?: string; error?: string;
      };
      if (!res.ok) {
        setScans((s) => [
          {
            id: `${Date.now()}`, code, at: new Date().toISOString(), ok: false,
            message: body.message ?? body.error ?? body.error_code ?? t("scanErr"),
          },
          ...s,
        ].slice(0, 8));
        return;
      }
      setScans((s) => [
        {
          id: `${Date.now()}`, code, at: new Date().toISOString(), ok: true,
          from: before, to: body.stock_after ?? before - target.quantity,
        },
        ...s,
      ].slice(0, 8));
      setHand(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      void mutate();
    } finally {
      setBusy(false);
      scanRef.current?.focus();
    }
  }, [scanValue, busy, isLy, hand, orders, mutate, t]);

  const lastScan = scans[0];

  return (
    <div className="mx-auto w-full max-w-[1460px] px-6 py-6">
      <header className="mb-5 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-wh-ink-1">{t("title")}</h1>
          <p className="mt-1 text-[13px] text-wh-ink-2">
            {t("subtitle")} · {isLy ? "Libye" : "Tunisie"}
          </p>
        </div>
        <div className="ms-auto">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-[10px] border border-wh-border bg-wh-surface px-3.5 py-2 text-[13.5px] font-semibold text-wh-ink-1 shadow-sm hover:border-wh-border-strong hover:bg-wh-surface-2"
          >
            <FileText size={16} aria-hidden="true" />
            {isLy ? t("picking") : t("printLabels")}
          </button>
        </div>
      </header>

      {/* Three questions: how much is queued, how fast are we going, what is late. */}
      <div className="mb-[18px] grid max-w-[920px] gap-3.5 sm:grid-cols-3">
        <div className={KPI_CARD}>
          <div className={`flex items-center gap-2.5 ${WH_LABEL}`}>
            <WhHolder icon={PackageSearch} tone="scan" size={30} />
            {t("kpiQueue")}
          </div>
          <div className={KPI_VALUE}>{orders.length}</div>
          <p className="mt-1.5 text-[12px] text-wh-ink-2">
            {t("kpiQueueSub", { regions: groups.length, orders: orders.length })}
          </p>
        </div>

        <div className={KPI_CARD}>
          <div className={`flex items-center gap-2.5 ${WH_LABEL}`}>
            <WhHolder icon={ScanLine} tone="ok" size={30} />
            {t("kpiScanned")}
          </div>
          <div className={`${KPI_VALUE} flex flex-wrap items-baseline gap-2`}>
            {scannedToday}
            {goalPct > 0 ? (
              <span className="rounded-pill bg-wh-ok-bg px-2 py-0.5 font-sans text-[11.5px] font-semibold text-wh-ok">
                {t("vsGoal", { pct: goalPct })}
              </span>
            ) : null}
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-pill bg-wh-sunken">
            <i
              className="block h-full rounded-pill bg-wh-ok"
              style={{ width: `${Math.min((scannedToday / DAILY_GOAL) * 100, 100)}%` }}
            />
          </div>
          <p className="mt-1.5 font-mono text-[12px] tabular-nums text-wh-ink-2">
            {t("kpiGoal", { done: scannedToday, goal: DAILY_GOAL })}
          </p>
        </div>

        {/* The late card wears an inset amber bar, not just a border: on a
            wall screen the top edge is what reads from a distance. */}
        <div
          className={`rounded-wh border bg-wh-surface p-4 transition-[box-shadow,transform,border-color] duration-150 hover:-translate-y-px hover:border-wh-border-strong hover:shadow-md ${
            lateCount
              ? "border-wh-warn-edge shadow-[inset_0_2px_0_var(--wh-warn)]"
              : "border-wh-border shadow-sm"
          }`}
        >
          <div className={`flex items-center gap-2.5 ${WH_LABEL}`}>
            <WhHolder icon={Clock} tone={lateCount ? "warn" : "muted"} size={30} />
            {t("kpiLate")}
          </div>
          <div
            className={`mt-2.5 font-mono text-[29px] font-bold leading-none tabular-nums tracking-[-0.02em] ${
              lateCount ? "text-wh-warn" : "text-wh-ink-3"
            }`}
          >
            {lateCount}
          </div>
          {lateCount ? (
            <div className="mt-2">
              <WhPill tone="warn">
                {t("kpiOldest", {
                  age: oldest >= 24 ? `${Math.floor(oldest / 24)} j` : `${Math.round(oldest)} h`,
                })}
              </WhPill>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.9fr)]">
        <div className="min-w-0">
          <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
            <label className="flex min-w-[240px] flex-1 items-center gap-2.5 rounded-[10px] border border-wh-border bg-wh-surface px-3.5 py-2.5 shadow-sm focus-within:border-wh-ok">
              <Search size={16} className="text-wh-ink-3" aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search")}
                className="w-full border-none bg-transparent text-[13px] outline-none"
              />
              <kbd className="rounded-[5px] border border-wh-border bg-wh-sunken px-1.5 font-mono text-[10.5px] text-wh-ink-3">
                {t("kbd")}
              </kbd>
            </label>

            <FilterPill
              label={ageFilter === "all" ? t("filterAge") : ageFilter === "fresh" ? t("fresh") : t("lateFilter")}
              active={ageFilter !== "all"}
              options={[
                { value: "all", label: t("allAges") },
                { value: "fresh", label: t("fresh") },
                { value: "late", label: t("lateFilter") },
              ]}
              current={ageFilter}
              onPick={(v) => setAgeFilter(v as typeof ageFilter)}
            />

            {isLy ? (
              <FilterPill
                label={region ? LIBYA_REGION_LABELS[region].fr : t("filterRegion")}
                active={region !== null}
                options={[
                  { value: "", label: t("allRegions") },
                  ...REGION_ORDER.map((r) => ({ value: r, label: LIBYA_REGION_LABELS[r].fr })),
                ]}
                current={region ?? ""}
                onPick={(v) => setRegion((v || null) as LibyaRegion | null)}
              />
            ) : null}

            <FilterPill
              label={product ? product : t("filterProduct")}
              active={product !== null}
              options={[
                { value: "", label: t("allProducts") },
                ...productNames.map((p) => ({ value: p, label: p })),
              ]}
              current={product ?? ""}
              onPick={(v) => setProduct(v || null)}
            />

            {/* Kept as its own pill: "late" is the one filter an operator
                reaches for without thinking, so it stays one click away. */}
            <button
              type="button"
              onClick={() => setAgeFilter(ageFilter === "late" ? "all" : "late")}
              className={`inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-[12.5px] font-semibold shadow-sm ${
                ageFilter === "late"
                  ? "border-wh-warn-edge bg-wh-warn-bg text-wh-warn"
                  : "border-wh-border bg-wh-surface text-wh-ink-2 hover:border-wh-border-strong"
              }`}
            >
              {t("filterLate")}
              <span
                className={`rounded-pill px-1.5 font-mono text-[11px] tabular-nums ${
                  ageFilter === "late" ? "bg-wh-warn text-white" : "bg-wh-sunken text-wh-ink-2"
                }`}
              >
                {lateCount}
              </span>
            </button>
          </div>

          <WhCard>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="w-[34px] border-b border-wh-border px-3.5 py-2.5" />
                    <th className={`border-b border-wh-border px-3.5 py-2.5 text-start ${WH_LABEL}`}>{t("colOrder")}</th>
                    <th className={`border-b border-wh-border px-3.5 py-2.5 text-start ${WH_LABEL}`}>{t("colProduct")}</th>
                    <th className={`border-b border-wh-border px-3.5 py-2.5 text-end ${WH_LABEL}`}>{t("colCollect")}</th>
                    <th className={`border-b border-wh-border px-3.5 py-2.5 text-start ${WH_LABEL}`}>{t("colAge")}</th>
                    <th className={`border-b border-wh-border px-3.5 py-2.5 text-end ${WH_LABEL}`}>{t("colStock")}</th>
                    <th className="border-b border-wh-border px-3.5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {groups.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3.5 py-10 text-center text-[13px] text-wh-ink-3">
                        {orders.length === 0 ? t("empty") : t("noMatch")}
                      </td>
                    </tr>
                  ) : (
                    groups.map((g) => (
                      <FragmentGroup
                        key={g.region}
                        region={g.region}
                        rows={g.rows}
                        isLy={isLy}
                        hand={hand}
                        selected={selected}
                        onToggle={(id) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          })
                        }
                        onTake={take}
                        t={t}
                        currency={currency}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {selected.size > 0 ? (
              <div className="sticky bottom-0 flex items-center gap-3 rounded-b-wh border-t border-wh-border-strong bg-wh-surface/95 px-4 py-3 backdrop-blur">
                <input
                  type="checkbox"
                  checked
                  readOnly
                  aria-hidden="true"
                  tabIndex={-1}
                  className="h-[15px] w-[15px] accent-[color:var(--wh-ok)]"
                />
                <span className="text-[13px] font-semibold">
                  {t("selected", { count: selected.size })}
                </span>
                <div className="ms-auto flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(filtered.map((o) => o.id)))}
                    className="rounded-[8px] border border-wh-border px-3 py-1.5 text-[12.5px] font-semibold text-wh-ink-2 hover:border-wh-border-strong"
                  >
                    {t("takeAll")}
                  </button>
                  <button
                    type="button"
                    className="rounded-[8px] border border-wh-ok bg-wh-ok px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90"
                  >
                    {t("makeLot", { count: selected.size })}
                  </button>
                </div>
              </div>
            ) : null}
          </WhCard>
        </div>

        {/* Scan station. Sticky, because the operator's hands are on a parcel. */}
        <div className="lg:sticky lg:top-[70px]">
          <WhCard
            title={isLy ? t("scanTitle") : t("scanTitleTn")}
            hint={isLy ? t("scanHint") : t("scanHintTn")}
            footer={
              <span className="flex gap-2.5">
                <TriangleAlert size={16} className="shrink-0 text-wh-warn" aria-hidden="true" />
                {t("warn")}
              </span>
            }
          >
            <div className="m-4 rounded-[11px] border border-wh-border bg-wh-sunken p-3.5">
              <div className={`flex items-center ${WH_LABEL}`}>
                {hand ? t("handLabel") : t("handNone")}
                {hand && isLy ? (
                  <span className="ms-auto">
                    <WhPill tone="scan">
                      {LIBYA_REGION_LABELS[regionForCity(hand.customer_city)].fr}
                    </WhPill>
                  </span>
                ) : null}
              </div>
              {hand ? (
                <>
                  <div className="mt-1.5 text-[16px] font-bold text-wh-ink-1">{hand.customer_name}</div>
                  <div className="mt-0.5 text-[12.5px] text-wh-ink-2">
                    <span className="font-mono tabular-nums">{hand.id.slice(0, 8).toUpperCase()}</span>
                    {hand.customer_city ? ` · ${hand.customer_city}` : ""} · {hand.product_name} × {hand.quantity}
                  </div>
                </>
              ) : (
                <p className="mt-1.5 text-[12.5px] text-wh-ink-2">{t("handNoneHint")}</p>
              )}
            </div>

            <label
              className={`mx-4 flex items-center gap-2.5 rounded-[12px] border-2 bg-wh-surface px-4 py-3.5 ${
                hand || !isLy ? "border-wh-ok shadow-wh-glow" : "border-wh-border"
              }`}
            >
              <ScanLine size={18} className={hand || !isLy ? "text-wh-ok" : "text-wh-ink-3"} aria-hidden="true" />
              <input
                ref={scanRef}
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitScan();
                  }
                }}
                disabled={busy}
                autoComplete="off"
                aria-label={isLy ? t("scanPlaceholder") : t("scanPlaceholderTn")}
                placeholder={isLy ? t("scanPlaceholder") : t("scanPlaceholderTn")}
                className="w-full border-none bg-transparent font-mono text-[16px] font-semibold tracking-wide outline-none"
              />
            </label>

            {lastScan ? (
              <div
                className={`mx-4 mt-3.5 rounded-[11px] border p-3.5 ${
                  lastScan.ok
                    ? "border-wh-ok-edge bg-wh-ok-bg"
                    : "border-wh-bad-edge bg-wh-bad-bg"
                }`}
              >
                <div
                  className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] ${
                    lastScan.ok ? "text-wh-ok" : "text-wh-bad"
                  }`}
                >
                  {lastScan.ok ? <Check size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
                  {lastScan.ok ? t("scanOk") : t("scanErr")}
                </div>
                <div className="mt-1.5 font-mono text-[19px] font-bold tabular-nums tracking-wide text-wh-ink-1">
                  {lastScan.code}
                </div>
                <div className="mt-1 font-mono text-[12.5px] tabular-nums text-wh-ink-2">
                  {lastScan.ok
                    ? t("stockAfter", { from: lastScan.from ?? "—", to: lastScan.to ?? "—" })
                    : lastScan.message}
                </div>
              </div>
            ) : null}

            <div className="m-4">
              <div className={`mb-1.5 ${WH_LABEL}`}>{t("lastScans")}</div>
              {scans.length === 0 ? (
                <p className="py-3 text-[12.5px] text-wh-ink-3">{t("noScans")}</p>
              ) : (
                scans.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2.5 border-t border-wh-border py-2 font-mono text-[12px] tabular-nums first:border-t-0"
                  >
                    {s.ok ? (
                      <Check size={15} className="text-wh-ok" aria-hidden="true" />
                    ) : (
                      <X size={15} className="text-wh-bad" aria-hidden="true" />
                    )}
                    <span className="font-semibold">{s.code}</span>
                    <span className="ms-auto text-wh-ink-3">
                      {new Date(s.at).toLocaleTimeString("fr-FR")}
                      {s.ok ? (
                        <span className="ms-1.5 text-wh-ok">
                          {s.from} → {s.to}
                        </span>
                      ) : (
                        <span className="ms-1.5 text-wh-bad">{s.message}</span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </WhCard>
        </div>
      </div>
    </div>
  );
}

/** Filter pill with a menu, matching the prototype's `Âge ⌄` chips. */
function FilterPill({
  label, active, options, current, onPick,
}: {
  label: string;
  active: boolean;
  options: { value: string; label: string }[];
  current: string;
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex max-w-[190px] items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[12.5px] font-semibold shadow-sm ${
          active
            ? "border-wh-ok bg-wh-ok-bg text-wh-ok"
            : "border-wh-border bg-wh-surface text-wh-ink-2 hover:border-wh-border-strong"
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute z-40 mt-1.5 min-w-[190px] rounded-[10px] border border-wh-border-strong bg-wh-surface p-1 shadow-lg">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onPick(o.value);
                setOpen(false);
              }}
              aria-pressed={o.value === current}
              className={`block w-full truncate rounded-[6px] px-2.5 py-1.5 text-start text-[13px] ${
                o.value === current ? "bg-wh-ok-bg font-semibold text-wh-ok" : "hover:bg-wh-sunken"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FragmentGroup({
  region, rows, isLy, hand, selected, onToggle, onTake, t, currency,
}: {
  region: LibyaRegion;
  rows: WarehouseOrderRow[];
  isLy: boolean;
  hand: WarehouseOrderRow | null;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onTake: (o: WarehouseOrderRow) => void;
  t: ReturnType<typeof useTranslations>;
  currency: string;
}) {
  const label = LIBYA_REGION_LABELS[region];
  return (
    <>
      {isLy ? (
        <tr>
          <td colSpan={7} className="bg-wh-sunken px-3.5 py-1.5 text-[11.5px] font-bold tracking-[0.04em] text-wh-ink-2">
            <span
              className={`me-2 inline-block h-2 w-2 rounded-pill align-[1px] ${REGION_DOT[region]}`}
              aria-hidden="true"
            />
            <span className="uppercase">{label.fr}</span>
            <span className="ms-1.5 font-semibold text-wh-ink-3">— {label.ar}</span>
            <span className="float-end font-mono font-semibold tabular-nums text-wh-ink-3">
              {t("orders", { count: rows.length })}
            </span>
          </td>
        </tr>
      ) : null}
      {rows.map((o) => {
        const age = ageOf(o.created_at);
        const inHand = hand?.id === o.id;
        const stock = o.current_stock ?? 0;
        const lowStock = stock <= (o.low_stock_threshold ?? 0);
        return (
          <tr
            key={o.id}
            className={`border-b border-wh-border last:border-0 ${
              inHand ? "bg-wh-ok-tint shadow-[inset_3px_0_0_var(--wh-ok)]" : "hover:bg-wh-surface-2"
            }`}
          >
            <td className="px-3.5 py-2.5">
              <input
                type="checkbox"
                checked={selected.has(o.id)}
                onChange={() => onToggle(o.id)}
                aria-label={o.customer_name}
                className="h-[15px] w-[15px] accent-[color:var(--wh-ok)]"
              />
            </td>
            <td className="px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[8px] border border-wh-border bg-wh-sunken">
                  <Boxes size={15} className="text-wh-ink-3" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <b className="block truncate text-[13.5px] font-semibold text-wh-ink-1">{o.customer_name}</b>
                  <span className="block truncate font-mono text-[11.5px] tabular-nums text-wh-ink-3">
                    {o.id.slice(0, 8).toUpperCase()}
                    {o.customer_city ? ` · ${o.customer_city}` : ""}
                  </span>
                </span>
              </div>
            </td>
            <td className="px-3.5 py-2.5 text-wh-ink-2">
              {o.product_name} <span className="text-wh-ink-3">× {o.quantity}</span>
            </td>
            <td className="px-3.5 py-2.5 text-end font-mono font-semibold tabular-nums">
              {Number(o.total_price).toFixed(2).replace(".", ",")}
              <span className="ms-1 font-sans text-[11px] font-semibold text-wh-ink-3">{currency}</span>
            </td>
            <td className="px-3.5 py-2.5">
              <span
                className={`inline-block rounded-pill px-2.5 py-1 font-mono text-[11.5px] font-semibold tabular-nums ${
                  age.tone === "bad"
                    ? "bg-wh-bad-bg text-wh-bad"
                    : age.tone === "warn"
                      ? "bg-wh-warn-bg text-wh-warn"
                      : "bg-wh-sunken text-wh-ink-2"
                }`}
              >
                {age.label}
              </span>
            </td>
            <td className="px-3.5 py-2.5 text-end font-mono tabular-nums">
              {stock}
              <span
                className={`ms-1.5 inline-block h-[7px] w-[7px] rounded-pill ${
                  lowStock ? "bg-wh-bad" : "bg-wh-ok"
                }`}
                aria-hidden="true"
              />
            </td>
            <td className="px-3.5 py-2.5 text-end">
              <button
                type="button"
                onClick={() => onTake(o)}
                className={`rounded-[8px] border px-2.5 py-1.5 text-[12.5px] font-semibold ${
                  inHand
                    ? "border-wh-ok bg-wh-ok text-white"
                    : "border-wh-border bg-wh-surface text-wh-ink-1 hover:border-wh-border-strong hover:bg-wh-surface-2"
                }`}
              >
                {inHand ? t("inHand") : t("take")}
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}

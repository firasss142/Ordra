"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import {
  Boxes, ChevronDown, Clock, Maximize2, PackageSearch, ScanLine, Search, Truck,
} from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";
import { DARB_ZONE_ORDER, zoneLabels } from "@/lib/carriers/darb-zones";
import { WhCard, WhHolder, WhPill } from "./primitives";
import { WH_LABEL, WH_BTN } from "./tokens";
import { ScanStation } from "./ScanStation";
import { PrepCard, benchAgeLabel, type AgeTranslate } from "./PrepCard";

/**
 * Préparation — the packing bench.
 *
 * The floor motion is: pick a row → pack it → stick the carrier's sticker on
 * → scan. So the queue and the scanner sit side by side and the scanner keeps
 * focus: the row you took is the parcel in your hands, and the panel says so.
 *
 * Grouped by DARB'S OWN ZONES, which are the sticker-roll colours — because
 * that is what a picker actually batches by. The colours come from the
 * carrier's branch directory, not from us.
 */

type Row = WarehouseOrderRow & { zone: OrderZone };

interface QueuePage {
  orders: Row[];
  total?: number;
  late?: number;
  oldestHours?: number;
  releasedAtCarrier?: number;
  scannedToday?: number;
  scannedYesterday?: number;
  neverScanned?: number;
  /** Off the bench, still at `uploaded`. Excluded from every count above. */
  setAside?: number;
}

/** Card and figure treatments, lifted so the KPIs cannot drift apart. */
const KPI_CARD =
  "rounded-wh border border-wh-border bg-wh-surface p-4 shadow-sm transition-[box-shadow,transform,border-color] duration-150 hover:-translate-y-px hover:border-wh-border-strong hover:shadow-md";
const KPI_VALUE =
  "mt-2.5 font-mono text-[29px] font-bold leading-none tracking-[-0.02em] tabular-nums text-wh-ink-1";

const fetcher = (u: string) => fetch(u).then((r) => {
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
});

/** Carrier states that mean the parcel has already left. It cannot be scanned. */
const GONE_AT_CARRIER = new Set(["released", "completed", "returning", "returned"]);

type AgeTone = "ok" | "warn" | "bad";

/**
 * Age on the BENCH, not since intake. An order created three weeks ago and
 * uploaded this morning has been the warehouse's problem for two hours; on
 * real data the two clocks differ by up to a month.
 */
function ageOf(row: Row): { tone: AgeTone; hours: number } {
  const since = row.uploaded_at ?? row.created_at;
  const hours = Math.max(0, (Date.now() - new Date(since).getTime()) / 3_600_000);
  return { tone: hours >= 48 ? "bad" : hours >= 12 ? "warn" : "ok", hours };
}

export function PreparationConsole({
  market,
  initialOrders,
  dailyGoal,
}: {
  market: "ly" | "tn";
  initialOrders: Row[];
  /** From the market's settings — never a constant in the component. */
  dailyGoal: number;
}) {
  const t = useTranslations("warehouse.prep2");
  const tAge = useTranslations("warehouse.age");
  const locale = useLocale();
  const isLy = market === "ly";

  const { data, mutate } = useSWR<QueuePage>(
    "/api/warehouse/to-label?limit=100",
    fetcher,
    { fallbackData: { orders: initialOrders }, revalidateOnFocus: true },
  );

  const [query, setQuery] = useState("");
  const [ageFilter, setAgeFilter] = useState<"all" | "fresh" | "late">("all");
  const [product, setProduct] = useState<string | null>(null);
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [hand, setHand] = useState<Row | null>(null);

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const currency = isLy ? t("currency") : t("currencyTn");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      const hours = ageOf(o).hours;
      if (ageFilter === "late" && hours < 48) return false;
      if (ageFilter === "fresh" && hours > 24) return false;
      if (product && o.product_name !== product) return false;
      if (zoneFilter && o.zone.colorHex !== zoneFilter) return false;
      if (!q) return true;
      // The prototype's placeholder promises a sticker search; keep that true.
      return [
        o.customer_name, o.customer_city, o.product_name, o.id,
        o.carrier_sticker_ref, o.tracking_number,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [orders, query, ageFilter, product, zoneFilter]);

  const productNames = useMemo(
    () => Array.from(new Set(orders.map((o) => o.product_name))).sort(),
    [orders],
  );

  /** Grouped by roll colour, which is the order the parcels get stickered in. */
  const groups = useMemo(() => {
    const by = new Map<string, Row[]>();
    for (const o of filtered) {
      const key = o.zone.colorHex ?? "unknown";
      if (!by.has(key)) by.set(key, []);
      by.get(key)!.push(o);
    }
    const ordered = [...DARB_ZONE_ORDER, "unknown"].filter((k) => by.has(k));
    return ordered.map((key) => ({ key, rows: by.get(key)! }));
  }, [filtered]);

  /*
   * Every KPI describes the WHOLE queue, which the API counts server-side. They
   * used to count the loaded rows, so the bench read "50" — the page size —
   * under an Aujourd'hui that correctly said 407.
   */
  const queueTotal = data?.total ?? orders.length;
  const lateCount = data?.late ?? 0;
  const oldest = data?.oldestHours ?? 0;
  const released = data?.releasedAtCarrier ?? 0;
  const scannedToday = data?.scannedToday ?? 0;
  const scannedYesterday = data?.scannedYesterday ?? 0;
  const neverScanned = data?.neverScanned ?? 0;
  const setAside = data?.setAside ?? 0;
  const goalPct = dailyGoal > 0 ? Math.round((scannedToday / dailyGoal) * 100) : 0;

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

  const take = useCallback((o: Row) => setHand(o), []);
  const onScanned = useCallback(() => {
    setHand(null);
    void mutate();
  }, [mutate]);

  return (
    <div className="mx-auto w-full max-w-[1460px] px-4 py-5 md:px-6 md:py-6">
      <header className="mb-5 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-wh-ink-1 md:text-[24px]">{t("title")}</h1>
          <p className="mt-1 text-[13px] text-wh-ink-2">
            {t("subtitle")} · {isLy ? t("marketLy") : t("marketTn")}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap gap-2.5">
          {isLy ? (
            <Link href="./scan" className={WH_BTN}>
              <Maximize2 size={16} aria-hidden="true" />
              {t("scanMode")}
            </Link>
          ) : null}
        </div>
      </header>

      {/* Four questions: how much is queued, how fast are we going, what is
          late, and what is already gone and should not be here at all. */}
      <div className="mb-[18px] grid max-w-[1180px] gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <div className={KPI_CARD}>
          <div className={`flex items-center gap-2.5 ${WH_LABEL}`}>
            <WhHolder icon={PackageSearch} tone="scan" size={30} />
            {t("kpiQueue")}
          </div>
          <div className={KPI_VALUE}>{queueTotal}</div>
          <p className="mt-1.5 text-[12px] text-wh-ink-2">
            {t("kpiQueueSub", { zones: groups.length, orders: filtered.length })}
          </p>
          {queueTotal > orders.length ? (
            <p className="mt-1 text-[11.5px] text-wh-ink-3">
              {t("showingFirst", { count: orders.length })}
            </p>
          ) : null}
          {setAside > 0 ? (
            <p data-testid="wh-prep-set-aside" className="mt-1 text-[11.5px] text-wh-ink-3">
              {t("kpiSetAside", { count: setAside })}
            </p>
          ) : null}
        </div>

        <div className={KPI_CARD}>
          <div className={`flex items-center gap-2.5 ${WH_LABEL}`}>
            <WhHolder icon={ScanLine} tone="ok" size={30} />
            {t("kpiScanned")}
          </div>
          <div className={`${KPI_VALUE} flex flex-wrap items-baseline gap-2`}>
            {scannedToday}
            <VsYesterday today={scannedToday} yesterday={scannedYesterday} t={t} />
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-pill bg-wh-sunken">
            <i
              className="block h-full rounded-pill bg-wh-ok"
              style={{ width: `${Math.min(goalPct, 100)}%` }}
            />
          </div>
          <p className="mt-1.5 font-mono text-[12px] tabular-nums text-wh-ink-2">
            {t("kpiGoal", { done: scannedToday, goal: dailyGoal })}
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
          {/* Without this split the figure reads as a copy of the queue total.
              Most of the backlog is not slow, it is abandoned. */}
          {neverScanned > 0 ? (
            <p className="mt-1.5 text-[12px] text-wh-ink-2">
              {t("kpiLateSplit", { stale: neverScanned, recent: Math.max(lateCount - neverScanned, 0) })}
            </p>
          ) : null}
          {oldest > 0 ? (
            <div className="mt-2">
              <WhPill tone={lateCount ? "warn" : "muted"}>
                {t("kpiOldest", { age: benchAgeLabel(oldest, tAge) })}
              </WhPill>
            </div>
          ) : null}
        </div>

        {/* Parcels the carrier already sent out. They cannot be scanned, and
            until now they looked exactly like ordinary work. */}
        <div
          className={`rounded-wh border bg-wh-surface p-4 shadow-sm ${
            released ? "border-wh-bad-edge shadow-[inset_0_2px_0_var(--wh-bad)]" : "border-wh-border"
          }`}
        >
          <div className={`flex items-center gap-2.5 ${WH_LABEL}`}>
            <WhHolder icon={Truck} tone={released ? "bad" : "muted"} size={30} />
            {t("kpiGone")}
          </div>
          <div
            className={`mt-2.5 font-mono text-[29px] font-bold leading-none tabular-nums tracking-[-0.02em] ${
              released ? "text-wh-bad" : "text-wh-ink-3"
            }`}
          >
            {released}
          </div>
          <p className="mt-1.5 text-[12px] text-wh-ink-2">{t("kpiGoneSub")}</p>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(340px,0.8fr)]">
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
                label={zoneFilter ? zoneLabels(zoneFilter, locale).name ?? t("filterZone") : t("filterZone")}
                active={zoneFilter !== null}
                options={[
                  { value: "", label: t("allZones") },
                  ...DARB_ZONE_ORDER.map((hex) => {
                    const z = zoneLabels(hex, locale);
                    return { value: hex, label: `${z.colour} — ${z.name}` };
                  }),
                ]}
                current={zoneFilter ?? ""}
                onPick={(v) => setZoneFilter(v || null)}
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
          </div>

          <WhCard>
            {/* The phone gets cards. Six columns in 390px overprinted PRODUIT
                on COMMANDE and truncated every customer to one letter. */}
            <div className="flex flex-col gap-2.5 p-2.5 md:hidden">
              {groups.length === 0 ? (
                <p className="px-1 py-8 text-center text-[13px] text-wh-ink-3">
                  {orders.length > 0
                    ? t("noMatch")
                    : setAside > 0
                      ? t("emptySetAside", { count: setAside })
                      : t("empty")}
                </p>
              ) : (
                groups.map((g) => (
                  <div key={g.key} className="flex flex-col gap-2.5">
                    {isLy && g.rows.length > 1 ? (
                      <p className="px-1 pt-1 font-mono text-[11px] font-bold tabular-nums text-wh-ink-3">
                        {t("orders", { count: g.rows.length })}
                      </p>
                    ) : null}
                    {g.rows.map((o) => (
                      <PrepCard
                        key={o.id}
                        row={o}
                        isLy={isLy}
                        hand={hand}
                        onTake={take}
                        currency={currency}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full table-fixed border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={`border-b border-wh-border px-3.5 py-2.5 text-start ${WH_LABEL}`}>{t("colOrder")}</th>
                    <th className={`w-[150px] border-b border-wh-border px-2 py-2.5 text-start ${WH_LABEL}`}>{t("colProduct")}</th>
                    <th className={`w-[104px] border-b border-wh-border px-2 py-2.5 text-end ${WH_LABEL}`}>{t("colCollect")}</th>
                    <th className={`w-[64px] border-b border-wh-border px-2 py-2.5 text-start ${WH_LABEL}`}>{t("colAge")}</th>
                    <th className={`w-[72px] border-b border-wh-border px-2 py-2.5 text-end ${WH_LABEL}`}>{t("colStock")}</th>
                    <th className="w-[92px] border-b border-wh-border px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {groups.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3.5 py-10 text-center text-[13px] text-wh-ink-3">
                        {/* An emptied bench must say why. Every Libyan order on
                            it predated the cutoff, so clearing it leaves the
                            screen blank — and a blank screen reads as a fault,
                            not as "you are up to date". */}
                        <span data-testid="wh-prep-empty">
                          {orders.length > 0
                            ? t("noMatch")
                            : setAside > 0
                              ? t("emptySetAside", { count: setAside })
                              : t("empty")}
                        </span>
                      </td>
                    </tr>
                  ) : (
                    groups.map((g) => (
                      <ZoneGroup
                        key={g.key}
                        zoneKey={g.key}
                        rows={g.rows}
                        isLy={isLy}
                        hand={hand}
                        onTake={take}
                        t={t}
                        tAge={tAge}
                        locale={locale}
                        currency={currency}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </WhCard>
        </div>

        {/* Scan station. Sticky, because the operator's hands are on a parcel. */}
        <div className="lg:sticky lg:top-4">
          <ScanStation
            variant="panel"
            market={market}
            hand={hand}
            handZone={hand?.zone ?? null}
            orders={orders}
            onScanned={onScanned}
          />
        </div>
      </div>

    </div>
  );
}

/** ▲/▼ against yesterday, or a muted dash when there is nothing to compare. */
function VsYesterday({
  today,
  yesterday,
  t,
}: {
  today: number;
  yesterday: number;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  if (yesterday === 0) {
    return <span className="font-sans text-[11.5px] text-wh-ink-3">{t("noCompare")}</span>;
  }
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  const up = pct >= 0;
  return (
    <span
      className={`rounded-pill px-2 py-0.5 font-sans text-[11.5px] font-semibold ${
        up ? "bg-wh-ok-bg text-wh-ok" : "bg-wh-bad-bg text-wh-bad"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(pct)} %
    </span>
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
        className={`inline-flex max-w-[220px] items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[12.5px] font-semibold shadow-sm ${
          active
            ? "border-wh-ok bg-wh-ok-bg text-wh-ok"
            : "border-wh-border bg-wh-surface text-wh-ink-2 hover:border-wh-border-strong"
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute z-40 mt-1.5 min-w-[220px] rounded-[10px] border border-wh-border-strong bg-wh-surface p-1 shadow-lg">
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

/**
 * A band per sticker-roll colour. The swatch is Darb's own hex, so the band
 * matches the physical roll on the shelf rather than a palette we invented.
 */
function ZoneGroup({
  zoneKey, rows, isLy, hand, onTake, t, tAge, locale, currency,
}: {
  zoneKey: string;
  rows: Row[];
  isLy: boolean;
  hand: Row | null;
  onTake: (o: Row) => void;
  t: ReturnType<typeof useTranslations>;
  tAge: AgeTranslate;
  locale: string;
  currency: string;
}) {
  // The group key IS Darb's hex (or "unknown"), so the swatch needs no lookup.
  const zone = zoneLabels(zoneKey, locale);
  const known = zone.colour !== null;
  return (
    <>
      {isLy ? (
        <tr>
          <td colSpan={6} className="bg-wh-sunken px-3.5 py-1.5 text-[11.5px] font-bold tracking-[0.04em] text-wh-ink-2">
            <span
              className="me-2 inline-block h-2.5 w-2.5 rounded-pill border border-black/15 align-[0px]"
              style={{ background: known ? zoneKey : "transparent" }}
              aria-hidden="true"
            />
            <span className="uppercase">{zone.colour ?? t("zoneUnknown")}</span>
            {zone.name ? (
              <span className="ms-1.5 font-semibold text-wh-ink-3">— {zone.name}</span>
            ) : null}
            <span className="float-end font-mono font-semibold tabular-nums text-wh-ink-3">
              {t("orders", { count: rows.length })}
            </span>
          </td>
        </tr>
      ) : null}
      {rows.map((o) => {
        const age = ageOf(o);
        const inHand = hand?.id === o.id;
        const stock = o.current_stock ?? 0;
        const lowStock = stock <= (o.low_stock_threshold ?? 0);
        const gone = GONE_AT_CARRIER.has(o.carrier_status_slug ?? "");
        // Without Darb's internal id the sticker cannot be bound at all. Say so
        // on the row rather than letting the operator find out at the scanner.
        const unbindable = isLy && !gone && o.has_carrier_ref === false;
        return (
          <tr
            key={o.id}
            className={`border-b border-wh-border last:border-0 ${
              inHand ? "bg-wh-ok-tint shadow-[inset_3px_0_0_var(--wh-ok)]" : "hover:bg-wh-surface-2"
            }`}
          >
            <td className="px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[8px] border border-wh-border bg-wh-sunken">
                  <Boxes size={15} className="text-wh-ink-3" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <b className="block truncate text-[13.5px] font-semibold text-wh-ink-1">
                    <bdi>{o.customer_name}</bdi>
                  </b>
                  <span className="block truncate font-mono text-[11.5px] tabular-nums text-wh-ink-3">
                    {o.carrier_sticker_ref ?? o.id.slice(0, 8).toUpperCase()}
                    {o.customer_city ? <> · <bdi>{o.customer_city}</bdi></> : null}
                  </span>
                  {gone ? (
                    <span className="mt-1 inline-block"><WhPill tone="bad">{t("goneAtCarrier")}</WhPill></span>
                  ) : unbindable ? (
                    <span className="mt-1 inline-block"><WhPill tone="warn">{t("noCarrierRef")}</WhPill></span>
                  ) : null}
                </span>
              </div>
            </td>
            <td className="px-2 py-2.5 text-wh-ink-2">
              <span className="block truncate" title={`${o.product_name} × ${o.quantity}`}>
                <bdi>{o.product_name}</bdi> <span className="text-wh-ink-3">× {o.quantity}</span>
              </span>
            </td>
            <td className="whitespace-nowrap px-2 py-2.5 text-end font-mono font-semibold tabular-nums">
              {Number(o.total_price).toFixed(2).replace(".", ",")}
              <span className="ms-1 font-sans text-[11px] font-semibold text-wh-ink-3">{currency}</span>
            </td>
            <td className="px-3.5 py-2.5">
              <span
                className={`inline-block whitespace-nowrap rounded-pill px-2.5 py-1 font-mono text-[11.5px] font-semibold tabular-nums ${
                  age.tone === "bad"
                    ? "bg-wh-bad-bg text-wh-bad"
                    : age.tone === "warn"
                      ? "bg-wh-warn-bg text-wh-warn"
                      : "bg-wh-sunken text-wh-ink-2"
                }`}
                title={t("ageFromUpload")}
              >
                {benchAgeLabel(age.hours, tAge)}
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
                disabled={gone}
                className={`rounded-[8px] border px-2.5 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
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

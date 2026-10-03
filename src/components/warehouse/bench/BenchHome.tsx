"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronsUpDown, Clock } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import { DARB_ZONE_ORDER, zoneLabels } from "@/lib/carriers/darb-zones";
import { MARKET_TIMEZONE } from "@/lib/markets";
import type { PrepRow } from "@/components/warehouse/console/PrepCard";
import type { TodayResponse } from "@/app/api/warehouse/today/route";
import { PickupSwitch } from "@/components/warehouse/pickup/PickupSwitch";
import { Thumb } from "@/components/warehouse/run/RunOutcome";
import { CARD } from "@/components/warehouse/run/ui";
import { Chip } from "@/components/warehouse/today/Chip";
import { LAST_ROLL_KEY } from "@/components/warehouse/run/ScanRun";
import { ScannedList } from "./ScannedList";
import { ScanSheet } from "./ScanSheet";
import { benchAge, firstName, rollHref, runHref } from "./bench-format";

/**
 * « Sortir » — the agent's first job of the day (prototype v3, `R.out`).
 *
 * The building and the day, the driver strip, two soft tabs, then ONE card
 * with a row per sticker roll in Darb's poster order. The rolls are the
 * action: « Commencer » opens the scan run on that roll, and the first roll
 * lies open on its first three parcels — product first, then city and first
 * name, then the age — each of which opens the run on THAT parcel. Parcels
 * older than ten days are folded at the bottom, still scannable.
 *
 * Nothing on this screen binds a sticker except the lookup sheet's « sticker
 * libre », which goes through the same scan-out POST as the run.
 */

export interface BenchStats {
  toPrepare: number;
  oldestHours: number;
  scannedToday: number;
  toHandOver: number;
  carrierWarehouse: number;
}

interface QueuePage {
  orders: PrepRow[];
  total?: number;
  oldestHours?: number;
  scannedToday?: number;
  carrierWarehouse?: number;
}

const QUEUE_KEY = "/api/warehouse/to-label?limit=200";
const TODAY_KEY = "/api/warehouse/today";
// The run writes the roll it worked under the same key, so the free sticker's
// shortlist follows the roll really in the agent's hand.
const ROLL_KEY = LAST_ROLL_KEY;
const FEW = 3;

type Mode = "few" | "all" | "closed";

interface Group {
  key: string;
  hex: string | null;
  rows: PrepRow[];
}

/** Darb's poster order; a colour Darb's poster lacks after it, no colour last. */
function rank(hex: string | null): number {
  if (!hex) return DARB_ZONE_ORDER.length + 1;
  const i = DARB_ZONE_ORDER.indexOf(hex.toLowerCase());
  return i === -1 ? DARB_ZONE_ORDER.length : i;
}

export function BenchHome({
  market,
  locale,
  initialOrders,
  initialStats,
  siteName,
  siteUnassigned,
}: {
  market: "ly" | "tn";
  locale: string;
  currency: string;
  initialOrders: PrepRow[];
  initialStats: BenchStats;
  /** The building this bench belongs to, in the market's language. */
  siteName?: string | null;
  /** Nobody has assigned this agent to a building: there is no work to show. */
  siteUnassigned?: boolean;
}) {
  const t = useTranslations("warehouse.bench");
  const uiLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const isLy = market === "ly";

  const { data: page, mutate } = useSWR<QueuePage>(QUEUE_KEY, jsonFetcher, {
    fallbackData: {
      orders: initialOrders,
      total: initialStats.toPrepare,
      oldestHours: initialStats.oldestHours,
      scannedToday: initialStats.scannedToday,
      carrierWarehouse: initialStats.carrierWarehouse,
    },
    revalidateOnFocus: true,
  });
  // The same payload as « Aujourd'hui » and the shell's badges: one fetch.
  const { data: today, mutate: mutateToday } = useSWR<TodayResponse>(siteUnassigned ? null : TODAY_KEY, jsonFetcher);
  const day = today && !today.siteUnassigned ? today : null;

  const orders = useMemo(() => page?.orders ?? [], [page]);
  // A bound parcel leaves the list the moment the server says so, not on the
  // next revalidation.
  const [boundIds, setBoundIds] = useState<Set<string>>(() => new Set());
  const live = useMemo(() => orders.filter((o) => !boundIds.has(o.id)), [orders, boundIds]);

  /*
   * « Sortis aujourd'hui » grows the instant a parcel leaves. For a second or
   * two it used to be in neither number, and re-scanning to check is exactly
   * what hit Darb's duplicate-key refusal and stranded the parcel.
   */
  const serverScanned = day?.scannedToday ?? page?.scannedToday ?? initialStats.scannedToday;
  const [optimistic, setOptimistic] = useState<{ base: number; n: number } | null>(null);
  const scannedToday = optimistic ? Math.max(serverScanned, optimistic.base + optimistic.n) : serverScanned;
  const setAside = day?.counts.setAside ?? 0;

  const [tab, setTab] = useState<"bench" | "scanned">("bench");
  const [olderOpen, setOlderOpen] = useState(false);
  const [modes, setModes] = useState<Record<string, Mode>>({});

  // The roll last worked, for the free sticker's shortlist. Read after mount:
  // reading storage during render would not match the server's HTML.
  const [lastRoll, setLastRoll] = useState<string | null>(null);
  useEffect(() => {
    try {
      setLastRoll(sessionStorage.getItem(ROLL_KEY));
    } catch {
      // Storage blocked: the shortlist falls back to the queue.
    }
  }, []);
  const remember = useCallback((hex: string | null) => {
    if (!hex) return;
    setLastRoll(hex);
    try {
      sessionStorage.setItem(ROLL_KEY, hex);
    } catch {
      // Storage blocked: remembered for this page only.
    }
  }, []);

  const [sheetOpen, setSheetOpen] = useState(false);
  const scanFlag = search.get("scan") === "1";
  useEffect(() => {
    if (scanFlag) setSheetOpen(true);
  }, [scanFlag]);
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    if (scanFlag) router.replace(pathname);
  }, [scanFlag, router, pathname]);

  const onBound = useCallback(
    (id: string) => {
      setBoundIds((s) => new Set(s).add(id));
      setOptimistic((o) => ({ base: o?.base ?? serverScanned, n: (o?.n ?? 0) + 1 }));
      void mutate();
      void mutateToday();
    },
    [serverScanned, mutate, mutateToday],
  );
  const onUnscanned = useCallback(() => {
    void mutate();
    void mutateToday();
  }, [mutate, mutateToday]);

  /* ── Rolls ──────────────────────────────────────────────────────────── */
  const groups = useMemo<Group[]>(() => {
    if (!isLy) return live.length ? [{ key: "all", hex: null, rows: live }] : [];
    const byKey = new Map<string, Group>();
    for (const o of live) {
      const hex = o.zone.colorHex ? o.zone.colorHex.toLowerCase() : null;
      const key = hex ?? "";
      const g = byKey.get(key) ?? { key, hex, rows: [] };
      g.rows.push(o);
      byKey.set(key, g);
    }
    return [...byKey.values()].sort((a, b) => rank(a.hex) - rank(b.hex));
  }, [isLy, live]);

  const firstKey = groups[0]?.key ?? null;
  const modeOf = (key: string): Mode => modes[key] ?? (key === firstKey ? "few" : "closed");
  const toggle = (key: string) => setModes((m) => ({ ...m, [key]: modeOf(key) === "closed" ? "few" : "closed" }));

  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(uiLocale === "ar" ? "ar-LY" : "fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: MARKET_TIMEZONE[market],
      }).format(new Date()),
    [uiLocale, market],
  );

  const header = (
    <header className="mb-[18px]">
      <p
        data-testid="wh-out-eyebrow"
        dir="auto"
        suppressHydrationWarning
        className="text-[12.5px] font-semibold text-wm-ink-2"
      >
        {[siteName, dateLabel].filter(Boolean).join(" · ")}
      </p>
      <h1 className="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-wm-ink">{t("title")}</h1>
    </header>
  );

  /*
   * No building, no bench. An agent with no site would otherwise be shown both
   * buildings' parcels, and every scan would be refused anyway — so the screen
   * names the reason instead of offering work that cannot be done.
   */
  if (siteUnassigned) {
    return (
      <div className="job-out px-[16px] pt-[18px]">
        {header}
        <div data-testid="wh-bench-no-site" className={`${CARD} px-[16px] py-[24px] text-center`}>
          <p className="text-[16px] font-bold text-wm-ink">{t("noSiteTitle")}</p>
          <p className="mt-[8px] text-[14px] leading-relaxed text-wm-ink-2">{t("noSiteBody")}</p>
        </div>
      </div>
    );
  }

  const tabs: Array<{ key: "bench" | "scanned"; label: string; n: number }> = [
    { key: "bench", label: t("toScan"), n: live.length },
    { key: "scanned", label: t("scannedTab"), n: scannedToday },
  ];

  return (
    <div className="job-out px-[16px] pb-[24px] pt-[18px]">
      {header}

      {/* The driver strip: whether Darb's driver has been, per building. */}
      {isLy ? <PickupSwitch variant="bench" /> : null}

      <div role="tablist" aria-label={t("segments")} className="my-[14px] flex gap-[3px] rounded-[12px] bg-[#ECEDEF] p-[3px]">
        {tabs.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={tab === s.key}
            onClick={() => setTab(s.key)}
            className={`flex-1 rounded-[9px] px-[10px] py-[8px] text-center text-[13.5px] font-semibold ${
              tab === s.key ? "bg-white text-wm-ink" : "text-wm-ink-2"
            }`}
          >
            {s.label}
            <span dir="ltr" className="ms-[4px] text-[12px] tabular-nums text-ink-muted">
              {s.n}
            </span>
          </button>
        ))}
      </div>

      {tab === "scanned" ? (
        <ScannedList isLy={isLy} />
      ) : (
        <>
          {groups.length === 0 ? (
            <p className={`${CARD} px-[16px] py-[20px] text-center text-[14px] text-wm-ink-2`}>{t("emptyBench")}</p>
          ) : (
            <div className={`${CARD} overflow-hidden`}>
              {groups.map((g, gi) => {
                const mode = modeOf(g.key);
                const shown = mode === "all" ? g.rows : mode === "few" ? g.rows.slice(0, FEW) : [];
                const labels = zoneLabels(g.hex, uiLocale);
                return (
                  <div key={g.key || "unknown"}>
                    {isLy ? (
                      <div
                        data-testid="wh-roll-row"
                        data-roll={g.hex ?? ""}
                        className={`flex min-h-[68px] items-center gap-[12px] p-[14px] ${gi > 0 ? "border-t border-line-subtle" : ""}`}
                      >
                        <button
                          type="button"
                          aria-expanded={mode !== "closed"}
                          onClick={() => toggle(g.key)}
                          className="flex min-w-0 flex-1 items-center gap-[12px] text-start"
                        >
                          <span
                            aria-hidden="true"
                            className={`h-[40px] w-[14px] shrink-0 rounded-[5px] ${
                              g.hex ? "shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]" : "border-2 border-dashed border-ink-muted"
                            }`}
                            style={g.hex ? { background: g.hex } : undefined}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15.5px] font-bold text-wm-ink">
                              {g.hex && labels.colour ? t("roll", { colour: labels.colour }) : t("unknownRoll")}
                            </span>
                            <span className="block truncate text-[12.5px] text-wm-ink-2">
                              {g.hex && labels.name ? labels.name : t("unknownZoneHint")}
                            </span>
                          </span>
                          <span
                            data-testid="wh-roll-count"
                            dir="ltr"
                            className="shrink-0 text-[22px] font-bold leading-[1.1] tracking-[-0.02em] tabular-nums text-wm-ink"
                          >
                            {g.rows.length}
                          </span>
                        </button>
                        {/* A parcel with no known roll has no run to start. */}
                        {g.hex ? (
                          <Link
                            href={rollHref(locale, g.hex)}
                            onClick={() => remember(g.hex)}
                            className="shrink-0 whitespace-nowrap rounded-pill bg-job px-[14px] py-[8px] text-[13px] font-bold text-white no-underline"
                          >
                            {t("startRoll")}
                          </Link>
                        ) : null}
                      </div>
                    ) : null}

                    {shown.length > 0 ? (
                      <div className={`bg-surface-sunken ${isLy ? "border-t border-line-subtle" : ""}`}>
                        {shown.map((o, j) => {
                          const age = benchAge(o);
                          const ageText = t(age.key, { n: age.n });
                          return (
                            <Link
                              key={o.id}
                              data-testid="wh-out-parcel"
                              href={runHref(locale, o)}
                              onClick={() => remember(o.zone.colorHex)}
                              className={`flex min-h-[64px] w-full items-center gap-[12px] px-[14px] py-[12px] text-start no-underline ${
                                j > 0 ? "border-t border-line-subtle" : ""
                              }`}
                            >
                              <Thumb size={40} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-wm-ink">
                                  <bdi>{o.product_name}</bdi>{" "}
                                  <span dir="ltr" className="font-bold tabular-nums">×{o.quantity}</span>
                                </span>
                                <span className="block truncate text-[12.5px] text-wm-ink-2">
                                  {o.customer_city ? (
                                    <>
                                      <bdi>{o.customer_city}</bdi>
                                      {" · "}
                                    </>
                                  ) : null}
                                  <bdi>{firstName(o.customer_name)}</bdi>
                                </span>
                              </span>
                              {age.warn ? (
                                <Chip tone="warn" testId="wh-out-age">{ageText}</Chip>
                              ) : (
                                <span data-testid="wh-out-age" data-tone="mute" className="shrink-0 whitespace-nowrap text-[12.5px] text-wm-ink-2">
                                  {ageText}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                        {mode === "few" && g.rows.length > FEW ? (
                          <button
                            type="button"
                            onClick={() => setModes((m) => ({ ...m, [g.key]: "all" }))}
                            className="flex w-full items-center gap-[10px] px-[16px] py-[14px] text-[12.5px] font-semibold text-wm-ink-2"
                          >
                            <ChevronsUpDown size={16} strokeWidth={2} aria-hidden="true" />
                            {t("moreParcels", { n: g.rows.length - FEW })}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {/* Older than ten days: off the queue, still scannable. */}
          {setAside > 0 ? (
            <>
              <button
                type="button"
                data-testid="wh-out-older"
                aria-expanded={olderOpen}
                onClick={() => setOlderOpen((v) => !v)}
                className={`${CARD} mt-[12px] flex w-full items-center gap-[10px] px-[16px] py-[14px] text-start font-semibold text-wm-ink-2`}
              >
                <Clock size={16} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 flex-1">
                  {t("older")} · <b dir="ltr" className="tabular-nums text-wm-ink">{setAside}</b>
                </span>
                <span className="text-[12.5px]">{t("olderHint")}</span>
                <ChevronsUpDown size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ink-muted" />
              </button>
              {olderOpen ? (
                <p className="mt-[8px] px-[4px] text-[12.5px] leading-relaxed text-wm-ink-2">{t("olderBody")}</p>
              ) : null}
            </>
          ) : null}
        </>
      )}

      <ScanSheet
        open={sheetOpen}
        market={market}
        locale={locale}
        orders={live}
        lastRoll={lastRoll}
        onClose={closeSheet}
        onBound={onBound}
        onUnscanned={onUnscanned}
      />
    </div>
  );
}

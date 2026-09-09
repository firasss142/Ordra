"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, PackageOpen, Warehouse } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import { DARB_ZONE_ORDER, zoneLabels } from "@/lib/carriers/darb-zones";
import type { PrepRow } from "@/components/warehouse/console/PrepCard";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { RollRail, type RollKey } from "./RollRail";
import { ScannedList } from "./ScannedList";
import { BenchCard } from "./BenchCard";
import { ScanSheet } from "./ScanSheet";

/**
 * The bench: the agent's home screen.
 *
 * It answers "what do I do now": how many parcels wait and how old the oldest
 * is, which sticker rolls to pick up (with a count each), and which parcel is
 * next, grouped under its roll. The KPI wall that stood here answered "how did
 * the warehouse perform", which is the manager's question, and in Libya read
 * as nine zeros over a two-parcel queue. See plans/warehouse-agent-ux-critique.md.
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
const HAND_KEY = "wh.bench.hand";

function readHand(): string | null {
  try {
    return sessionStorage.getItem(HAND_KEY);
  } catch {
    return null;
  }
}
function storeHand(id: string | null) {
  try {
    if (id) sessionStorage.setItem(HAND_KEY, id);
    else sessionStorage.removeItem(HAND_KEY);
  } catch {
    // Storage blocked: the hand still lives in state for this page.
  }
}

/** Hours become days past two of them; nobody reads "312 h" as thirteen days. */
function ageLabel(hours: number, t: (k: "hours" | "days", v: { n: number }) => string): string {
  return hours >= 48 ? t("days", { n: Math.floor(hours / 24) }) : t("hours", { n: Math.round(hours) });
}

export function BenchHome({
  market,
  locale,
  currency,
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
  /**
   * The building this bench belongs to, named.
   *
   * The coloured plate on each card is `toBranchGroup` — the DESTINATION
   * branch, not the account the parcel was booked on — so two parcels bound for
   * Sebha look identical whether they came from Tripoli or Benghazi. Naming the
   * site once, at the top, is what tells the agent where they are standing.
   */
  siteName?: string | null;
  /** Nobody has assigned this agent to a building: there is no work to show. */
  siteUnassigned?: boolean;
}) {
  const t = useTranslations("warehouse.bench");
  const tAge = useTranslations("warehouse.age");
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
  const { data: summary } = useSWR<{ queue?: { toHandOver?: number } }>("/api/warehouse/summary", jsonFetcher, {
    fallbackData: { queue: { toHandOver: initialStats.toHandOver } },
  });

  const orders = useMemo(() => page?.orders ?? [], [page]);
  // Local bookkeeping between two revalidations: a bound parcel leaves the
  // list and counts as a scan the moment the server says so, not thirty
  // seconds later when the cached page refreshes.
  const [boundIds, setBoundIds] = useState<Set<string>>(() => new Set());
  const [localScans, setLocalScans] = useState(0);
  const live = useMemo(() => orders.filter((o) => !boundIds.has(o.id)), [orders, boundIds]);

  const [filter, setFilter] = useState<RollKey>(null);
  const [handId, setHandId] = useState<string | null>(() => readHand());
  // The roll the agent last reached for. Survives the bind that clears the
  // hand, so "next" can prefer the roll still in their other hand.
  const [lastHex, setLastHex] = useState<string | null>(null);
  const hand = useMemo(() => live.find((o) => o.id === handId) ?? null, [live, handId]);

  /*
   * Two moments, one screen. "À préparer" is the queue; "Scannés" is what
   * happened to the parcels that already left it — a question the bench simply
   * could not ask before, while eight of twenty parcels scanned on 2026-09-08
   * were carrying a number Darb was not holding.
   */
  const [tab, setTab] = useState<"bench" | "scanned">("bench");
  const [sheetOpen, setSheetOpen] = useState(false);
  const scanFlag = search.get("scan") === "1";
  useEffect(() => {
    if (scanFlag) setSheetOpen(true);
  }, [scanFlag]);

  const setHand = useCallback((row: PrepRow | null) => {
    setHandId(row?.id ?? null);
    storeHand(row?.id ?? null);
  }, []);

  const take = useCallback(
    (row: PrepRow) => {
      setHand(row);
      setLastHex(row.zone.colorHex);
      setSheetOpen(true);
    },
    [setHand],
  );

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    if (scanFlag) router.replace(pathname);
  }, [scanFlag, router, pathname]);

  const putBack = useCallback(() => {
    setHand(null);
    closeSheet();
  }, [setHand, closeSheet]);

  const onBound = useCallback(() => {
    if (handId) setBoundIds((s) => new Set(s).add(handId));
    setLocalScans((n) => n + 1);
    setHand(null);
    void mutate();
  }, [handId, setHand, mutate]);

  /* ── Grouping ───────────────────────────────────────────────────────── */
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    let unknown = 0;
    for (const o of live) {
      const hex = o.zone.colorHex;
      if (hex) c[hex] = (c[hex] ?? 0) + 1;
      else unknown += 1;
    }
    return { byHex: c, unknown };
  }, [live]);

  const shown = useMemo(
    () =>
      filter === null
        ? live
        : filter === "unknown"
          ? live.filter((o) => o.zone.colorHex === null)
          : live.filter((o) => o.zone.colorHex === filter),
    [live, filter],
  );

  const groups = useMemo(() => {
    if (!isLy) return null;
    const order: Array<string | null> = [...DARB_ZONE_ORDER, null];
    return order
      .map((hex) => ({ hex, rows: shown.filter((o) => o.zone.colorHex === hex) }))
      .filter((g) => g.rows.length > 0);
  }, [isLy, shown]);

  // After a bind the red roll is still in the agent's hand: same roll first.
  const next = useMemo(() => {
    const rest = live.filter((o) => o.id !== handId);
    return rest.find((o) => lastHex !== null && o.zone.colorHex === lastHex) ?? rest[0] ?? null;
  }, [live, handId, lastHex]);

  const waiting = live.length;
  const oldestHours = page?.oldestHours ?? initialStats.oldestHours;
  const scannedToday = (page?.scannedToday ?? initialStats.scannedToday) + localScans;
  const carrierWarehouse = page?.carrierWarehouse ?? initialStats.carrierWarehouse;
  const toHandOver = summary?.queue?.toHandOver ?? initialStats.toHandOver;

  /*
   * No building, no bench. The queue is empty on purpose — an agent with no site
   * would otherwise be shown both buildings' parcels, which is how a Benghazi
   * parcel ends up handed to Darb Tripoli. Every scan would be refused anyway,
   * so offering the camera would be a trap; the screen names the reason instead.
   */
  if (siteUnassigned) {
    return (
      <div className="px-4 py-4">
        <h1 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-wm-ink">{t("title")}</h1>
        <div
          data-testid="wh-bench-no-site"
          className="mt-4 rounded-[14px] border border-wm-card-edge bg-wm-card px-4 py-6 text-center"
        >
          <p className="text-[16px] font-bold text-wm-ink">{t("noSiteTitle")}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-wm-ink-2">{t("noSiteBody")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between gap-2.5">
        <h1 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-wm-ink">{t("title")}</h1>
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-wm-card-edge bg-wm-card py-0.5 pe-2.5 ps-1 text-[13px] text-wm-ink-2">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-wm-accent-soft text-wm-accent">
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />
          </span>
          {t("scannedToday")} <b data-testid="wh-bench-scanned" className="tabular-nums text-wm-ink">{scannedToday}</b>
        </span>
      </div>

      {/* The building. Only where there is more than one to confuse it with. */}
      {siteName ? (
        <p
          data-testid="wh-bench-site"
          className="mt-1 flex items-center gap-1.5 text-[13.5px] font-semibold text-wm-ink-2"
        >
          <Warehouse size={14} strokeWidth={2} aria-hidden="true" />
          {siteName}
        </p>
      ) : null}

      {/* ── The one figure ───────────────────────────────────────────── */}
      <div
        data-testid="wh-bench-hero"
        className="relative mt-3 grid grid-cols-[auto_1fr] items-start gap-3.5 rounded-[14px] border border-wm-card-edge bg-wm-card px-3.5 pb-4 pt-3.5"
      >
        <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-wm-accent-soft text-wm-accent">
          <PackageOpen size={22} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[34px] font-bold leading-none tabular-nums text-wm-accent">{waiting}</p>
          <p className="mt-1 text-[12.5px] font-bold text-wm-ink-2">{t("waiting", { n: waiting })}</p>
          {waiting > 0 ? (
            <p className="text-[14px] text-wm-ink-2">{t("oldest", { age: ageLabel(oldestHours, tAge) })}</p>
          ) : carrierWarehouse > 0 ? (
            <p data-testid="wh-bench-carrier-warehouse" className="text-[14px] text-wm-ink-2">
              {t("carrierWarehouse", { n: carrierWarehouse })}
            </p>
          ) : null}
        </div>
        <span aria-hidden="true" className="absolute inset-x-3.5 bottom-2 h-[3px] overflow-hidden rounded-pill bg-wm-track">
          <i
            className="block h-full bg-wm-accent"
            style={{ width: `${Math.round((scannedToday / (scannedToday + waiting || 1)) * 100)}%` }}
          />
        </span>
      </div>

      <SegmentedTabs
        className="mt-3.5"
        size="sm"
        role="tablist"
        ariaLabel={t("segments")}
        value={tab}
        onChange={(k) => setTab(k as "bench" | "scanned")}
        segments={[
          { key: "bench", label: t("segmentBench"), count: waiting },
          { key: "scanned", label: t("segmentScanned"), count: toHandOver },
        ]}
      />

      {tab === "scanned" ? <ScannedList isLy={isLy} /> : (
      <>
      {/* ── Which rolls to pick up ───────────────────────────────────── */}
      {isLy && waiting > 0 ? (
        <>
          <p className="mb-2 mt-4 text-[13px] font-semibold text-wm-ink-2">{t("rollsNow")}</p>
          <RollRail
            counts={counts.byHex}
            unknown={counts.unknown}
            total={waiting}
            selected={filter}
            onSelect={setFilter}
          />
        </>
      ) : null}

      {/* ── The parcels ──────────────────────────────────────────────── */}
      {groups ? (
        groups.length === 0 ? (
          <p className="py-5 text-[14px] text-wm-ink-2">{t("emptyRoll")}</p>
        ) : (
          groups.map((g) => {
            const labels = zoneLabels(g.hex, uiLocale);
            return (
              <section key={g.hex ?? "unknown"} data-testid="wh-bench-group" data-roll={g.hex ?? ""} className="mt-3">
                <div className="sticky top-0 z-[2] flex items-center gap-2.5 bg-wm-ground py-1.5">
                  <span
                    aria-hidden="true"
                    className={`h-[30px] w-3 shrink-0 rounded-[4px] ${g.hex ? "" : "border-2 border-dashed border-wm-ink-3"}`}
                    style={{ background: g.hex ?? "transparent" }}
                  />
                  <span className="text-[16px] font-bold text-wm-ink">{labels.colour ?? t("unknownRoll")}</span>
                  <span className="min-w-0 truncate text-[13.5px] text-wm-ink-2">
                    {labels.name ? `· ${labels.name}` : `· ${t("unknownZoneHint")}`}
                  </span>
                  <span
                    data-testid="wh-bench-plate"
                    dir="ltr"
                    className={`ms-auto shrink-0 rounded-[6px] px-2 text-[13px] font-bold tracking-[0.04em] text-wm-ink ${g.hex ? "bg-white" : "bg-wm-track"}`}
                  >
                    {g.rows[0].zone.branchGroup ?? "?"}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {g.rows.map((o) => (
                    <BenchCard key={o.id} row={o} isLy held={o.id === handId} currency={currency} onTake={take} />
                  ))}
                </div>
              </section>
            );
          })
        )
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {shown.map((o) => (
            <BenchCard key={o.id} row={o} isLy={false} held={o.id === handId} currency={currency} onTake={take} />
          ))}
        </div>
      )}

      {/* ── Scanned, waiting for the carrier ─────────────────────────── */}
      <button
        type="button"
        data-testid="wh-bench-pickup"
        onClick={() => setTab("scanned")}
        className="mt-5 w-full border-t border-wm-card-edge pt-3 text-start text-[14px] font-semibold text-wm-ink-2 underline decoration-dotted underline-offset-4"
      >
        {t("pickup", { n: toHandOver })}
      </button>
      </>
      )}

      <ScanSheet
        open={sheetOpen}
        market={market}
        hand={hand}
        orders={live}
        currency={currency}
        next={next}
        onTakeNext={take}
        onPutBack={putBack}
        onClose={closeSheet}
        onBound={onBound}
      />
    </div>
  );
}

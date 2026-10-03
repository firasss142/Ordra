"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ScanLine, X } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { PrepRow } from "@/components/warehouse/console/PrepCard";
import type { ScannedRow } from "@/app/api/warehouse/scanned/route";
import type { WarehouseSitesResponse } from "@/app/api/warehouse/sites/route";
import { DARB_ZONE_ORDER, zoneLabels } from "@/lib/carriers/darb-zones";
import { MARKET_TIMEZONE } from "@/lib/markets";
import { isDarbStickerPayload } from "@/lib/preparation/sticker-payload";
import { readScannerPrefs, signalOutcome } from "@/lib/warehouse/scanner-prefs";
import { RunViewfinder } from "@/components/warehouse/run/RunViewfinder";
import { OutcomeCard, StockChip, Thumb } from "@/components/warehouse/run/RunOutcome";
import { BTN_DANGER, BTN_GHOST, BTN_PRI, BTN_SEC, CARD, MONO, XL } from "@/components/warehouse/run/ui";
import { useScanOut, type ScanOutEntry } from "./useScanOut";
import { canUnscan, useScannedActions } from "./useScannedActions";
import { benchAge, firstName, runHref } from "./bench-format";

/**
 * The centre Scan button with nothing in hand (prototype `sheet()`).
 *
 * « Scannez n'importe quel sticker »: the scan says what the sticker is, and
 * each answer leads to its own next act —
 *
 *   already scanned   when, who, whether Darb has it, and Dé-scanner while it can
 *   a return          straight to Rentrer, on that parcel
 *   another building  « Ne le scannez pas ici »
 *   one of my parcels « Dans votre file » → the run on that parcel
 *   a free sticker    « Sur quel colis l'avez-vous collé ? » → the ordinary bind
 *
 * A FREE STICKER IS AN INFERENCE. The lookup (`find_return_by_code`) answers
 * `not_found` for anything it cannot match; Darb's stickers are pre-printed bare
 * numbers that only become known to us once bound. So "a bare number nobody
 * holds" is the free sticker, and anything else nobody holds is unknown. The
 * bind that follows is the same POST as the run's, with every guard of it.
 */

interface LookupBody {
  outcome: "found" | "wrong_status" | "ambiguous" | "not_found" | "empty";
  order?: WarehouseOrderRow & { warehouse_id?: string | null };
  status?: string;
  matches?: number;
}

type View =
  | { kind: "scan" }
  | { kind: "already"; code: string; row: ScannedRow }
  | { kind: "queue"; code: string; row: PrepRow }
  | { kind: "known"; code: string; order: WarehouseOrderRow; status: string }
  | { kind: "unknown"; code: string; matches?: number }
  | { kind: "wrong"; code: string; order: WarehouseOrderRow; warehouse: string }
  | { kind: "free"; code: string };

const RETURN_STATUSES = new Set(["to_be_returned", "returning"]);
const SCANNED_STATUSES = new Set(["scanned", "at_carrier"]);

export interface ScanSheetProps {
  open: boolean;
  market: "ly" | "tn";
  locale: string;
  /** The bench as it stands: the parcels a free sticker can go on. */
  orders: PrepRow[];
  /** The roll the agent last worked (hex), for the free sticker's shortlist. */
  lastRoll: string | null;
  onClose: () => void;
  /** A parcel left the bench through this sheet. */
  onBound: (orderId: string) => void;
  /** A parcel came back to the bench through Dé-scanner. */
  onUnscanned?: () => void;
}

export function ScanSheet(props: ScanSheetProps) {
  // Unmounted when closed, so every opening starts from a clean scan.
  return props.open ? <LookupSheet {...props} /> : null;
}

/** Darb's poster order, then the parcels with no known roll. */
function inRollOrder(rows: PrepRow[]): PrepRow[] {
  const rank = (hex: string | null) => {
    const i = hex ? DARB_ZONE_ORDER.indexOf(hex.toLowerCase()) : -1;
    return i === -1 ? DARB_ZONE_ORDER.length : i;
  };
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r.zone.colorHex) - rank(b.r.zone.colorHex) || a.i - b.i)
    .map(({ r }) => r);
}

function LookupSheet({ market, locale, orders, lastRoll, onClose, onBound, onUnscanned }: ScanSheetProps) {
  const t = useTranslations("warehouse.bench");
  const ts = useTranslations("warehouse.scan");
  const tScanned = useTranslations("warehouse.scanned");
  const tStatus = useTranslations("orders.statuses");
  const uiLocale = useLocale();
  const router = useRouter();
  const isLy = market === "ly";

  const prefs = useMemo(() => readScannerPrefs(), []);
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const [looking, setLooking] = useState(false);
  const [view, setView] = useState<View>({ kind: "scan" });
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const sitesRef = useRef<WarehouseSitesResponse | null>(null);

  const scanned = useScannedActions();

  // The free sticker's shortlist: the next parcels of the roll in hand, or of
  // the queue when no roll was worked yet.
  const queue = useMemo(() => inRollOrder(orders), [orders]);
  const rollRows = useMemo(
    () => (lastRoll ? queue.filter((o) => o.zone.colorHex === lastRoll) : []),
    [queue, lastRoll],
  );
  const shortlist = showAll ? queue : (rollRows.length > 0 ? rollRows : queue).slice(0, 3);
  const chosen = shortlist.find((o) => o.id === chosenId) ?? null;

  /*
   * The bind. Libya binds the sticker to the parcel the agent CHOSE; Tunisia's
   * QR is the order id and resolves itself against the bench.
   */
  // The parcel the bind is about, held past the moment it leaves `orders`.
  const boundRef = useRef<PrepRow | null>(null);
  const onScanned = useCallback(() => {
    if (boundRef.current) onBound(boundRef.current.id);
  }, [onBound]);
  const { submit, busy, last, clear } = useScanOut({ market, hand: isLy ? chosen : null, orders, onScanned });

  const lastId = last?.id;
  useEffect(() => {
    if (lastId && last) signalOutcome(last.outcome, prefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  // Dé-scanner landed: the parcel is back on the bench.
  const flashText = scanned.flash?.tone === "ok" ? scanned.flash.text : null;
  useEffect(() => {
    if (flashText) onUnscanned?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashText]);

  const ownBuilding = useCallback(async (): Promise<WarehouseSitesResponse | null> => {
    if (sitesRef.current) return sitesRef.current;
    try {
      const res = await fetch("/api/warehouse/sites");
      if (!res.ok) return null;
      sitesRef.current = (await res.json()) as WarehouseSitesResponse;
      return sitesRef.current;
    } catch {
      return null;
    }
  }, []);

  const resolve = useCallback(
    async (code: string, body: LookupBody) => {
      const order = body.outcome === "found" || body.outcome === "wrong_status" ? body.order : undefined;
      const status = body.outcome === "found" ? "to_be_returned" : (body.status ?? order?.status ?? "");

      if (!order) {
        if (body.outcome === "not_found" && isLy && isDarbStickerPayload(code)) {
          setChosenId(null);
          setShowAll(false);
          setView({ kind: "free", code });
          return;
        }
        setView({ kind: "unknown", code, matches: body.outcome === "ambiguous" ? body.matches : undefined });
        signalOutcome("refused_here", prefs);
        return;
      }

      // A return is received on Rentrer, never here.
      if (RETURN_STATUSES.has(status)) {
        onClose();
        router.push(`/${locale}/warehouse/returns?order=${order.id}`);
        return;
      }

      signalOutcome("lookup", prefs);

      // Another building — only on positive evidence: the lookup names the
      // parcel's building and it is not the agent's own.
      if (order.warehouse_id) {
        const sites = await ownBuilding();
        if (sites?.mine && sites.mine !== order.warehouse_id) {
          const name = sites.sites.find((s) => s.id === order.warehouse_id)?.name ?? "—";
          setView({ kind: "wrong", code, order, warehouse: name });
          return;
        }
      }

      if (SCANNED_STATUSES.has(status)) {
        let row = scanned.data?.orders.find((o) => o.id === order.id);
        if (!row) row = (await scanned.mutate())?.orders.find((o) => o.id === order.id);
        setView(row ? { kind: "already", code, row } : { kind: "known", code, order, status });
        return;
      }

      const mine = orders.find((o) => o.id === order.id);
      setView(mine ? { kind: "queue", code, row: mine } : { kind: "known", code, order, status });
    },
    [isLy, prefs, onClose, router, locale, ownBuilding, scanned, orders],
  );

  const lookup = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code || looking || busy) return;
      setValue("");
      clear();

      // Tunisia: our own label QR is the order id. On the bench, it scans out.
      if (!isLy) {
        const hit = orders.find((o) => o.id === code || o.id.startsWith(code));
        if (hit) {
          boundRef.current = hit;
          setView({ kind: "scan" });
          void submit(code);
          return;
        }
      }

      setLooking(true);
      try {
        const res = await fetch(`/api/warehouse/returns/lookup?code=${encodeURIComponent(code)}`);
        const body = res.ok ? ((await res.json()) as LookupBody) : ({ outcome: "not_found" } as LookupBody);
        if (body.outcome === "empty") return;
        await resolve(code, body);
      } catch {
        setView({ kind: "unknown", code });
      } finally {
        setLooking(false);
      }
    },
    [looking, busy, clear, isLy, orders, submit, resolve],
  );

  const bindFree = useCallback(() => {
    if (view.kind !== "free" || !chosen || busy) return;
    boundRef.current = chosen;
    void submit(view.code);
  }, [view, chosen, busy, submit]);

  // The preselected parcel, as the prototype has it — the explicit tap on
  // « C'est bien ce colis — lier » is the confirmation, not the radio.
  const firstShort = shortlist[0]?.id ?? null;
  useEffect(() => {
    if (view.kind === "free" && chosenId === null && firstShort) setChosenId(firstShort);
  }, [view.kind, chosenId, firstShort]);

  const backToScan = () => {
    clear();
    setView({ kind: "scan" });
  };

  const tz = MARKET_TIMEZONE[market];
  const timeOf = (iso: string) =>
    new Intl.DateTimeFormat(uiLocale === "ar" ? "ar-LY" : "fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: tz,
    }).format(new Date(iso));

  const place = (o: { product_name: string; customer_city: string | null }) => (
    <>
      <bdi>{o.product_name}</bdi>
      {o.customer_city ? (
        <>
          {" · "}
          <bdi>{o.customer_city}</bdi>
        </>
      ) : null}
    </>
  );

  /* ── What to draw ─────────────────────────────────────────────────── */
  let body: React.ReactNode;

  if (last) {
    body = (
      <BindResult
        entry={last}
        parcel={boundRef.current}
        onClose={onClose}
        onRetry={() => clear()}
        onAgain={backToScan}
      />
    );
  } else if (view.kind === "free") {
    const colour = lastRoll && rollRows.length > 0 ? zoneLabels(rollRows[0].zone, uiLocale).colour : null;
    body = (
      <div data-testid="wh-sheet-free">
        <SheetTop eyebrow={t("scan")} title={t("freeT")} back={t("back")} onBack={backToScan} />
        <div className={`${CARD} flex items-center gap-[12px] p-[16px]`}>
          <span aria-hidden="true" className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-[10px] bg-job-bg text-job-ink">
            <ScanLine size={18} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p dir="ltr" className={`text-start text-[24px] font-semibold tracking-[.04em] text-wm-ink ${MONO}`}>{view.code}</p>
            <p className="text-[12.5px] text-wm-ink-2">{t("freeNone")}</p>
          </div>
        </div>
        <h3 className="mb-[4px] mt-[20px] text-[17px] font-bold text-wm-ink">{t("freeQ")}</h3>
        <p className="mb-[12px] text-[12.5px] text-wm-ink-2">
          {colour ? t("freeHint", { colour }) : t("freeHintAny")}
        </p>
        {shortlist.length === 0 ? (
          <p className="py-[12px] text-center text-[14px] text-wm-ink-2">{t("emptyBench")}</p>
        ) : (
          <div role="radiogroup" aria-label={t("freeQ")} className="flex flex-col gap-[8px]">
            {shortlist.map((o) => {
              const on = o.id === chosenId;
              const age = benchAge(o);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setChosenId(o.id)}
                  className={`flex w-full items-center gap-[12px] rounded-[12px] border-[1.5px] p-[14px] text-start ${
                    on ? "border-brand bg-brand-tint" : "border-line bg-white"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full border-2 ${on ? "border-brand" : "border-[var(--border-strong)]"}`}
                  >
                    {on ? <span className="h-[10px] w-[10px] rounded-full bg-brand" /> : null}
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-[32px] w-[10px] shrink-0 rounded-[5px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]"
                    style={{ background: o.zone.colorHex ?? "transparent" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-wm-ink">
                      <bdi>{o.product_name}</bdi> <span dir="ltr" className="tabular-nums">×{o.quantity}</span>
                    </span>
                    <span className="block truncate text-[12.5px] text-wm-ink-2">
                      {o.customer_city ? <><bdi>{o.customer_city}</bdi>{" · "}</> : null}
                      <bdi>{firstName(o.customer_name)}</bdi>
                      {" · "}
                      {t(age.key, { n: age.n })}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {!showAll && queue.length > shortlist.length ? (
          <button type="button" onClick={() => setShowAll(true)} className={`${BTN_GHOST} mt-[6px] w-full`}>
            {t("seeAll")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={bindFree}
          disabled={!chosen || busy}
          className={`${BTN_PRI} ${XL} mt-[10px] w-full`}
        >
          {busy ? ts("binding") : t("confirmBind")}
        </button>
      </div>
    );
  } else if (view.kind === "wrong") {
    body = (
      <>
        <SheetTop eyebrow={t("title")} title={t("scan")} back={t("back")} onBack={backToScan} />
        <OutcomeCard
          tone="bad"
          outcome="wrong_site"
          title={t("wrongT")}
          body={t("wrongB", { warehouse: view.warehouse })}
          code={view.code}
          codeSize={22}
          sub={place(view.order)}
          testId="wh-sheet-result"
        />
        <button type="button" onClick={onClose} className={`${BTN_SEC} ${XL} mt-[16px] w-full`}>
          {t("ok")}
        </button>
      </>
    );
  } else {
    body = (
      <>
        <div className="mb-[12px] flex items-center gap-[12px]">
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-bold text-wm-ink">{t("lookT")}</h2>
            <p className="text-[12.5px] text-wm-ink-2">{t("lookB")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full border border-line bg-white text-wm-ink"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <RunViewfinder
          hex={null}
          camera={camera}
          onToggle={() => setCamera((c) => !c)}
          onScan={(text) => void lookup(text)}
          busyLabel={busy ? (isLy ? ts("binding") : ts("bindingTn")) : null}
          className="mt-0"
          testId="wh-sheet-viewfinder"
        />

        <div className="mt-[12px] flex gap-[8px]">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void lookup(value);
              }
            }}
            inputMode={isLy ? "numeric" : "text"}
            autoComplete="off"
            dir="ltr"
            aria-label={ts("stickerNumber")}
            placeholder={isLy ? t("typeNumber") : t("typeQr")}
            className={`h-[48px] min-w-0 flex-1 rounded-[12px] border border-[var(--border-strong)] bg-white px-[14px] text-start text-[16px] text-wm-ink outline-none placeholder:text-wm-ink-3 focus:border-brand ${MONO}`}
          />
          <button type="button" onClick={() => void lookup(value)} disabled={looking || busy} className={BTN_SEC}>
            {t("scan")}
          </button>
        </div>

        {view.kind === "already" ? (
          <div data-testid="wh-sheet-already" className={`${CARD} mt-[12px] p-[16px]`}>
            <div className="flex items-center gap-[12px]">
              <Thumb size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-wm-ink">{place(view.row)}</p>
                <p className="text-[12.5px] text-wm-ink-2">
                  {view.row.scanned_at
                    ? `${t("outAlready", { time: timeOf(view.row.scanned_at), who: view.row.scanned_by_name ?? "—" })} · `
                    : ""}
                  {canUnscan(view.row) ? t("notTaken") : t("taken")}
                </p>
              </div>
            </div>
            {canUnscan(view.row) ? (
              <button
                type="button"
                disabled={scanned.busyId === view.row.id}
                onClick={() => void scanned.unscan(view.row)}
                className={`${BTN_DANGER} mt-[12px] w-full`}
              >
                {tScanned("unscan")}
              </button>
            ) : null}
            {scanned.flash ? (
              <p
                role="status"
                className={`mt-[8px] text-center text-[13px] font-semibold ${scanned.flash.tone === "ok" ? "text-wh-ok" : "text-wh-bad"}`}
              >
                {scanned.flash.text}
              </p>
            ) : null}
          </div>
        ) : view.kind === "queue" ? (
          <div data-testid="wh-sheet-queue" className={`${CARD} mt-[12px] p-[16px]`}>
            <div className="flex items-center gap-[12px]">
              <Thumb size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-wm-ink">{place(view.row)}</p>
                <p className="text-[12.5px] text-wm-ink-2">{t("inQueue")}</p>
              </div>
            </div>
            <Link href={runHref(locale, view.row)} className={`${BTN_PRI} mt-[12px] w-full no-underline`}>
              {t("takeInHand")}
            </Link>
          </div>
        ) : view.kind === "known" ? (
          <div data-testid="wh-sheet-known" className={`${CARD} mt-[12px] flex items-center gap-[12px] p-[16px]`}>
            <Thumb size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold text-wm-ink">{place(view.order)}</p>
              <p className="text-[12.5px] text-wm-ink-2">
                <span dir="ltr" className={MONO}>{view.code}</span>
                {view.status ? ` · ${tStatus(view.status)}` : ""}
              </p>
            </div>
          </div>
        ) : view.kind === "unknown" ? (
          <div data-testid="wh-sheet-unknown" className={`${CARD} mt-[12px] p-[16px] text-center`}>
            <p dir="ltr" className={`text-[22px] font-semibold tracking-[.04em] text-wm-ink ${MONO}`}>{view.code}</p>
            <p className="mt-[4px] text-[15px] font-semibold text-wm-ink">
              {view.matches ? t("lookupAmbiguous", { n: view.matches }) : t("lookupUnknown")}
            </p>
            {view.matches ? null : <p className="mt-[2px] text-[12.5px] text-wm-ink-2">{t("lookupUnknownHint")}</p>}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div
        data-testid="wh-sheet-scrim"
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-[rgba(26,26,26,.45)]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("lookT")}
        className="job-out fixed inset-x-0 bottom-0 z-[61] max-h-[92vh] overflow-y-auto rounded-t-[20px] bg-white px-[16px] pb-[calc(24px+env(safe-area-inset-bottom,0px))] pt-[10px]"
      >
        <span aria-hidden="true" className="mx-auto mb-[12px] block h-[4px] w-[40px] rounded-[2px] bg-line" />
        {body}
      </div>
    </>
  );
}

/** The prototype's `.top` with a back button, as R.free and R.wrongsite draw it. */
function SheetTop({ eyebrow, title, back, onBack }: { eyebrow: string; title: string; back: string; onBack: () => void }) {
  return (
    <div className="mb-[18px] flex items-center gap-[12px]">
      <button
        type="button"
        onClick={onBack}
        aria-label={back}
        className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full border border-line bg-white text-wm-ink"
      >
        <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" className="rtl:-scale-x-100" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-wm-ink-2">{eyebrow}</p>
        <h2 className="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-wm-ink">{title}</h2>
      </div>
    </div>
  );
}

/**
 * What the free sticker's bind turned into — the run's outcomes, unchanged:
 * green when the parcel left, amber when Darb holds the sticker but somebody
 * must read this, red with Darb's own words on a refusal, and the
 * wrong-building card when the server says the parcel is not ours to scan.
 */
function BindResult({
  entry,
  parcel,
  onClose,
  onRetry,
  onAgain,
}: {
  entry: ScanOutEntry;
  parcel: PrepRow | null;
  onClose: () => void;
  onRetry: () => void;
  onAgain: () => void;
}) {
  const t = useTranslations("warehouse.bench");
  const ts = useTranslations("warehouse.scan");
  const tr = useTranslations("warehouse.run");

  const sub = parcel ? (
    <>
      <bdi>{parcel.product_name}</bdi>
      {parcel.customer_city ? (
        <>
          {" · "}
          <bdi>{parcel.customer_city}</bdi>
        </>
      ) : null}
    </>
  ) : undefined;

  const refused = entry.outcome === "refused_here" || entry.outcome === "refused_darb";
  if (refused && entry.errorCode === "WRONG_SITE") {
    return (
      <>
        <OutcomeCard
          tone="bad"
          outcome="wrong_site"
          title={t("wrongT")}
          body={t("wrongB", { warehouse: entry.warehouseName ?? "—" })}
          code={entry.code}
          codeSize={22}
          sub={sub}
          testId="wh-sheet-result"
        />
        <button type="button" onClick={onClose} className={`${BTN_SEC} ${XL} mt-[16px] w-full`}>
          {t("ok")}
        </button>
      </>
    );
  }

  const committed = entry.outcome === "bound" || entry.outcome === "bind_unverified";
  const tone = entry.outcome === "bound" ? "ok" : refused ? "bad" : "warn";
  const title =
    entry.outcome === "bound"
      ? tr("bound")
      : entry.outcome === "bind_unverified"
        ? ts("errBindUnverified")
        : entry.outcome === "bound_not_committed"
          ? ts("errBoundNotCommitted")
          : entry.outcome === "refused_darb"
            ? ts("errCarrier")
            : ts("errRefused");
  const body =
    entry.outcome === "bind_unverified"
      ? t("unverifiedHint", { ref: entry.carrierRef ?? "—" })
      : entry.outcome === "bound_not_committed"
        ? [entry.message, t("notCommittedHint")].filter(Boolean).join(" ")
        : refused
          ? entry.message
          : undefined;

  return (
    <>
      <OutcomeCard
        tone={tone}
        outcome={entry.outcome}
        title={title}
        body={body}
        code={entry.code}
        sub={sub}
        testId="wh-sheet-result"
      >
        {committed ? <StockChip from={entry.from} to={entry.to} /> : null}
      </OutcomeCard>
      {/* Where the parcel went: agents re-scanned to check, which is exactly
          what hit Darb's duplicate-key refusal and stranded the parcel. */}
      {committed ? (
        <p data-testid="wh-sheet-moved" className="mt-[8px] text-center text-[13px] font-semibold text-wh-ok">
          {t("movedToScanned")}
        </p>
      ) : null}
      <div className="mt-[16px] flex gap-[12px]">
        <button type="button" onClick={onClose} className={`${BTN_SEC} flex-1`}>
          {t("close")}
        </button>
        {committed ? (
          <button type="button" onClick={onAgain} className={`${BTN_PRI} flex-1`}>
            {t("scan")}
          </button>
        ) : refused ? (
          <button type="button" onClick={onRetry} className={`${BTN_PRI} flex-1`}>
            {t("retry")}
          </button>
        ) : null}
      </div>
    </>
  );
}

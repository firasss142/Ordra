"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { jsonFetcher } from "@/lib/fetchers";
import { zoneLabels } from "@/lib/carriers/darb-zones";
import { ageTone, benchAge, rollCounts } from "@/lib/warehouse/desk";
import type { ToLabelQueuePage, ToLabelRow } from "@/app/api/warehouse/to-label/route";
import type { ScannedRow } from "@/app/api/warehouse/scanned/route";
import type { PickupSiteState } from "@/app/api/warehouse/pickup/route";
import { useScanOut } from "@/components/warehouse/bench/useScanOut";
import { canUnscan, useScannedActions } from "@/components/warehouse/bench/useScannedActions";
import { QrScanner } from "@/components/warehouse/QrScanner";
import {
  DeskHeader, DeskPage, Empty, Ic, LiveSub, Pager, RollDot, SearchLine, SiteSeg, Tag, Thumb, Tile, Tiles, fnum, usePaged, useToast,
} from "./ui";
import { useDeskSite } from "./useDeskSite";
import { useXDeliveryLabels } from "@/hooks/useXDeliveryLabels";

/**
 * Entrepôt › Sortir, on the desk (prototypes/entrepot-desk-v1.html).
 *
 * One question: which parcels leave now. Three counted tiles that filter, the
 * roll line, one list. « Prendre » puts a parcel in hand and arms the scan bar
 * with the roll to reach for; a bound sticker takes the next parcel of the SAME
 * roll, because that is the roll already in the operator's hand.
 *
 * The « chauffeur est passé » switch lives here and only here — Aujourd'hui
 * says its state, without a button.
 */

/** Carrier states that mean the parcel already left. It cannot be scanned. */
const GONE_AT_CARRIER = new Set(["released", "completed", "returning", "returned"]);

type TileKey = "todo" | "late" | "done";

const hoursOn = (o: ToLabelRow) => Math.max(0, (Date.now() - new Date(o.uploaded_at ?? o.created_at).getTime()) / 3_600_000);

export function OutDesk({
  market,
  dateLabel,
  today,
  initialOrders,
  initialSiteId,
}: {
  market: "ly" | "tn";
  dateLabel: string;
  /** The market's local date, YYYY-MM-DD — « sortis aujourd'hui » is that day. */
  today: string;
  initialOrders: ToLabelRow[];
  /** The building the server painted `initialOrders` for. */
  initialSiteId: string | null;
}) {
  const t = useTranslations("warehouse.desk");
  const to = useTranslations("warehouse.desk.out");
  const locale = useLocale();
  const format = useFormatter();
  const isLy = market === "ly";
  const { sites, siteId, setSite, nameOf } = useDeskSite();
  const [toast, showToast] = useToast();

  const queueKey = `/api/warehouse/to-label?limit=200${siteId ? `&warehouse_id=${siteId}` : ""}`;
  const { data, mutate } = useSWR<ToLabelQueuePage>(queueKey, jsonFetcher, {
    fallbackData: siteId === initialSiteId ? ({ orders: initialOrders } as unknown as ToLabelQueuePage) : undefined,
    revalidateOnFocus: true,
    refreshInterval: 60_000,
  });
  const scanned = useScannedActions(siteId);
  const { data: pickup, mutate: mutatePickup } = useSWR<{ sites?: PickupSiteState[] }>(
    isLy ? "/api/warehouse/pickup" : null,
    jsonFetcher,
    { refreshInterval: 60_000 },
  );

  // X-Delivery labels (prototypes/xdelivery-label-v1.html): Tunisia only, and only where a
  // building ships X-Delivery — the column and the pill mean nothing elsewhere.
  const xd = useXDeliveryLabels(!isLy);
  const xdOn = !isLy && xd.summary?.enabled === true;
  const xdToPrint = useMemo(() => new Set(xd.summary?.toPrint ?? []), [xd.summary]);
  const xdPrinted = xd.summary?.printed ?? {};
  const printLabels = useCallback(
    async (orderIds?: string[]) => {
      const ok = await xd.print(orderIds);
      showToast(ok ? to("xdPrinted") : to("xdPrintFailed"), ok ? undefined : "bad");
    },
    [xd, showToast, to],
  );

  const [tile, setTile] = useState<TileKey>("todo");
  const [roll, setRoll] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hand, setHand] = useState<ToLabelRow | null>(null);
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const sortedTodo = useMemo(() => [...orders].sort((a, b) => hoursOn(b) - hoursOn(a)), [orders]);
  const late = useMemo(() => sortedTodo.filter((o) => hoursOn(o) >= 48), [sortedTodo]);

  const localDay = useCallback(
    (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: isLy ? "Africa/Tripoli" : "Africa/Tunis" }).format(new Date(iso)),
    [isLy],
  );
  const doneToday = useMemo(
    () => (scanned.data?.orders ?? []).filter((r) => r.scanned_at && localDay(r.scanned_at) === today),
    [scanned.data, localDay, today],
  );
  const lastAt = doneToday.map((r) => r.scanned_at as string).sort().pop() ?? null;
  const time = (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" });

  const total = data?.total ?? orders.length;
  const lateTotal = data?.late ?? late.length;
  const scannedTodayCount = data?.scannedToday ?? doneToday.length;
  const oldest = sortedTodo[0] ? benchAge(hoursOn(sortedTodo[0])) : null;
  const ageText = (h: number) => {
    const a = benchAge(h);
    return a.unit === "h" ? t("hours", { n: a.n }) : t("days", { n: a.n });
  };

  const source = tile === "late" ? late : sortedTodo;
  const rolls = rollCounts(tile === "done" ? doneToday.map((r) => ({ zone: { colorHex: zoneHexOf(r, orders) } })) : source);

  const matches = (vals: Array<string | null | undefined>) => {
    const needle = q.trim().toLowerCase();
    return !needle || vals.filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
  };
  const todoRows = source.filter(
    (o) =>
      (!roll || o.zone.colorHex === roll) &&
      matches([o.customer_name, o.customer_city, o.product_name, o.id, o.carrier_sticker_ref, o.tracking_number]),
  );
  const doneRows = doneToday.filter(
    (r) =>
      (!roll || zoneHexOf(r, orders) === roll) &&
      matches([r.customer_name, r.customer_city, r.product_name, r.id, r.carrier_sticker_ref, r.tracking_number]),
  );

  const listKey = `${tile}|${roll ?? ""}|${q}|${siteId ?? ""}`;
  const [todoPage, setTodoPage] = usePaged(todoRows, listKey);
  const [donePage, setDonePage] = usePaged(doneRows, listKey);

  /* ── the scan ─────────────────────────────────────────────────────── */
  const onScanned = useCallback(() => {
    void mutate();
    void scanned.mutate();
  }, [mutate, scanned]);
  const { submit, busy, last } = useScanOut({ market, hand, orders, onScanned });

  // A result arrives: say it, and on success take the next parcel of the same roll.
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!last || seen.current === last.id) return;
    seen.current = last.id;
    const ok = last.outcome === "bound" || last.outcome === "bind_unverified";
    if (!ok) {
      showToast(last.message ?? to("scanFailed"), "bad");
      return;
    }
    const was = hand;
    const next = was ? sortedTodo.find((o) => o.id !== was.id && o.zone.colorHex === was.zone.colorHex) ?? null : null;
    const colour = was ? zoneLabels(was.zone, locale).colour : null;
    const ref = was ? `#${was.id.slice(0, 6).toUpperCase()}` : "";
    showToast(
      last.outcome === "bind_unverified"
        ? to("boundUnverified", { code: last.code, ref: last.carrierRef ?? "—" })
        : next && colour
          ? to("boundNext", { code: last.code, ref, colour })
          : to("bound", { code: last.code, ref }),
      last.outcome === "bind_unverified" ? "bad" : "ok",
    );
    setHand(isLy ? next : null);
    // `hand` and the queue are read at the moment the result lands, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last]);

  useEffect(() => {
    if ((hand || !isLy) && !camera) scanRef.current?.focus();
  }, [hand, isLy, camera]);

  const send = async (raw: string) => {
    setCode("");
    await submit(raw);
  };

  /* ── the driver ───────────────────────────────────────────────────── */
  const shownSites = (pickup?.sites ?? [])
    .filter((s) => !siteId || s.warehouseId === siteId)
    // The reader's spelling of the building, as on the switch beside it.
    .map((s) => ({ ...s, name: (locale === "ar" ? s.nameAr : s.nameFr) || s.name }));
  const pressPickup = async (s: PickupSiteState) => {
    if (!window.confirm(to("pickupConfirm", { site: s.name }))) return;
    const res = await fetch("/api/warehouse/pickup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warehouse_id: s.warehouseId, disabled: true }),
    });
    if (!res.ok) {
      showToast(to("pickupFailed"), "bad");
      return;
    }
    await mutatePickup(await res.json(), { revalidate: false });
    showToast(to("pickupDone", { site: s.name }));
  };

  const take = (o: ToLabelRow) => setHand((h) => (h?.id === o.id ? null : o));
  // The scan run: one roll in hand, the parcels one after another, full screen.
  const runParams = new URLSearchParams();
  if (roll) runParams.set("roll", roll);
  if (siteId) runParams.set("warehouse_id", siteId);
  const runHref = `/${locale}/warehouse/scan${runParams.size ? `?${runParams.toString()}` : ""}`;

  const handColour = hand ? zoneLabels(hand.zone, locale).colour : null;
  const cols = isLy
    ? tile === "done"
      ? "minmax(260px,1.6fr) 130px 110px 130px 110px 40px"
      : "minmax(260px,1.6fr) 130px 110px 90px 110px 130px"
    : tile === "done"
      ? "minmax(260px,1.6fr) 110px 130px 110px 40px"
      : xdOn
        ? "minmax(260px,1.6fr) 110px 90px 110px 150px 130px"
        : "minmax(260px,1.6fr) 110px 90px 110px 130px";
  const xdColumn = xdOn && tile !== "done";

  return (
    <DeskPage overlay={toast}>
      <DeskHeader
        title={to("title")}
        sub={<LiveSub parts={[t(`market.${market}`), dateLabel]} />}
        acts={
          <>
            {shownSites.map((s) =>
              s.disabled && s.disabledAt ? (
                <span className="pk ok" key={s.warehouseId}>
                  <Ic n="check" />
                  {to("pickupPassed", { site: s.name, time: time(s.disabledAt) })}
                </span>
              ) : (
                <span className="pk" key={s.warehouseId}>
                  <Ic n="truck" />
                  {to("pickupNot", { site: s.name })}
                  {s.canDisable ? (
                    <button type="button" onClick={() => void pressPickup(s)}>
                      {to("pickupPress")}
                    </button>
                  ) : null}
                </span>
              ),
            )}
            {xdOn ? (
              <span className="pk xdpk" data-testid="xd-labels">
                <span className="xdtag">X-DELIVERY</span>
                {to("xdToPrint", { n: xdToPrint.size })}
                <span className="fmt" role="radiogroup" aria-label={to("xdFormat")}>
                  {(["a4x2", "thermal"] as const).map((f) => (
                    <button key={f} type="button" role="radio" aria-checked={xd.format === f} onClick={() => xd.setFormat(f)}>
                      {f === "a4x2" ? to("xdFormatA4") : to("xdFormatThermal")}
                    </button>
                  ))}
                </span>
                {xdToPrint.size > 0 ? (
                  <button type="button" className="go" disabled={xd.printing} onClick={() => void printLabels()}>
                    {to("xdPrint", { n: xdToPrint.size })}
                  </button>
                ) : null}
              </span>
            ) : null}
            <SiteSeg sites={sites} value={siteId} onChange={(id) => { setSite(id); setRoll(null); setHand(null); }} />
          </>
        }
      />

      {xdOn && xd.summary?.lastBatch ? (
        <div className="xdband">
          <Ic n="file" />
          <span>
            <b>{to("xdLastBatch", { time: time(xd.summary.lastBatch.at), n: xd.summary.lastBatch.count })}</b>
            <small>{to("xdPdfHint")}</small>
          </span>
          <button type="button" className="btn2 sm" disabled={xd.printing} onClick={() => void printLabels(xd.summary?.lastBatch?.orderIds)}>
            {to("xdReprintBatch")}
          </button>
        </div>
      ) : null}

      <Tiles n={3}>
        <Tile
          hue="j-out"
          icon="out"
          n={total}
          label={to("tileTodo")}
          small={
            oldest
              ? isLy
                ? to("tileTodoSub", { rolls: rollCounts(sortedTodo).length, age: ageText(hoursOn(sortedTodo[0])) })
                : to("tileTodoSubTn", { age: ageText(hoursOn(sortedTodo[0])) })
              : to("tileTodoEmpty")
          }
          on={tile === "todo"}
          onClick={() => { setTile("todo"); setRoll(null); }}
        />
        <Tile
          hue="h-amber"
          icon="clock"
          n={lateTotal}
          label={to("tileLate")}
          small={lateTotal ? <em className="w">{to("tileLateSub")}</em> : to("tileLateNone")}
          on={tile === "late"}
          onClick={() => { setTile(tile === "late" ? "todo" : "late"); setRoll(null); }}
        />
        <Tile
          hue="h-green"
          icon="check"
          n={scannedTodayCount}
          label={to("tileDone")}
          small={lastAt ? to("tileDoneLast", { time: time(lastAt) }) : to("tileDoneNone")}
          on={tile === "done"}
          onClick={() => { setTile(tile === "done" ? "todo" : "done"); setRoll(null); setHand(null); }}
        />
      </Tiles>

      {hand || (!isLy && tile !== "done") ? (
        <div className="scanbar">
          <span className="hold j-out">
            <Ic n="scan" />
          </span>
          <div>
            {hand ? (
              <b>
                {to("inHand")} <bdi>{hand.customer_name}</bdi> · <bdi>{hand.product_name}</bdi> ×{hand.quantity}
              </b>
            ) : (
              <b>{to("scanTn")}</b>
            )}
            <small>
              {isLy && hand
                ? handColour
                  ? to.rich("stickHint", { colour: handColour, b: (c) => <b style={{ color: "var(--ink)" }}>{c}</b> })
                  : to("stickHintUnknown")
                : to("scanTnHint")}
            </small>
            <span className="beam" aria-hidden="true" />
          </div>
          <label className="scanin">
            <Ic n="scan" />
            <input
              ref={scanRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send(code);
                }
              }}
              disabled={busy}
              autoComplete="off"
              aria-label={isLy ? to("stickerField") : to("qrField")}
              placeholder={isLy ? to("stickerField") : to("qrField")}
            />
          </label>
          <button type="button" className="btn2" aria-pressed={camera} onClick={() => setCamera((v) => !v)}>
            <Ic n="camera" />
            {to("camera")}
          </button>
          {hand ? (
            <button type="button" className="btn2" onClick={() => { setHand(null); setCamera(false); }}>
              {to("putDown")}
            </button>
          ) : null}
        </div>
      ) : null}
      {camera ? (
        <div className="cam">
          <QrScanner active={camera} onScan={(text) => void send(text)} onClose={() => setCamera(false)} />
        </div>
      ) : null}

      {!hand ? (
        <SearchLine value={q} onChange={setQ} placeholder={isLy ? to("searchLy") : to("search")}>
          {isLy && tile !== "done" ? (
            todoRows.length > 0 ? (
              <Link className="btn" href={runHref}>
                <Ic n="scan" />
                {roll ? to("startRunRoll", { colour: zoneLabels(roll, locale).colour ?? roll }) : to("startRun")}
              </Link>
            ) : null
          ) : null}
        </SearchLine>
      ) : null}

      <div className="rolls">
        {isLy ? (
          <>
            <span className="lab">{to("roll")}</span>
            <button type="button" className={`rc ${!roll ? "on" : ""}`} onClick={() => setRoll(null)}>
              {to("allRolls")} <em>{tile === "done" ? doneToday.length : source.length}</em>
            </button>
            {rolls.map(([hex, n]) => (
              <button key={hex} type="button" className={`rc ${roll === hex ? "on" : ""}`} onClick={() => setRoll(roll === hex ? null : hex)}>
                <i className="dot" style={{ "--c": hex } as React.CSSProperties} aria-hidden="true" />
                {zoneLabels(hex, locale).colour ?? hex} <em>{n}</em>
              </button>
            ))}
          </>
        ) : null}
        <span className="count">{to.rich("countRows", { n: tile === "done" ? doneRows.length : todoRows.length, b: (c) => <b>{c}</b> })}</span>
      </div>

      <div className="list" style={{ "--cols": cols } as React.CSSProperties}>
        <div className="lh">
          <span>{to("colParcel")}</span>
          {isLy ? <span>{to("colRoll")}</span> : null}
          <span className="e">{to("colAmount")}</span>
          <span>{tile === "done" ? to("colOutAt") : to("colWait")}</span>
          <span>{to("colSite")}</span>
          {xdColumn ? <span>{to("xdColLabel")}</span> : null}
          <span />
        </div>
        <div className="rows">
          {tile === "done" ? (
            doneRows.length === 0 ? (
              <Empty icon="out">{to("emptyDone")}</Empty>
            ) : (
              donePage.rows.map((r) => (
                <DoneRow
                  key={r.id}
                  row={r}
                  isLy={isLy}
                  hex={zoneHexOf(r, orders)}
                  site={nameOf(r.warehouse_id)}
                  at={r.scanned_at ? time(r.scanned_at) : "—"}
                  menuOpen={menu === r.id}
                  onMenu={() => setMenu(menu === r.id ? null : r.id)}
                  busy={scanned.busyId === r.id}
                  onRecheck={() => { setMenu(null); void scanned.recheck(r); }}
                  onUnscan={() => { setMenu(null); void scanned.unscan(r); }}
                />
              ))
            )
          ) : todoRows.length === 0 ? (
            <Empty icon="check">{orders.length > 0 ? to("emptyFiltered") : isLy ? to("empty") : to("emptyTn")}</Empty>
          ) : (
            todoPage.rows.map((o) => {
              const gone = GONE_AT_CARRIER.has(o.carrier_status_slug ?? "");
              const unbindable = isLy && !gone && o.has_carrier_ref === false;
              const short = (o.current_stock ?? 0) < o.quantity;
              const inHand = hand?.id === o.id;
              const h = hoursOn(o);
              const tone = ageTone(h);
              const label = zoneLabels(o.zone, locale).colour;
              return (
                <div
                  key={o.id}
                  className={`row ${inHand ? "sel" : ""}`}
                  onClick={() => (!gone && !unbindable ? take(o) : undefined)}
                  data-testid="out-row"
                >
                  <div className="lt">
                    <Thumb seed={o.product_id ?? o.product_name} image={o.product_image_url} />
                    <div>
                      <span className="nm">
                        <bdi>{o.product_name}</bdi>
                        {o.quantity > 1 ? <span style={{ color: "var(--ink-3)" }}> ×{o.quantity}</span> : null}
                        {o.items && o.items.length > 1 ? <span style={{ color: "var(--ink-3)" }}> {to("moreLines", { n: o.items.length - 1 })}</span> : null}
                      </span>
                      <span className="l2">
                        <b><bdi>{o.customer_name}</bdi></b>
                        {o.customer_city ? <> · <bdi>{o.customer_city}</bdi></> : null}
                        {" · "}
                        <span className="num">{o.carrier_sticker_ref ?? o.tracking_number ?? `#${o.id.slice(0, 6).toUpperCase()}`}</span>
                      </span>
                    </div>
                  </div>
                  {isLy ? (o.zone.colorHex ? <RollDot hex={o.zone.colorHex} name={label} /> : <span className="roll">{to("rollUnknown")}</span>) : null}
                  <span className="amt e">
                    {fnum(Number(o.total_price))}
                    <small>{isLy ? "LYD" : "TND"}</small>
                  </span>
                  <span className={`age ${tone}`}>
                    {tone ? <Ic n="clock" /> : null}
                    {ageText(h)}
                  </span>
                  <span className="site">{nameOf(o.warehouse_id) ?? "—"}</span>
                  {xdColumn ? (
                    <span className="xdl">
                      {xdToPrint.has(o.id) ? (
                        <Tag hue="h-amber" icon="file">{to("xdLabelToPrint")}</Tag>
                      ) : xdPrinted[o.id] ? (
                        <>
                          <Tag hue="h-green" icon="check">{to("xdLabelPrinted", { time: time(xdPrinted[o.id]) })}</Tag>
                          <button
                            type="button"
                            className="lnk"
                            disabled={xd.printing}
                            onClick={(e) => { e.stopPropagation(); void printLabels([o.id]); }}
                          >
                            {to("xdReprint")}
                          </button>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  <span style={{ justifySelf: "end" }}>
                    {gone ? (
                      <Tag hue="h-red" icon="alert">{to("gone")}</Tag>
                    ) : unbindable ? (
                      <Tag hue="h-amber" icon="alert">{to("noRef")}</Tag>
                    ) : short ? (
                      <Tag hue="h-red" icon="alert">{to("short")}</Tag>
                    ) : (
                      <button
                        type="button"
                        className={inHand ? "btn sm" : "btn2 sm"}
                        onClick={(e) => { e.stopPropagation(); take(o); }}
                      >
                        <Ic n="hand" />
                        {inHand ? to("taken") : to("take")}
                      </button>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
        {tile === "done" ? <Pager paged={donePage} onPage={setDonePage} /> : <Pager paged={todoPage} onPage={setTodoPage} />}
        <div className="lfoot">
          <Ic n="info" />
          <span>
            {tile === "done"
              ? to("footDone")
              : (data?.carrierWarehouse ?? 0) > 0
                ? to("footCarrierN", { n: data?.carrierWarehouse ?? 0 })
                : to("footCarrier")}
          </span>
        </div>
      </div>
      {scanned.flash ? <ScannedFlash text={scanned.flash.text} tone={scanned.flash.tone} show={showToast} /> : null}
    </DeskPage>
  );
}

/** Relays the scanned-list actions' outcome into the page toast, once per message. */
function ScannedFlash({ text, tone, show }: { text: string; tone: "ok" | "bad"; show: (t: string, tone?: "ok" | "bad") => void }) {
  useEffect(() => {
    show(text, tone);
  }, [text, tone, show]);
  return null;
}

/** A scanned row has no zone of its own; the branch group decides it like a queue row's. */
function zoneHexOf(row: ScannedRow, queue: ToLabelRow[]): string | null {
  const twin = queue.find((o) => o.branch_group && o.branch_group === row.branch_group);
  return twin?.zone.colorHex ?? null;
}

function DoneRow({
  row,
  isLy,
  hex,
  site,
  at,
  menuOpen,
  onMenu,
  busy,
  onRecheck,
  onUnscan,
}: {
  row: ScannedRow;
  isLy: boolean;
  hex: string | null;
  site: string | null;
  at: string;
  menuOpen: boolean;
  onMenu: () => void;
  busy: boolean;
  onRecheck: () => void;
  onUnscan: () => void;
}) {
  const to = useTranslations("warehouse.desk.out");
  const locale = useLocale();
  const unconfirmed = isLy && row.sticker_bind_state !== null && row.sticker_bind_state !== "confirmed";
  return (
    <div className="row static" data-testid="done-row">
      <div className="lt">
        <Thumb seed={row.product_id ?? row.product_name} />
        <div>
          <span className="nm">
            <bdi>{row.product_name}</bdi>
            {row.quantity > 1 ? <span style={{ color: "var(--ink-3)" }}> ×{row.quantity}</span> : null}
          </span>
          <span className="l2">
            <b><bdi>{row.customer_name}</bdi></b>
            {row.customer_city ? <> · <bdi>{row.customer_city}</bdi></> : null}
            {" · "}
            <span className="num">{row.carrier_sticker_ref ?? row.tracking_number ?? `#${row.id.slice(0, 6).toUpperCase()}`}</span>
          </span>
        </div>
      </div>
      {isLy ? hex ? <RollDot hex={hex} name={zoneLabels(hex, locale).colour} /> : <span className="roll">—</span> : null}
      <span className="amt e">
        {fnum(Number(row.total_price))}
        <small>{isLy ? "LYD" : "TND"}</small>
      </span>
      <span className="age">
        <Ic n="check" />
        {at}
        {row.scanned_by_name ? ` · ${row.scanned_by_name}` : ""}
        {unconfirmed ? <Tag hue="h-amber" icon="alert" style={{ marginInlineStart: 6 }}>{to("unconfirmed")}</Tag> : null}
      </span>
      <span className="site">{site ?? "—"}</span>
      <span className="menu" style={{ justifySelf: "end" }}>
        <button type="button" className="kb" aria-label={to("rowMenu")} aria-expanded={menuOpen} onClick={onMenu} disabled={busy}>
          <Ic n="more" />
        </button>
        {menuOpen ? (
          <span className="menu-pop" role="menu">
            {isLy ? (
              <button type="button" role="menuitem" onClick={onRecheck}>
                <Ic n="refresh" />
                {to("recheck")}
              </button>
            ) : null}
            <button type="button" role="menuitem" onClick={onUnscan} disabled={!canUnscan(row)}>
              <Ic n="back" />
              {to("unscan")}
            </button>
          </span>
        ) : null}
      </span>
    </div>
  );
}

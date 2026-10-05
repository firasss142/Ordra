"use client";

import "@/components/agent/agent.css";
import "@/components/agent/agent-app.css";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import type { DeliveryScorecard, WorklistRow } from "@/lib/delivery/types";
import type { AgentActionType } from "@/lib/delivery/actions";
import { applyRecordedAction, partitionStalled } from "@/lib/delivery/worklist";
import { formatPhone, suggestedReminder } from "@/lib/delivery/presentation";
import { inTwoHours, tomorrowAt } from "@/lib/delivery/schedule";
import {
  actOf, filterParcels, sinceMinutes, sitOf, stallRange, SIT_LOOK, TILE_HUE, TILE_ORDER,
  type Act, type Sort, type Tile,
} from "@/lib/delivery/agent-view";
import type { PendingAction, QueuedBody } from "@/hooks/useDeliveryActionQueue";
import { useRegisterFeedbackContext } from "@/components/feedback/FeedbackCaptureProvider";
import { WhatsAppSheet } from "@/components/delivery/Sheets";
import { APill, Ic, Thumb, useAgentPhone, useAgentToast, useTip } from "@/components/agent/shared";
import { useAutoPage } from "@/components/agent/useAutoPage";
import { ParcelDetail, type ParcelHandlers } from "./ParcelDetail";
import { ActionTray, type Who } from "./ActionTray";
import { fnum, useDayWhen, useDur } from "./words";

export interface AgentDeliveryViewProps {
  /** null while the first load is in flight. */
  rows: WorklistRow[] | null;
  error: boolean;
  onRetry: () => void;
  scorecard: DeliveryScorecard | null;
  marketCode: "ly" | "tn";
  marketId: string | null;
  whatsappActive: boolean;
  whatsappKnown: boolean;
  tz: string;
  locale: string;
  now: number;
  /** The finished parcels (last 24 h) are in the payload. */
  doneLoaded: boolean;
  onNeedDone: () => void;
  /** The action inside its 5-second undo window — shown as already applied. */
  pending: PendingAction | null;
  onQueue: (row: WorklistRow, body: QueuedBody) => void;
  onUndo: () => void;
}

/** A tiny pause glyph: the shared icon set has no « pause » (prototype ICON.pause). */
function PauseIc() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}
const SitPill = ({ sit, text }: { sit: keyof typeof SIT_LOOK; text: string }) =>
  sit === "stall" ? <span className="pl h-neutral"><PauseIc /><span>{text}</span></span> : <APill hue={SIT_LOOK[sit].hue} icon={SIT_LOOK[sit].icon} text={text} />;

type Sheet = { kind: "log"; id: string; who: Who } | { kind: "wa"; id: string };
type Menu = "filter" | "sort" | null;

/**
 * « Suivi livraison » for the agent, in the Aurore shell (prototypes/agent-shell-v2.html § 4 Livraison):
 * six tiles, the parcels situation first with the number inside the action button, the stalled fold,
 * and the parcel on the right (desktop) or full screen (phone). Pure: data, clock and the action
 * queue come in as props. Returns the CHILDREN of the shell's `.page`.
 */
export function AgentDeliveryView(props: AgentDeliveryViewProps) {
  const { rows: rawRows, error, onRetry, scorecard, marketCode, marketId, whatsappActive, whatsappKnown, tz, locale, now, doneLoaded, onNeedDone, pending, onQueue, onUndo } = props;
  const t = useTranslations("agentDelivery");
  const phone = useAgentPhone();
  const toast = useAgentToast();
  const tip = useTip();
  const dur = useDur();
  const dayWhen = useDayWhen(tz, now, locale);
  const tWa = useTranslations("whatsapp");

  const [bucket, setBucket] = useState<Tile>("all");
  const [q, setQ] = useState("");
  const [risk, setRisk] = useState(false);
  const [sort, setSort] = useState<Sort>("prio");
  const [menu, setMenu] = useState<Menu>(null);
  const [showStalled, setShowStalled] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // ?open=<id> — a result picked in the header's search lands on its own row.
  const openParam = useSearchParams()?.get("open") ?? null;
  useEffect(() => {
    if (openParam) setOpenId(openParam);
  }, [openParam]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const feedback = useRegisterFeedbackContext(openId);
  const toolsRef = useRef<HTMLDivElement>(null);

  // A pending action is shown as already applied, even if a refresh lands inside the undo window.
  const rows = useMemo(
    () => rawRows?.map((r) => (pending && r.order_id === pending.orderId ? applyRecordedAction(r, pending.body, now) : r)) ?? null,
    [rawRows, pending, now],
  );
  const all = useMemo(() => rows ?? [], [rows]);
  const visible = useMemo(() => filterParcels(all, { bucket, q, risk, sort }, now), [all, bucket, q, risk, sort, now]);
  const waitingDone = bucket === "done" && !doneLoaded;
  const { live: main, stalled } = useMemo(() => (waitingDone ? { live: [], stalled: [] } : partitionStalled(visible, now)), [visible, now, waitingDone]);
  const { shown: mainShown, more } = useAutoPage(main, `${bucket}|${q}|${risk}|${sort}`);
  const inFlight = all.filter((r) => r.bucket !== "done").length;
  const byId = useCallback((id: string | null) => (id ? all.find((r) => r.order_id === id) ?? null : null), [all]);

  // The desktop opens on the first parcel (decision 11); the phone opens nothing until tapped.
  useEffect(() => {
    if (phone || openId || main.length === 0) return;
    setOpenId(main[0].order_id);
  }, [phone, openId, main]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  // The sheet keeps the row it opened on: a send can move the row out of the current tile.
  const sheetSnap = useRef<WorklistRow | null>(null);
  const sheetLive = sheet ? byId(sheet.id) : null;
  if (sheetLive) sheetSnap.current = sheetLive;
  const sheetRow = sheet ? sheetLive ?? (sheetSnap.current?.order_id === sheet.id ? sheetSnap.current : null) : null;

  const record = useCallback((row: WorklistRow, body: QueuedBody) => {
    onQueue(row, body);
    const to = applyRecordedAction(row, body, now).bucket;
    const msg = to === row.bucket ? t("toast.saved") : t("toast.moved", { bucket: t(`tiles.${to}`) });
    toast(msg, body.alreadyRecorded ? undefined : onUndo);
  }, [onQueue, onUndo, now, t, toast]);

  const handlers: ParcelHandlers = useMemo(() => ({
    onDial: (row, num, courier) => {
      setOpenId(row.order_id);
      toast(courier ? t("callingCourier") : t("calling", { num: formatPhone(num) }));
    },
    onWhatsApp: (row) => { setOpenId(row.order_id); setSheet({ kind: "wa", id: row.order_id }); },
    onQuick: (row, outcome, actionType: AgentActionType) => {
      const r = suggestedReminder(outcome);
      record(row, {
        action_type: actionType, outcome, note: null, template_key: null,
        next_action_at: r === "in2h" ? inTwoHours(now) : r === "tomorrow10" ? tomorrowAt(now, tz, 10) : null,
      });
    },
    onLog: (row) => {
      const a = actOf(row, now);
      const who: Who = a.actionType && a.actionType !== "whatsapp_customer" ? a.actionType : "call_customer";
      setSheet({ kind: "log", id: row.order_id, who });
    },
    onCopy: (text) => {
      void navigator.clipboard?.writeText(text).catch(() => undefined);
      toast(t("detail.copied"));
    },
  }), [record, now, tz, t, toast]);

  /** The row's move: dial (the tel: link follows), open WhatsApp, or open the parcel. */
  const onAct = (row: WorklistRow, a: Act) => {
    if (a.wa) handlers.onWhatsApp(row);
    else if (a.num) handlers.onDial(row, a.num);
    else setOpenId(row.order_id);
  };

  const pickTile = (k: Tile) => { setBucket(k); setOpenId(null); };
  const selected = byId(openId);
  const sumOf = (k: Tile) => all.filter((r) => (k === "all" ? r.bucket !== "done" : r.bucket === k));

  const tiles = (
    <section className="bks six" aria-label={t("tilesLabel")} role="region">
      {TILE_ORDER.map((k) => {
        const ps = sumOf(k);
        const lazy = k === "done" && !doneLoaded;
        const on = bucket === k;
        return (
          <button key={k} type="button" className={`bk h-${TILE_HUE[k]}${on ? " on" : ""}`} aria-pressed={on} onClick={() => pickTile(k)}>
            <span className="bk-l"><i />{t(`tiles.${k}`)}</span>
            <b className="num">{lazy ? "·" : ps.length}</b>
            <small>{lazy ? t("last24h") : `${fnum(ps.reduce((s, r) => s + (r.total_price ?? 0), 0), marketCode)} ${t(`ccy.${marketCode}`)}`}</small>
          </button>
        );
      })}
    </section>
  );

  const search = (placeholder: string) => (
    <label className="srch">
      <Ic n="search" />
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoComplete="off" />
    </label>
  );

  const rowLabel = (a: Act) => (
    <span>{t(`act.${a.key}`)}{a.num ? <> <span className="num">{formatPhone(a.num)}</span></> : null}</span>
  );

  const traceOf = (row: WorklistRow): ReactNode => {
    const moved = row.latest_event_at ?? new Date(now - (row.hours_on_status ?? 0) * 3_600_000).toISOString();
    if (row.wa_last && Date.parse(row.wa_last.at) >= Date.parse(moved)) {
      const label = row.wa_last.template_key && tWa.has(`templates.${row.wa_last.template_key}`) ? tWa(`templates.${row.wa_last.template_key}`) : tWa("thread.template");
      const time = dayWhen(row.wa_last.at).replace(/^.*\s(\d{2}:\d{2})$/, "$1");
      return <><Ic n="wa" />{t("trace.wa", { label, time })}</>;
    }
    if (!row.last_action_at || !row.last_action_type || !t.has(`trace.${row.last_action_type}`)) return null;
    return <><Ic n={row.last_action_type === "whatsapp_customer" ? "wa" : row.last_action_type === "note" ? "check" : "phone"} />{t(`trace.${row.last_action_type}`, { when: dayWhen(row.last_action_at) })}</>;
  };

  const parcelRow = (row: WorklistRow) => {
    const sit = sitOf(row, now);
    const look = SIT_LOOK[sit];
    const a = actOf(row, now);
    const item = row.items[0];
    const trace = traceOf(row);
    const small = row.latest_remark && row.bucket !== "done"
      ? <span dir="auto">« {row.latest_remark} »</span>
      : sit === "wait" && row.last_action_note ? <span dir="auto">« {row.last_action_note} »</span> : t(`sit.${sit}.why`);
    return (
      <div key={row.order_id} role="listitem" tabIndex={-1} className={`row dr h-${look.hue}${openId === row.order_id ? " open" : ""}`}
        onClick={() => setOpenId(row.order_id)}>
        <span className="rail" />
        <div className="sit">
          <span><SitPill sit={sit} text={t(`sit.${sit}.label`)} /><span className="dur">{dur(sinceMinutes(row, now))}</span></span>
          <small>{small}</small>
          {trace && <small className="trace">{trace}</small>}
        </div>
        <div className="oc">
          <span style={{ position: "relative" }}>
            <Thumb src={item?.image_url} seed={item?.product_name ?? row.order_id} />
            {item && item.quantity > 1 && <span className="qx">×{item.quantity}</span>}
          </span>
          <div className="oc-t">
            <div className="l1">
              <span className="nm" dir="auto">{row.customer_name}</span>
              {row.tracking_number && <span className="num q" style={{ fontSize: 12 }}>#{row.tracking_number}</span>}
            </div>
            <div className="l2">
              {row.customer_phone && <span className="num">{formatPhone(row.customer_phone)}</span>}
              {row.customer_phone_2 && <> · <span className="num">{formatPhone(row.customer_phone_2)}</span></>}
              {row.customer_city ? <> · {row.customer_city}</> : null}
              {row.customer_address ? <>, <span dir="auto">{row.customer_address}</span></> : null}
            </div>
          </div>
        </div>
        <div className="la" onClick={(e) => e.stopPropagation()}>
          {a.num ? (
            <a className="btn2 sm callish" href={`tel:${a.num}`} onClick={() => onAct(row, a)} data-tip={t(`act.${a.key}`)}>
              <Ic n="phone" />{rowLabel(a)}
            </a>
          ) : (
            <button type="button" className={`btn2 sm${a.wa ? " callish" : ""}`} onClick={() => onAct(row, a)} data-tip={t(`act.${a.key}`)}>
              <Ic n={a.wa ? "wa" : row.bucket === "done" ? "ext" : "route"} className={a.wa ? "" : "flip"} />{rowLabel(a)}
            </button>
          )}
          {row.bucket !== "done" && (
            <button type="button" className="wasq" aria-label="WhatsApp" onClick={() => handlers.onWhatsApp(row)}><Ic n="wa" /></button>
          )}
        </div>
        <div className="amt"><span className="num">{fnum(row.total_price, marketCode)}</span><small>{t(`ccy.${marketCode}`)}</small></div>
      </div>
    );
  };

  const emptyOrLoad = bucket === "done" && !doneLoaded ? (
    <div className="empty"><Ic n="check" /><button type="button" className="btn2" onClick={onNeedDone}>{t("loadDone")}</button></div>
  ) : (
    <div className="empty"><Ic n="check" /><b>{t("empty")}</b><button type="button" className="btn2" onClick={() => { pickTile("all"); setQ(""); setRisk(false); }}>{t("seeAll")}</button></div>
  );

  const loadingOrError = rows === null ? (
    error ? (
      <div className="empty"><b>{t("loadError")}</b><button type="button" className="btn2" onClick={onRetry}>{t("retry")}</button></div>
    ) : (
      <>{[0, 1, 2, 3, 4].map((i) => <div key={i} className="sk-row" />)}</>
    )
  ) : null;

  const range = stalled.length ? stallRange(stalled) : null;
  const fold = range && (
    <>
      <button type="button" className="stall" aria-expanded={showStalled} onClick={() => setShowStalled((v) => !v)}>
        <PauseIc />
        <span>
          <b>{t("stalled", { n: stalled.length })}</b>
          <small>{t("stalledSince", { min: range.min, max: range.max })}</small>
        </span>
        <span className="lnk">{showStalled ? t("hide") : t("show")}</span>
      </button>
      {showStalled && stalled.map(parcelRow)}
    </>
  );

  const overlays = (
    <>
      {sheet?.kind === "log" && sheetRow && (
        <ActionTray key={sheet.id} row={sheetRow} initialWho={sheet.who} phone={phone} tz={tz} now={now}
          feedbackEnabled={feedback.enabled} marketId={marketId}
          onClose={() => setSheet(null)}
          onSubmit={(body) => { record(sheetRow, body); setSheet(null); }} />
      )}
      {sheet?.kind === "wa" && sheetRow && (
        <WhatsAppSheet key={sheet.id} row={sheetRow} market={marketCode} marketId={marketId} whatsappActive={whatsappActive} whatsappKnown={whatsappKnown}
          onClose={() => setSheet(null)}
          onSent={(body) => {
            onQueue(sheetRow, body);
            toast(body.alreadyRecorded ? t("toast.saved") : t("waOpened"), body.alreadyRecorded ? undefined : onUndo);
            if (!body.alreadyRecorded) setSheet(null);
          }} />
      )}
    </>
  );

  const detailProps = { now, tz, locale, market: marketCode, marketId, whatsappOn: whatsappActive || whatsappKnown, handlers, onClose: () => setOpenId(null) };

  if (phone) {
    const cards = mainShown;
    return (
      <div style={{ display: "contents" }} onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
        <div className="hscroll">{tiles}</div>
        {search(t("searchPhone"))}
        <div className="cards" role="list" aria-label={t("title")}>
          {loadingOrError ?? (cards.length === 0 ? emptyOrLoad : cards.map((row) => {
            const sit = sitOf(row, now);
            const look = SIT_LOOK[sit];
            const a = actOf(row, now);
            const item = row.items[0];
            return (
              <div key={row.order_id} role="listitem" className={`pcard h-${look.hue}`} onClick={() => setOpenId(row.order_id)}>
                <div className="pc1">
                  <span className="nm" dir="auto">{row.customer_name}</span>
                  <span className="amt"><span className="num">{fnum(row.total_price, marketCode)}</span><small>{t(`ccy.${marketCode}`)}</small></span>
                </div>
                <div className="l2">
                  {item?.product_name && <b dir="auto">{item.product_name}</b>}
                  {row.customer_city ? <> · {row.customer_city}</> : null}
                  {row.tracking_number && <> · <span className="num">{row.tracking_number}</span></>}
                </div>
                <div className="pc2"><SitPill sit={sit} text={t(`sit.${sit}.label`)} /><span className="dur">{dur(sinceMinutes(row, now))}</span></div>
                {row.latest_remark && row.bucket !== "done" && <small className="rmk" dir="auto">« {row.latest_remark} »</small>}
                {row.bucket !== "done" && (a.num ? (
                  <a className="pbar2" href={`tel:${a.num}`} onClick={(e) => { e.stopPropagation(); onAct(row, a); }}>
                    <Ic n="phone" />{rowLabel(a)}
                  </a>
                ) : (
                  <button type="button" className="pbar2" onClick={(e) => { e.stopPropagation(); onAct(row, a); }}>
                    <Ic n={a.wa ? "wa" : "route"} />{rowLabel(a)}
                  </button>
                ))}
              </div>
            );
          }))}
          {more}
        </div>
        {selected && (
          <div className="mpanel" role="dialog" aria-label={t("detail.phoneTitle")}>
            <div className="mback">
              <button type="button" className="xbtn" aria-label={t("detail.back")} onClick={() => setOpenId(null)}><Ic n="left" className="flip" /></button>
              <b>{t("detail.phoneTitle")}</b>
              {selected.tracking_number && <span className="num q" style={{ fontSize: 12 }}>{selected.tracking_number}</span>}
            </div>
            <ParcelDetail row={selected} phone {...detailProps} />
          </div>
        )}
        {overlays}
        <div ref={tip.ref} className="tip" />
      </div>
    );
  }

  return (
    <div style={{ display: "contents" }} onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      <header className="ph">
        <div>
          <h1>{t("title")}</h1>
          <div className="sub"><span>{t.rich("inFlight", { n: inFlight, b: (c) => <b style={{ color: "var(--ink)" }}>{c}</b> })}</span></div>
        </div>
        {scorecard && scorecard.delivery_rate !== null && (
          <div className="acts">
            <span className="statp"><Ic n="truck" />{t.rich("stat", { rate: scorecard.delivery_rate, saved: scorecard.saved, b: (c) => <b>{c}</b> })}</span>
          </div>
        )}
      </header>
      {tiles}
      <div className="tools" ref={toolsRef}>
        {search(t("search"))}
        <div className="fbw">
          <button type="button" className={`fb${risk ? " on" : ""}`} aria-haspopup="menu" aria-expanded={menu === "filter"} onClick={() => setMenu(menu === "filter" ? null : "filter")}>
            <Ic n="filter" />{t("filter")}{risk && <em>1</em>}
          </button>
          {menu === "filter" && (
            <div className="menu" role="menu">
              <button type="button" role="menuitemcheckbox" aria-checked={risk} className={`mi${risk ? " on" : ""}`} onClick={() => { setRisk(!risk); setMenu(null); }}>
                <span className="cb">{risk && <Ic n="check" />}</span><span className="ml">{t("riskOnly")}</span>
              </button>
              <button type="button" role="menuitemcheckbox" aria-checked aria-disabled className="mi on">
                <span className="cb"><Ic n="check" /></span><span className="ml">{t("hideDone")}</span>
              </button>
            </div>
          )}
        </div>
        <div className="fbw">
          <button type="button" className="fb" aria-haspopup="menu" aria-expanded={menu === "sort"} onClick={() => setMenu(menu === "sort" ? null : "sort")}>
            <Ic n="sliders" />{t("sort")} · {t(`sorts.${sort}`)}
          </button>
          {menu === "sort" && (
            <div className="menu end" role="menu">
              {(["prio", "amt", "old"] as Sort[]).map((k) => (
                <button key={k} type="button" role="menuitemradio" aria-checked={sort === k} className={`mi${sort === k ? " on" : ""}`} onClick={() => { setSort(k); setMenu(null); }}>
                  <span className="cb">{sort === k && <Ic n="check" />}</span><span className="ml">{t(`sorts.${k}`)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={`split dsplit${selected ? " open" : ""}`}>
        <section className="list">
          <div className="lh dr">
            <span>{t("cols.situation")}</span><span>{t("cols.parcel")}</span><span>{t("cols.action")}</span><span className="e">{t("cols.amount")}</span>
          </div>
          <div className="rows" role="list" aria-label={t("title")} aria-busy={rows === null && !error}>
            {loadingOrError ?? (main.length || stalled.length ? mainShown.map(parcelRow) : emptyOrLoad)}
            {rows !== null ? more : null}
            {rows !== null && fold}
          </div>
        </section>
        {selected && (
          <aside className="pcol" role="region" aria-label={t("detail.phoneTitle")}>
            <ParcelDetail key={selected.order_id} row={selected} phone={false} {...detailProps} />
          </aside>
        )}
      </div>
      {overlays}
      <div ref={tip.ref} className="tip" />
    </div>
  );
}

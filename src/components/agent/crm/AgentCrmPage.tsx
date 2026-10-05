"use client";

/**
 * « Prospects » — the agent's CRM tab, from prototypes/agent-shell-v2.html §3 (`crmPage`,
 * `crmPhone`, `crmPhoneDetail`, `leadOutcome`, the « Nouveau prospect » drawer).
 * Returns the children of the shell's `.page`.
 *
 * Data: GET /api/prospects/worklist (buckets derived server-side by bucketOf, never stored),
 * POST /api/prospects/[id]/outcome after a 5-second « Annuler » window (an undo that appended
 * a reversal would leave lead_history saying "called, then un-called"), POST /api/leads for a
 * new prospect. A failed write now says so and puts the prospect back (it used to be silent).
 */
import "@/components/agent/agent.css";
import "@/components/agent/agent-app.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { APill, Ic, useAgentPhone, useAgentToast, useTip } from "@/components/agent/shared";
import { fetcher } from "@/lib/swr-config";
import { marketTimezone } from "@/lib/markets";
import { useWhatsAppAvailability } from "@/hooks/useWhatsAppAvailability";
import { applyOutcome, bucketOf, countBuckets } from "@/lib/prospects/worklist";
import { historyOf } from "@/lib/prospects/presentation";
import type { ProspectRow, ProspectsResponse } from "@/lib/prospects/types";
import { ProspectWhatsAppSheet } from "@/components/prospects/ProspectWhatsAppSheet";
import { BUCKET_HUE, TILE_ORDER, filterLeads, leadLine, leadSit, nowCount, todayStats, type Tile } from "./crm-model";
import { useCrmWords, type CrmWords } from "./words";
import { LeadDetail } from "./LeadDetail";
import { LeadOutcome, type OutcomeDraft } from "./LeadOutcome";
import { NewLeadDrawer } from "./NewLeadDrawer";

const UNDO_WINDOW_MS = 5_000;

interface Pending { draft: OutcomeDraft; before: ProspectRow }

export function AgentCrmPage({ marketId, locale }: { marketId: string | null; locale: string }) {
  const router = useRouter();
  const phone = useAgentPhone();
  const toast = useAgentToast();
  const tip = useTip();
  const w = useCrmWords(marketId, locale);
  const { t } = w;
  const tz = marketTimezone(marketId);
  const wa = useWhatsAppAvailability(marketId);

  const key = marketId ? `/api/prospects/worklist?${new URLSearchParams({ locale }).toString()}` : null;
  const { data, error, mutate } = useSWR<ProspectsResponse>(key, fetcher, {
    refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true,
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [tile, setTile] = useState<Tile>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [tray, setTray] = useState<{ id: string; preset: "no" | null } | null>(null);
  const [newLead, setNewLead] = useState(false);
  const [waFor, setWaFor] = useState<ProspectRow | null>(null);

  const all = useMemo(() => data?.rows ?? [], [data]);
  const rows = useMemo(() => filterLeads(all, tile, query, now), [all, tile, query, now]);
  const counts = useMemo(() => countBuckets(all), [all]);
  const sel = all.find((r) => r.id === openId) ?? null;

  // Desktop opens on the first prospect (as today); the phone waits for a tap.
  useEffect(() => {
    if (!phone && !sel && rows.length > 0) setOpenId(rows[0].id);
  }, [phone, sel, rows]);

  // ── the write, its undo window, and the failure that is no longer silent ─────────────────
  const patchRows = useCallback((fn: (rows: ProspectRow[]) => ProspectRow[]) => {
    void mutate((cur) => (cur ? { ...cur, rows: fn(cur.rows) } : cur), { revalidate: false });
  }, [mutate]);
  const restore = useCallback((before: ProspectRow) => {
    patchRows((rs) => (rs.some((r) => r.id === before.id) ? rs.map((r) => (r.id === before.id ? before : r)) : [...rs, before]));
  }, [patchRows]);

  const pendingRef = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(async (p: Pending) => {
    try {
      const res = await fetch(`/api/prospects/${p.before.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p.draft),
        keepalive: true,
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      restore(p.before);
      toast(t("toast.failed", { name: p.before.customer_name }));
    } finally {
      void mutate();
    }
  }, [mutate, restore, toast, t]);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) void send(p);
  }, [send]);

  const queue = useCallback((row: ProspectRow, draft: OutcomeDraft) => {
    flush(); // a second outcome sends the first at once
    const p: Pending = { draft, before: row };
    if (draft.kind === "lost") {
      patchRows((rs) => rs.filter((r) => r.id !== row.id));
    } else {
      const next = applyOutcome(row, draft.kind === "callback" ? { kind: "callback", at: draft.at } : { kind: "no_answer" }, Date.now());
      patchRows((rs) => rs.map((r) => (r.id === row.id ? next : r)));
    }
    pendingRef.current = p;
    timer.current = setTimeout(() => {
      timer.current = null;
      pendingRef.current = null;
      void send(p);
    }, UNDO_WINDOW_MS);
    const to = draft.kind === "lost" ? null : draft.kind === "callback" ? "callback" : "retry";
    toast(to ? t("toast.moved", { bucket: t(`buckets.${to}`) }) : t("toast.closed"), () => {
      if (pendingRef.current !== p) return;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      pendingRef.current = null;
      restore(p.before); // the POST never happened
    });
    setTray(null);
  }, [flush, patchRows, restore, send, toast, t]);

  // Leaving the page, or hiding the tab, sends whatever is still waiting.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onHide = () => flushRef.current();
    const onVis = () => { if (document.visibilityState === "hidden") flushRef.current(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      flushRef.current();
    };
  }, []);

  // ── the actions ─────────────────────────────────────────────────────────────────────────
  const openOrder = useCallback((row: ProspectRow) => {
    if (row.converted_order_id) router.push(`/${locale}/orders/${row.converted_order_id}`);
  }, [router, locale]);
  const convert = useCallback((row: ProspectRow) => {
    setTray(null);
    router.push(`/${locale}/leads/${row.id}?convert=1`);
  }, [router, locale]);
  /** data-lcall: the link dials; the result tray (desktop) or sheet (phone) opens. */
  const called = useCallback((row: ProspectRow) => {
    setOpenId(row.id);
    setTray({ id: row.id, preset: null });
    toast(t("toast.calling", { phone: w.phone(row.customer_phone) }));
  }, [toast, t, w]);
  const whatsapp = useCallback((row: ProspectRow) => {
    // The business number's sheet once the connection is known; before that, wa.me as always.
    if (marketId && (wa.active || wa.known)) { setWaFor(row); return; }
    window.open(`https://wa.me/${row.customer_phone.replace(/\D/g, "")}`, "_blank", "noopener");
  }, [marketId, wa.active, wa.known]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (newLead) setNewLead(false);
      else if (tray) setTray(null);
      else if (phone && openId) setOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [newLead, tray, phone, openId]);

  const onCreated = useCallback((lead: { id: string; status: string; created_at: string }) => {
    setNewLead(false);
    const bucket = bucketOf({
      status: lead.status as ProspectRow["status"], source: "manual_call", created_at: lead.created_at,
      callback_scheduled_at: null, campaign_id: null, converted_order_id: null, source_order_id: null,
    }, Date.now(), data?.hot_window_minutes);
    toast(t("toast.created", { bucket: t(`buckets.${bucket}`) }));
    setTile("all");
    setQuery("");
    setOpenId(lead.id);
    void mutate();
  }, [data?.hot_window_minutes, mutate, toast, t]);

  const trayFor = (row: ProspectRow) => (
    <LeadOutcome
      key={`${row.id}-${tray?.preset ?? ""}`}
      row={row}
      w={w}
      tz={tz}
      initial={tray?.preset ?? null}
      onClose={() => setTray(null)}
      onSave={(d) => queue(row, d)}
      onWant={convert}
    />
  );

  const detailProps = (row: ProspectRow) => ({
    row, w, now,
    onCall: called,
    onTray: () => setTray({ id: row.id, preset: null }),
    onConvert: convert,
    onOrder: openOrder,
    onCloseLead: () => setTray({ id: row.id, preset: "no" as const }),
  });

  // ── render ──────────────────────────────────────────────────────────────────────────────
  const stats = todayStats(all, now, marketId);
  const urgent = nowCount(all, now);
  const loading = !data && !error;

  const tiles = (
    <section className="bks" aria-label={t("bucketsAria")} role="region">
      {TILE_ORDER.map((k) => {
        const inTile = k === "all" ? all : all.filter((r) => r.bucket === k);
        const value = inTile.reduce((a, r) => a + (r.product_price ?? 0), 0);
        const on = tile === k;
        return (
          <button key={k} type="button" className={`bk h-${BUCKET_HUE[k]}${on ? " on" : ""}`} aria-pressed={on}
            onClick={() => { setTile(k); setOpenId(null); setTray(null); }}>
            <span className="bk-l"><i />{t(`buckets.${k}`)}</span>
            <b>{w.fnum(counts[k])}</b>
            <small>{value ? `${w.fnum(value)} ${w.ccy}` : "—"}</small>
          </button>
        );
      })}
    </section>
  );

  const search = (placeholder: string) => (
    <label className="srch">
      <Ic n="search" />
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoComplete="off" />
    </label>
  );

  const failure = error ? (
    <div className="err" role="alert">
      {t("loadError")}{" "}
      <button type="button" className="btn2 sm" onClick={() => void mutate()}>{t("retry")}</button>
    </div>
  ) : null;

  const empty = (
    <div className="empty"><Ic n="check" /><b>{query.trim() ? t("empty.search") : t("empty.bucket")}</b></div>
  );

  const truncated = data?.truncated ? <p className="q">{t("truncated", { n: all.length })}</p> : null;

  const waSheet = waFor && marketId ? (
    <ProspectWhatsAppSheet row={waFor} market={w.code} marketId={marketId} onClose={() => setWaFor(null)} />
  ) : null;

  const drawer = newLead ? (
    <NewLeadDrawer w={w} marketId={marketId} onClose={() => setNewLead(false)} onCreated={onCreated} />
  ) : null;

  const wrap = (children: React.ReactNode) => (
    <div style={{ display: "contents" }} onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      {children}
      <div ref={tip.ref} className="tip" />
    </div>
  );

  if (phone) {
    const trayRow = tray ? all.find((r) => r.id === tray.id) ?? null : null;
    return wrap(
      <>
        <div className="hscroll">{tiles}</div>
        {search(t("searchPhone"))}
        {failure}
        <section className="list">
          <div className="rows" role="list" aria-label={t("title")} aria-busy={loading}>
            {rows.map((r) => <PhoneRow key={r.id} row={r} w={w} now={now} onOpen={() => setOpenId(r.id)} onCall={called} />)}
            {!loading && rows.length === 0 ? empty : null}
          </div>
        </section>
        {truncated}
        {sel ? (
          <div className="mpanel" role="dialog" aria-label={sel.customer_name}>
            <div className="mback">
              <button type="button" className="xbtn" onClick={() => { setOpenId(null); setTray(null); }} aria-label={t("detail.back")}>
                <Ic n="left" className="flip" />
              </button>
              <b dir="auto">{sel.customer_name}</b>
              <button type="button" className="btn2 sm" onClick={() => whatsapp(sel)}><Ic n="wa" />{t("src.whatsapp")}</button>
            </div>
            <LeadDetail {...detailProps(sel)} phone tray={null} />
          </div>
        ) : null}
        {trayRow ? (
          <>
            <div className="shscrim" onClick={() => setTray(null)} />
            <div className="sheet" role="dialog" aria-label={t("out.title")}>
              <div className="grab" />
              {trayFor(trayRow)}
            </div>
          </>
        ) : null}
        {drawer}
        {waSheet}
      </>,
    );
  }

  return wrap(
    <>
      <header className="ph">
        <div>
          <h1>{t("title")}</h1>
          <div className="sub">
            <span>
              {urgent
                ? t.rich("subNow", { n: urgent, b: (c) => <b style={{ color: "var(--ink)" }}>{c}</b> })
                : t("subCalm")}
            </span>
          </div>
        </div>
        <div className="acts">
          <span className="statp">
            <Ic n="phone" />
            {t.rich("stat", { calls: stats.calls, converted: stats.converted, b: (c) => <b>{c}</b> })}
          </span>
          <button type="button" className="btn" onClick={() => setNewLead(true)}><Ic n="plus" />{t("newLead")}</button>
        </div>
      </header>
      {tiles}
      <div className="tools">
        {search(t("search"))}
        <span className="count">{t.rich("count", { n: w.fnum(rows.length), b: (c) => <b>{c}</b> })}</span>
      </div>
      {failure}
      {loading ? (
        <section className="list sk" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk-row" />)}</section>
      ) : (
        <div className={`split lsplit${sel ? " open" : ""}`}>
          <section className="list">
            <div className="lh lr">
              <span>{t("cols.who")}</span><span>{t("cols.sit")}</span><span>{t("cols.action")}</span><span className="e">{t("cols.value")}</span>
            </div>
            <div className="rows" role="list" aria-label={t("title")}>
              {rows.map((r) => (
                <DeskRow key={r.id} row={r} w={w} now={now} open={r.id === openId}
                  onOpen={() => { setOpenId(r.id); setTray(null); }} onCall={called} onOrder={openOrder} onWhatsApp={whatsapp} />
              ))}
              {rows.length === 0 ? empty : null}
            </div>
            {truncated}
          </section>
          {sel ? (
            <aside className="pcol">
              <LeadDetail {...detailProps(sel)} tray={tray && tray.id === sel.id ? trayFor(sel) : null} />
            </aside>
          ) : null}
        </div>
      )}
      {drawer}
      {waSheet}
    </>,
  );
}

const risky = (r: ProspectRow) => historyOf(r).key === "risk";

/** `leadRowHTML` */
function DeskRow({ row, w, now, open, onOpen, onCall, onOrder, onWhatsApp }: {
  row: ProspectRow; w: CrmWords; now: number; open: boolean;
  onOpen: () => void; onCall: (r: ProspectRow) => void; onOrder: (r: ProspectRow) => void; onWhatsApp: (r: ProspectRow) => void;
}) {
  const { t } = w;
  const sit = leadSit(row, now);
  const v = row.product_price;
  const won = row.bucket === "converted";
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className={`row lr h-${BUCKET_HUE[row.bucket]}${open ? " open" : ""}`} role="listitem" tabIndex={-1} onClick={onOpen}>
      <span className="rail" />
      <div className="oc-t">
        <div className="l1">
          <span className="nm" dir="auto">{row.customer_name}</span>
          {risky(row) ? <span className="tg h-red"><Ic n="alert" />{t("risk")}</span> : null}
        </div>
        <div className="l2">
          <span className="num">{w.phone(row.customer_phone)}</span> · {row.customer_city ?? "—"}
          {row.product_name ? <> · <b dir="auto">{row.product_name}</b></> : null}
        </div>
      </div>
      <div className="actv">
        <span><APill hue={sit.hue} icon={sit.icon} text={w.sitText(sit)} /></span>
        <small>{w.lineNode(leadLine(row, now))}</small>
      </div>
      <div className="la" onClick={stop}>
        {won ? (
          <button type="button" className="btn2 sm" onClick={() => onOrder(row)}><Ic n="ext" className="flip" />{t("act.converted")}</button>
        ) : (
          <a className="btn2 sm callish" href={`tel:${row.customer_phone}`} onClick={() => onCall(row)}><Ic n="phone" />{t(`act.${row.bucket}`)}</a>
        )}
        <button type="button" className="wasq" aria-label="WhatsApp" data-tip={t("whatsapp")} onClick={() => onWhatsApp(row)}><Ic n="wa" /></button>
      </div>
      <div className="amt">
        {v ? <>{w.fnum(v)}<small>{w.ccy}</small></> : <span className="q">—</span>}
        <span className="vk">{won ? t("vk.order") : v ? t("vk.potential") : ""}</span>
      </div>
    </div>
  );
}

/** `crmPhone` — one row: name, product · city, the value, the green call button, the chip. */
function PhoneRow({ row, w, now, onOpen, onCall }: {
  row: ProspectRow; w: CrmWords; now: number; onOpen: () => void; onCall: (r: ProspectRow) => void;
}) {
  const { t } = w;
  const sit = leadSit(row, now);
  const v = row.product_price;
  return (
    <div className={`mrow lm h-${BUCKET_HUE[row.bucket]}`} role="listitem" onClick={onOpen}>
      <span className="rail" />
      <div className="mid">
        <div className="oc-t">
          <span className="nm" dir="auto">{row.customer_name}</span>
          <div className="l2">
            {row.product_name ? <><b dir="auto">{row.product_name}</b> · </> : null}
            {row.customer_city ?? "—"}
          </div>
        </div>
      </div>
      <span className="amt">{v ? <>{w.fnum(v)}<small>{w.ccy}</small></> : null}</span>
      {row.bucket === "converted" ? (
        <span className="cbx" />
      ) : (
        <a className="callb" href={`tel:${row.customer_phone}`} aria-label={t("detail.call")}
          onClick={(e) => { e.stopPropagation(); onCall(row); }}>
          <Ic n="phone" />
        </a>
      )}
      <div className="meta"><span className={`chipm h-${sit.hue}`}><Ic n={sit.icon} />{w.sitText(sit)}</span></div>
    </div>
  );
}

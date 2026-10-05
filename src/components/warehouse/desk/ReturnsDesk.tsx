"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useFormatter, useTranslations } from "next-intl";
import { jsonFetcher } from "@/lib/fetchers";
import { returnTone } from "@/lib/warehouse/desk";
import { RETURN_REASONS, type ReturnReason } from "@/lib/warehouse/returns-validation";
import type { ReturnsQueuePage } from "@/app/api/warehouse/returns/route";
import type { ReturnsStats } from "@/app/api/warehouse/returns/stats/route";
import type { WarehouseHistoryRow } from "@/app/api/warehouse/history/route";
import {
  DeskHeader, DeskPage, Drawer, Eb, Empty, Ic, LiveSub, Pager, Pill, SearchLine, Sec, SiteSeg, Tag, Thumb, Tile, Tiles, fnum, usePaged, useToast,
} from "./ui";
import { useDeskSite } from "./useDeskSite";

/**
 * Entrepôt › Rentrer, on the desk (prototypes/entrepot-desk-v1.html).
 *
 * What Darb holds for us, oldest first. A parcel opens a drawer with two equal
 * choices — Intact (back on the shelf) or Abîmé (a cause, never back) — and
 * « Relivrer » stays secondary in its foot: the parcel goes out again and the
 * shelf does not move.
 *
 * Deviation from the prototype, on purpose: its « Ce que Darb a noté » column
 * is absent. Darb sends no reason — every `to_be_returned` order carries a null
 * carrier status — so the column would be a column of dashes. The parcel's
 * value takes its place: it is what waiting costs.
 */

type Row = ReturnsQueuePage["orders"][number];
type TileKey = "darb" | "way" | "done";
type Cause = ReturnReason;

export function ReturnsDesk({ market, dateLabel, today }: { market: "ly" | "tn"; dateLabel: string; today: string }) {
  const t = useTranslations("warehouse.desk");
  const tr = useTranslations("warehouse.desk.returns");
  const format = useFormatter();
  const { sites, siteId, setSite, nameOf } = useDeskSite();
  const [toast, showToast] = useToast();
  const currency = market === "ly" ? "LYD" : "TND";

  const site = siteId ? `&warehouse_id=${siteId}` : "";
  const { data: darb, mutate } = useSWR<ReturnsQueuePage>(`/api/warehouse/returns?limit=200${site}`, jsonFetcher, {
    revalidateOnFocus: true,
  });
  const { data: way } = useSWR<ReturnsQueuePage>(`/api/warehouse/returns?state=way&limit=200${site}`, jsonFetcher);
  const { data: stats, mutate: mutateStats } = useSWR<ReturnsStats>("/api/warehouse/returns/stats", jsonFetcher);
  const { data: hist, mutate: mutateHist } = useSWR<{ rows: WarehouseHistoryRow[] }>(
    `/api/warehouse/history?kind=return&limit=100&date_from=${today}`,
    jsonFetcher,
  );

  const [tile, setTile] = useState<TileKey>("darb");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Row | null>(null);

  const darbRows = useMemo(() => darb?.orders ?? [], [darb]);
  const wayRows = useMemo(() => way?.orders ?? [], [way]);
  const doneRows = useMemo(() => (hist?.rows ?? []).filter((r) => r.at.slice(0, 10) >= today), [hist, today]);
  const value = darbRows.reduce((s, r) => s + Number(r.total_price ?? 0), 0);

  const match = (vals: Array<string | null | undefined>) => {
    const n = q.trim().toLowerCase();
    return !n || vals.filter(Boolean).some((v) => String(v).toLowerCase().includes(n));
  };
  const listed = (tile === "way" ? wayRows : darbRows).filter((r) =>
    match([r.customer_name, r.product_name, r.customer_city, r.carrier_sticker_ref, r.tracking_number, r.id]),
  );

  const listKey = `${tile}|${q}|${siteId ?? ""}`;
  const [listPage, setListPage] = usePaged(listed, listKey);
  const [donePage, setDonePage] = usePaged(doneRows, listKey);

  /** A sticker scanned into the search line opens that parcel, if it is a return. */
  const lookup = async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const local = darbRows.find((r) => r.carrier_sticker_ref === code || r.tracking_number === code);
    if (local) {
      setOpen(local);
      setQ("");
      return;
    }
    const res = await fetch(`/api/warehouse/returns/lookup?code=${encodeURIComponent(code)}`);
    const body = (await res.json().catch(() => ({}))) as { outcome?: string; order?: Row; status?: string };
    if (body.outcome === "found" && body.order) {
      setOpen({ ...body.order, warehouse_id: null, returned_at: null, days_at_carrier: 0 } as Row);
      setQ("");
    } else if (body.outcome === "wrong_status") {
      showToast(tr("scanWrongStatus", { code, status: body.status ?? "?" }), "bad");
    } else {
      showToast(tr("scanNotFound", { code }), "bad");
    }
  };

  const done = () => {
    setOpen(null);
    void mutate();
    void mutateStats();
    void mutateHist();
  };

  const cols = tile === "done" ? "minmax(260px,1.6fr) 130px 120px 140px" : "minmax(260px,1.6fr) 120px 130px 120px 140px";

  return (
    <DeskPage
      overlay={
        <>
          {open ? <DecideDrawer row={open} site={nameOf(open.warehouse_id)} currency={currency} onClose={() => setOpen(null)} onDone={done} toast={showToast} /> : null}
          {toast}
        </>
      }
    >
      <DeskHeader
        title={tr("title")}
        sub={<LiveSub parts={[t(`market.${market}`), dateLabel]} />}
        acts={<SiteSeg sites={sites} value={siteId} onChange={setSite} />}
      />

      <Tiles n={3}>
        <Tile
          hue="j-ret"
          icon="back"
          n={darbRows.length}
          label={tr("tileDarb")}
          small={value > 0 ? tr.rich("tileDarbSub", { value: fnum(value), currency, em: (c) => <em>{c}</em> }) : tr("tileDarbNone")}
          on={tile === "darb"}
          onClick={() => setTile("darb")}
        />
        <Tile
          hue="h-neutral"
          icon="truck"
          n={wayRows.length}
          label={tr("tileWay")}
          small={tr("tileWaySub")}
          on={tile === "way"}
          onClick={() => setTile(tile === "way" ? "darb" : "way")}
        />
        <Tile
          hue="h-green"
          icon="check"
          n={stats?.doneToday ?? doneRows.length}
          label={tr("tileDone")}
          small={stats && stats.doneToday > 0 ? tr("tileDoneSub", { n: stats.restockedToday }) : tr("tileDoneNone")}
          on={tile === "done"}
          onClick={() => setTile(tile === "done" ? "darb" : "done")}
        />
      </Tiles>

      <SearchLine value={q} onChange={setQ} placeholder={tr("search")} onEnter={(v) => void lookup(v)} />

      <div className="list" style={{ "--cols": cols } as React.CSSProperties}>
        {tile === "done" ? (
          <>
            <div className="lh">
              <span>{tr("colDone")}</span>
              <span>{tr("colAt")}</span>
              <span>{tr("colWho")}</span>
              <span />
            </div>
            <div className="rows">
              {doneRows.length === 0 ? (
                <Empty icon="back">{tr("emptyDone")}</Empty>
              ) : (
                donePage.rows.map((h) => (
                  <div className="row static" key={h.id}>
                    <div className="lt">
                      <Thumb seed={h.product_id ?? h.product_name ?? h.id} />
                      <div>
                        <span className="nm"><bdi>{h.product_name ?? "—"}</bdi></span>
                        <span className="l2">{h.order_number ? `#${h.order_number}` : h.detail}</span>
                      </div>
                    </div>
                    <span className="age">{format.dateTime(new Date(h.at), { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="site">{h.actor?.full_name ?? "—"}</span>
                    <span style={{ justifySelf: "end" }}>
                      {h.is_damaged ? (
                        <Pill hue="h-red" icon="broken">{tr("damaged")}</Pill>
                      ) : h.kind === "return" && (h.qty_change ?? 0) > 0 ? (
                        <Pill hue="h-green" icon="check">{tr("inStock")}</Pill>
                      ) : (
                        <Pill hue="h-neutral" icon="send">{tr("redelivered")}</Pill>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="lh">
              <span>{tr("colParcel")}</span>
              <span className="e">{tr("colValue")}</span>
              <span>{tr("colWait")}</span>
              <span>{tr("colSite")}</span>
              <span />
            </div>
            <div className="rows">
              {listed.length === 0 ? (
                <Empty icon="check">{tile === "way" ? tr("emptyWay") : q ? tr("emptyFiltered") : tr("emptyDarb")}</Empty>
              ) : (
                listPage.rows.map((r) => {
                  const tone = returnTone(r.days_at_carrier);
                  return (
                    <div
                      key={r.id}
                      className="row"
                      data-testid="return-row"
                      onClick={() => (tile === "darb" ? setOpen(r) : undefined)}
                      style={tile === "way" ? { cursor: "default" } : undefined}
                    >
                      <div className="lt">
                        <Thumb seed={r.product_id ?? r.product_name} image={r.product_image_url} />
                        <div>
                          <span className="nm"><bdi>{r.product_name}</bdi>{r.quantity > 1 ? <span style={{ color: "var(--ink-3)" }}> ×{r.quantity}</span> : null}</span>
                          <span className="l2">
                            <b><bdi>{r.customer_name}</bdi></b>
                            {r.customer_city ? <> · <bdi>{r.customer_city}</bdi></> : null}
                            {" · "}
                            <span className="num">{r.carrier_sticker_ref ?? r.tracking_number ?? `#${r.id.slice(0, 6).toUpperCase()}`}</span>
                          </span>
                        </div>
                      </div>
                      <span className="amt e">
                        {fnum(Number(r.total_price))}
                        <small>{currency}</small>
                      </span>
                      <span className={`age ${tone}`}>
                        {tone ? <Ic n="clock" /> : null}
                        {tile === "way" ? tr("daysWay", { n: r.days_at_carrier }) : tr("daysDarb", { n: r.days_at_carrier })}
                      </span>
                      <span className="site">{nameOf(r.warehouse_id) ?? "—"}</span>
                      <span style={{ justifySelf: "end" }}>
                        {tile === "darb" ? (
                          <button type="button" className="btn2 sm" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>
                            <Ic n="back" />
                            {tr("receive")}
                          </button>
                        ) : (
                          <Tag hue="h-neutral">{tr("notYet")}</Tag>
                        )}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
        {tile === "done" ? <Pager paged={donePage} onPage={setDonePage} /> : <Pager paged={listPage} onPage={setListPage} />}
        <div className="lfoot">
          <Ic n="info" />
          <span>{tile === "done" ? tr("footDone") : tr("foot")}</span>
        </div>
      </div>
    </DeskPage>
  );
}

function DecideDrawer({
  row,
  site,
  currency,
  onClose,
  onDone,
  toast,
}: {
  row: Row;
  site: string | null;
  currency: string;
  onClose: () => void;
  onDone: () => void;
  toast: (text: string, tone?: "ok" | "bad") => void;
}) {
  const tr = useTranslations("warehouse.desk.returns");
  const [state, setState] = useState<"ok" | "bad" | null>(null);
  const [cause, setCause] = useState<Cause | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = state === "ok" || (state === "bad" && cause !== null && (cause !== "other" || note.trim().length > 0));

  const post = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? tr("failed"));
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    if (!ready || busy) return;
    const ok = await post("/api/warehouse/scan-return", {
      order_id: row.id,
      is_damaged: state === "bad",
      return_reason: state === "bad" ? cause : null,
      return_reason_note: state === "bad" && cause === "other" ? note.trim() : null,
      return_photo_url: null,
    });
    if (!ok) return;
    toast(state === "ok" ? tr("doneOk", { n: row.quantity, product: row.product_name, site: site ?? "—" }) : tr("doneBad", { cause: tr(`cause.${cause}`) }));
    onDone();
  };

  const redeliver = async () => {
    if (busy || !window.confirm(tr("redeliverConfirm"))) return;
    const ok = await post("/api/warehouse/scan-received", { order_id: row.id });
    if (!ok) return;
    toast(tr("doneRedeliver"));
    onDone();
  };

  return (
    <Drawer
      onClose={onClose}
      label={tr("drawerLabel")}
      head={<Thumb seed={row.product_id ?? row.product_name} image={row.product_image_url} />}
      title={<><bdi>{row.product_name}</bdi> ×{row.quantity}</>}
      sub={
        <>
          <bdi>{row.customer_name}</bdi>
          {row.customer_city ? <> · <bdi>{row.customer_city}</bdi></> : null} · {row.carrier_sticker_ref ?? row.tracking_number ?? `#${row.id.slice(0, 6).toUpperCase()}`}
        </>
      }
      foot={
        <>
          <button type="button" className="btn2" onClick={() => void redeliver()} disabled={busy}>
            <Ic n="send" />
            {tr("redeliver")}
          </button>
          <span className="grow" />
          <button type="button" className="btn" disabled={!ready || busy} onClick={() => void validate()}>
            <Ic n="check" />
            {tr("validate")}
          </button>
        </>
      }
    >
      <Sec>
        <Eb icon="hand">{tr("state")}</Eb>
        <div className="choice">
          <button type="button" className={`ch j-out ${state === "ok" ? "on" : ""}`} aria-pressed={state === "ok"} onClick={() => setState("ok")}>
            <span className="hold"><Ic n="check" /></span>
            <b>{tr("intact")}</b>
            <small>{tr("intactSub", { n: row.quantity, product: row.product_name, site: site ?? "—" })}</small>
          </button>
          <button type="button" className={`ch h-red ${state === "bad" ? "on" : ""}`} aria-pressed={state === "bad"} onClick={() => setState("bad")}>
            <span className="hold"><Ic n="broken" /></span>
            <b>{tr("broken")}</b>
            <small>{tr("brokenSub")}</small>
          </button>
        </div>
        {state === "bad" ? (
          <>
            <Eb>{tr("whatBroke")}</Eb>
            <div className="causes" role="group" aria-label={tr("whatBroke")}>
              {RETURN_REASONS.map((c) => (
                <button key={c} type="button" className={`cz ${cause === c ? "on" : ""}`} aria-pressed={cause === c} onClick={() => setCause(c)}>
                  {tr(`cause.${c}`)}
                </button>
              ))}
            </div>
            {cause === "other" ? (
              <textarea className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("otherNote")} aria-label={tr("otherNote")} />
            ) : null}
          </>
        ) : null}
      </Sec>
      <Sec>
        <Eb icon="clock" aside={tr("daysDarb", { n: row.days_at_carrier })}>{tr("journey")}</Eb>
        <div className="mv">
          <span className="hold h-neutral" style={{ width: 30, height: 30, borderRadius: 9 }}><Ic n="out" /></span>
          <div><b>{site ? tr("leftFrom", { site }) : tr("left")}</b><small>{tr("value", { value: fnum(Number(row.total_price)), currency })}</small></div>
          <span />
        </div>
        <div className="mv">
          <span className="hold h-red" style={{ width: 30, height: 30, borderRadius: 9 }}><Ic n="x" /></span>
          <div><b>{tr("notDelivered")}</b><small>{tr("notDeliveredSub")}</small></div>
          <span />
        </div>
        <div className="mv">
          <span className="hold j-ret" style={{ width: 30, height: 30, borderRadius: 9 }}><Ic n="back" /></span>
          <div><b>{tr("atDarb")}</b><small>{tr("atDarbSub")}</small></div>
          <span />
        </div>
      </Sec>
      {error ? <div className="err" role="alert">{error}</div> : null}
    </Drawer>
  );
}

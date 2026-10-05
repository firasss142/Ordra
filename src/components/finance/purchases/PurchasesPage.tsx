"use client";

// Finances › Achats — prototypes/finances-achats-v1.html, plans/finances-redesign.md.
//
// « Ce que vous devez, à qui, et quand. » A workbench page: four work tiles
// counted now (À payer · À solder · En commande · Fournisseurs), each opening
// exactly the list it counts, and a « Payer » on every bill. Every figure comes
// computed from GET /api/finance/purchases; every write goes through the
// existing reception, purchase-order, supplier and claim routes.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clock, FileText, Info, Layers, Package, PenLine, Plus, Scale, ShoppingCart, Store, Truck, Wallet } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import type { Bill, Bucket, OrderCard, PurchasesView, SupplierCard } from "@/lib/finance/purchases/model";
import { Drawer, Money, makeFmt, useTip, type Fmt, type Loc } from "../kit/ui";
import { OrderDrawer, PayDrawer, SettleDrawer, SupplierDrawer, dateLabel, initials, type OrderPrefill } from "./PurchasesDrawers";
import "../kit/finance-kit.css";
import "./purchases.css";

type View = PurchasesView & { currency: string; marketId: string };
type T = ReturnType<typeof useTranslations>;
type Tile = "pay" | "settle" | "po" | "sup";
const TILES: Tile[] = ["pay", "settle", "po", "sup"];
type Open = { kind: "pay"; id: string } | { kind: "settle"; id: string } | { kind: "po"; prefill: OrderPrefill } | { kind: "sup" } | null;

const b = (c: ReactNode) => <b>{c}</b>;
const em = (c: ReactNode) => <em>{c}</em>;
const HUE = { late: "#E8385A", week: "#F79009", later: "#98A2B3" } as const;

/** « Tadabbur ×300 · قرآن ×20 » — each name isolated, so an Arabic title never reorders its neighbours. */
function Items({ items, f }: { items: { name: string; qty: number }[]; f: Fmt }) {
  return (
    <>
      {items.map((i, k) => (
        <span key={`${i.name}-${k}`}>
          {k > 0 ? " · " : ""}
          <bdi>{i.name}</bdi> ×{f.n(i.qty)}
        </span>
      ))}
    </>
  );
}

export function PurchasesPage({ marketId, marketName, locale }: { marketId: string | null; marketName: string; locale: string }) {
  const t = useTranslations("financePurchases");
  const loc: Loc = locale === "ar" ? "ar" : "fr";
  const sp = useSearchParams();
  const tip = useTip();

  const initial = useMemo(() => {
    const isPo = sp.get("new") === "po";
    const q = Number(sp.get("qty"));
    const tile = isPo ? "po" : ((TILES as string[]).includes(sp.get("tile") ?? "") ? (sp.get("tile") as Tile) : "pay");
    const open: Open = isPo ? { kind: "po", prefill: { site: sp.get("site"), product: sp.get("product"), qty: Number.isInteger(q) && q > 0 ? q : null } } : null;
    return { tile, open };
  }, [sp]);
  const [tile, setTileState] = useState<Tile>(initial.tile);
  const [open, setOpen] = useState<Open>(initial.open);
  const [due, setDue] = useState<Bucket | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { data, error, mutate } = useSWR<View>(marketId ? `/api/finance/purchases?market_id=${marketId}&locale=${loc}` : null, jsonFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
  const f = useMemo(() => makeFmt(loc, data?.currency ?? "LYD"), [loc, data?.currency]);

  const setTile = (k: Tile) => {
    setTileState(k);
    setDue(null);
    const q = new URLSearchParams();
    q.set("tile", k);
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
  };
  const close = useCallback(() => {
    setOpen(null);
    const q = new URLSearchParams(window.location.search);
    for (const k of ["new", "site", "product", "qty"]) q.delete(k);
    window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}`);
  }, []);
  const done = useCallback(
    (msg: string) => {
      close();
      setToast(msg);
      window.setTimeout(() => setToast(null), 3500);
      void mutate();
    },
    [close, mutate],
  );

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const bill = open?.kind === "pay" ? data?.bills.find((x) => x.receptionId === open.id) : undefined;
  const arrival = open?.kind === "settle" ? data?.arrivals.find((x) => x.receptionId === open.id) : undefined;
  const hue = open?.kind === "pay" && bill ? HUE[bill.bucket] : "#98A2B3";
  const labelled = open ? { pay: "dr-pay", settle: "dr-settle", po: "dr-po", sup: "dr-sup" }[open.kind] : "dr-x";

  return (
    <div className="fin fin-achats" onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      <div className="page">
        <header className="ph rise" style={{ ["--d" as string]: 0 }}>
          <div>
            <div className="crumb">
              {t("crumb")} <ChevronRight className="ic flip" aria-hidden /> {t("title")}
            </div>
            <h1>{t("title")}</h1>
            <div className="sub">
              {marketName} <span className="sep" /> {t("sub")}
              {data && (
                <span className="chip">
                  <Clock className="ic" aria-hidden />
                  {dateLabel(loc, data.today, { weekday: "short", day: "numeric", month: "short" })}
                </span>
              )}
            </div>
          </div>
          {marketId && (
            <div className="acts">
              <button className="btn2" type="button" onClick={() => setOpen({ kind: "sup" })} disabled={!data}>
                <Plus className="ic" aria-hidden />
                {t("newSupplier")}
              </button>
              <button className="btn" type="button" onClick={() => setOpen({ kind: "po", prefill: {} })} disabled={!data}>
                <Plus className="ic" aria-hidden />
                {t("newOrder")}
              </button>
            </div>
          )}
        </header>

        {!marketId && (
          <section className="card" style={{ padding: "40px 32px", textAlign: "center", display: "grid", gap: 8 }}>
            <b style={{ fontSize: 17 }}>{t("chooseTitle")}</b>
            <p style={{ color: "var(--ink-3)" }}>{t("chooseText")}</p>
          </section>
        )}
        {marketId && error && <div className="err">{t("error")}</div>}
        {marketId && !data && !error && (
          <>
            <div className="wts-sk">
              {TILES.map((k) => (
                <div key={k} className="sk" style={{ height: 82, borderRadius: 18 }} />
              ))}
            </div>
            <div className="sk" style={{ height: 420 }} />
          </>
        )}

        {data && (
          <>
            <Tiles data={data} f={f} t={t} tile={tile} setTile={setTile} />
            {tile === "pay" && <PayPanel data={data} f={f} t={t} loc={loc} due={due} setDue={setDue} onPay={(id) => setOpen({ kind: "pay", id })} />}
            {tile === "settle" && <SettlePanel data={data} t={t} loc={loc} f={f} onSettle={(id) => setOpen({ kind: "settle", id })} />}
            {tile === "po" && <OrderPanel data={data} f={f} t={t} loc={loc} locale={locale} onNew={(prefill) => setOpen({ kind: "po", prefill })} />}
            {tile === "sup" && <SupplierPanel data={data} f={f} t={t} onDone={done} />}
            <p className="foot rise" style={{ ["--d" as string]: 3 }}>
              <Info className="ic" aria-hidden />
              <span>{t.rich("foot", { b })}</span>
            </p>
          </>
        )}
      </div>

      <Drawer open={!!data && !!open} onClose={close} hue={hue} labelledBy={labelled} closeLabel={t("close")}>
        {data && open?.kind === "pay" && bill && <PayDrawer bill={bill} f={f} t={t} loc={loc} today={today} onClose={close} onDone={done} />}
        {data && open?.kind === "settle" && arrival && <SettleDrawer arrival={arrival} view={data} f={f} t={t} loc={loc} onClose={close} onDone={done} />}
        {data && open?.kind === "po" && <OrderDrawer view={data} prefill={open.prefill} marketName={marketName} f={f} t={t} onClose={close} onDone={done} />}
        {data && open?.kind === "sup" && marketId && <SupplierDrawer marketId={marketId} marketName={marketName} t={t} onClose={close} onDone={done} />}
      </Drawer>
      {toast && (
        <div className="fin-toast" role="status">
          <Check className="ic" aria-hidden />
          {toast}
        </div>
      )}
      <div ref={tip.ref} className="tip" role="tooltip" />
    </div>
  );
}

// ── 1 · the work tiles ───────────────────────────────────────────────────────

function Tiles({ data, f, t, tile, setTile }: { data: View; f: Fmt; t: T; tile: Tile; setTile: (k: Tile) => void }) {
  const x = data.tiles;
  const tiles: { k: Tile; hue: string; icon: ReactNode; big: ReactNode; label: string; sub: ReactNode }[] = [
    { k: "pay", hue: "bad", icon: <Wallet className="ic" aria-hidden />, big: <Money f={f} v={x.owed} />, label: t("tiles.pay"), sub: x.late > 0 ? t.rich("tiles.paySub", { em, v: f.n(Math.round(x.late)) }) : t("tiles.payNone") },
    { k: "settle", hue: "warn", icon: <FileText className="ic" aria-hidden />, big: <>{f.n(x.toSettle)}<span className="u">{t("tiles.settleU", { n: x.toSettle })}</span></>, label: t("tiles.settle"), sub: t("tiles.settleSub") },
    { k: "po", hue: "neutral", icon: <ShoppingCart className="ic" aria-hidden />, big: <>{f.n(x.openOrders)}<span className="u">{t("tiles.poU", { n: x.openOrders })}</span></>, label: t("tiles.po"), sub: t("tiles.poSub", { n: x.arrivingThisWeek }) },
    { k: "sup", hue: "neutral", icon: <Store className="ic" aria-hidden />, big: f.n(x.suppliers), label: t("tiles.sup"), sub: t("tiles.supSub", { n: x.openClaims }) },
  ];
  return (
    <section className="wts rise" style={{ ["--d" as string]: 1 }} aria-label={t("tilesLabel")}>
      {tiles.map((x) => (
        <button key={x.k} className={`wt h-${x.hue}${tile === x.k ? " on" : ""}`} type="button" aria-pressed={tile === x.k} onClick={() => setTile(x.k)}>
          <span className="hold">{x.icon}</span>
          <span className="wt-t">
            <b>{x.big}</b>
            <span>{x.label}</span>
            <small>{x.sub}</small>
          </span>
        </button>
      ))}
    </section>
  );
}

// ── À payer ──────────────────────────────────────────────────────────────────

function dueText(bl: Bill, t: T, loc: Loc) {
  if (bl.bucket === "late") return { text: t("pay.daysLate", { n: bl.daysLate ?? 0 }), tip: bl.dueAt ? t("pay.dueTip", { day: dateLabel(loc, bl.dueAt) }) : "" };
  if (!bl.dueAt) return { text: t("pay.noDue"), tip: t("pay.noDueTip") };
  const day = dateLabel(loc, bl.dueAt);
  return { text: bl.daysLeft === 0 ? t("pay.dueToday") : t("pay.dueIn", { n: bl.daysLeft ?? 0, day }), tip: t("pay.dueTip", { day }) };
}

function PayPanel({ data, f, t, loc, due, setDue, onPay }: { data: View; f: Fmt; t: T; loc: Loc; due: Bucket | null; setDue: (b: Bucket | null) => void; onPay: (id: string) => void }) {
  const nSup = new Set(data.bills.map((x) => x.supplierId ?? x.supplierName)).size;
  return (
    <section className="card panel rise" style={{ ["--d" as string]: 2 }} aria-label={t("pay.title")}>
      <div className="chead">
        <div>
          <h2>{t("pay.title")}</h2>
          <p className="q">{t("pay.q", { v: f.money(data.tiles.owed), n: nSup })}</p>
        </div>
        <div className="rt">
          <span className="cmp">{t("pay.rule")}</span>
        </div>
      </div>
      {data.bills.length > 0 && (
        <div className="due" style={{ gridTemplateColumns: data.buckets.map((s) => `minmax(150px,${Math.max(s.total, 1)}fr)`).join(" ") }} role="group" aria-label={t("pay.dueLabel")}>
          {data.buckets.map((s) => (
            <button
              key={s.key}
              className={`dseg s-${s.key === "late" ? "bad" : s.key === "week" ? "warn" : "flat"}${due === s.key ? " on" : ""}`}
              type="button"
              aria-pressed={due === s.key}
              data-tip={`${t(`pay.${s.key}`)} · ${f.money(s.total)}${s.suppliers.length ? `\n${s.suppliers.join(" · ")}` : ""}`}
              onClick={() => setDue(due === s.key ? null : s.key)}
            >
              <i />
              <span>
                <em />
                {t(`pay.${s.key}`)}
              </span>
              <b><Money f={f} v={s.total} /></b>
              <small>
                {t("pay.bucketSub", { n: s.count })}
                {s.suppliers.map((n) => (
                  <span key={n}>
                    {" · "}
                    <bdi>{n}</bdi>
                  </span>
                ))}
              </small>
            </button>
          ))}
        </div>
      )}
      {data.unknownBills > 0 && (
        <div className="lead">
          <Info className="ic" aria-hidden />
          <span>{t("pay.unknown", { n: data.unknownBills })}</span>
        </div>
      )}
      {data.bills.length === 0 ? (
        <p className="empty in-panel">{t("pay.empty")}</p>
      ) : (
        <div className="rows">
          {data.bills.map((bl) => {
            const d = dueText(bl, t, loc);
            const wPaid = bl.total > 0 ? (bl.paid / bl.total) * 100 : 0;
            const wHeld = bl.total > 0 ? (bl.held / bl.total) * 100 : 0;
            const name = bl.supplierName ?? "—";
            const what = [bl.receivedOn ? t("pay.received", { day: dateLabel(loc, bl.receivedOn) }) : null, bl.siteName].filter(Boolean).join(" · ");
            return (
              <div key={bl.receptionId} className={`rw bill${due && due !== bl.bucket ? " dim" : ""}`}>
                <span className="sav">{initials(name)}</span>
                <div className="who">
                  <div className="l1">
                    <b dir="auto">{name}</b>
                    {bl.held > 0 && (
                      <span className="tg warn" data-tip={bl.heldUnits ? t("pay.heldUnitsTip", { n: bl.heldUnits }) : t("pay.heldTip", { v: f.n(bl.held) })}>
                        <Scale className="ic" aria-hidden />
                        {bl.heldOpen ? t("pay.held", { v: f.n(bl.held) }) : t("pay.heldCredited", { v: f.n(bl.held) })}
                      </span>
                    )}
                  </div>
                  <div className="l2">
                    <b>{bl.ref ?? "—"}</b> · <Items items={bl.items} f={f} />
                    {what ? ` · ${what}` : ""}
                  </div>
                </div>
                <div className="prog">
                  <small>{t.rich("pay.paid", { b, paid: f.n(bl.paid), total: f.n(bl.total) })}</small>
                  <div className="pbarx" data-tip={`${t("pay.paidTip", { paid: f.n(bl.paid), total: f.money(bl.total) })}${bl.held ? `\n${t("pay.heldTip", { v: f.n(bl.held) })}` : ""}`}>
                    <i style={{ width: `${wPaid}%` }} />
                    {bl.held > 0 && <i className="held" style={{ width: `${wHeld}%` }} />}
                  </div>
                </div>
                {bl.bucket === "late" ? (
                  <span className="pill bad" data-tip={d.tip}>
                    <AlertTriangle className="ic" aria-hidden />
                    {d.text}
                  </span>
                ) : (
                  <span className={`pill${bl.bucket === "week" ? " warn" : ""}`} data-tip={d.tip}>
                    <i className="dot" style={bl.bucket === "later" ? { color: "#98A2B3" } : undefined} />
                    {d.text}
                  </span>
                )}
                <div className="left">
                  <b><Money f={f} v={bl.left} /></b>
                  <small>{t("pay.left")}</small>
                </div>
                <button className="btn sm" type="button" onClick={() => onPay(bl.receptionId)}>
                  <Wallet className="ic" aria-hidden />
                  {t("pay.action")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── À solder ─────────────────────────────────────────────────────────────────

function SettlePanel({ data, t, loc, f, onSettle }: { data: View; t: T; loc: Loc; f: Fmt; onSettle: (id: string) => void }) {
  const sup = new Map(data.suppliers.map((s) => [s.id, s.name]));
  return (
    <section className="card panel rise" style={{ ["--d" as string]: 2 }} aria-label={t("settle.title")}>
      <div className="chead">
        <div>
          <h2>{t("settle.title")}</h2>
          <p className="q">{t("settle.q", { n: data.arrivals.length })}</p>
        </div>
      </div>
      <div className="lead">
        <Info className="ic" aria-hidden />
        <span>{t.rich("settle.lead", { b })}</span>
      </div>
      {data.arrivals.length === 0 ? (
        <p className="empty in-panel">{t("settle.empty")}</p>
      ) : (
        <div className="rows">
          {data.arrivals.map((a) => {
            const time = new Intl.DateTimeFormat(loc === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Tripoli" }).format(new Date(a.countedAt));
            const who = [a.supplierId ? sup.get(a.supplierId) : null, a.countedBy ? t("settle.countedBy", { who: a.countedBy }) : null, t("settle.countedAt", { time })].filter(Boolean);
            return (
              <div key={a.receptionId} className="rw arr">
                <span className="hold"><Package className="ic" aria-hidden /></span>
                <div className="who">
                  <div className="l1">
                    <b>{a.siteName ?? "—"}{a.day ? ` · ${dateLabel(loc, a.day, { weekday: "long", day: "numeric", month: "short" })}` : ""}</b>
                  </div>
                  <div className="l2" dir="auto">{who.join(" · ")}</div>
                </div>
                <div className="what">
                  <b><Items items={a.lines.map((l) => ({ name: l.variant ? `${l.name} · ${l.variant}` : l.name, qty: l.received }))} f={f} /></b>
                  <small>
                    <Check className="ic" aria-hidden />
                    {t("settle.inStock", { n: f.n(a.units) })}
                    {a.damaged > 0 && <span className="dmg"> · {t("settle.damaged", { n: f.n(a.damaged) })}</span>}
                  </small>
                </div>
                <span>
                  {a.poRefs.length ? (
                    <span className="tg"><FileText className="ic" aria-hidden />{a.poRefs.join(", ")}</span>
                  ) : (
                    <span className="tg warn" data-tip={t("settle.noPoTip")}><Info className="ic" aria-hidden />{t("settle.noPo")}</span>
                  )}
                </span>
                <button className="btn sm" type="button" onClick={() => onSettle(a.receptionId)}>
                  <PenLine className="ic" aria-hidden />
                  {t("settle.action")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── En commande ──────────────────────────────────────────────────────────────

function OrderCardView({ o, f, t, loc }: { o: OrderCard; f: Fmt; t: T; loc: Loc }) {
  const pill =
    o.state === "late" ? <span className="pill bad"><i className="dot" />{t("po.stLate", { n: o.daysLate ?? 0 })}</span>
    : o.state === "partial" ? <span className="pill warn"><i className="dot" />{t("po.stPartial")}</span>
    : o.state === "week" ? <span className="pill good"><i className="dot" />{t("po.stWeek")}</span>
    : <span className="pill">{t("po.stWaiting")}</span>;
  const at = o.received >= o.ordered ? 2 : 1;
  const steps = [t("po.ordered"), o.received > 0 ? t("po.partial") : t("po.waiting"), t("po.done")];
  const name = o.supplierName ?? "—";
  return (
    <article className="glass po">
      <div className="po-h">
        <span className="sav md">{initials(name)}</span>
        <div className="who">
          <div className="l1"><b dir="auto">{name}</b></div>
          <div className="l2"><b>{o.ref}</b> · {o.siteName ?? "—"} · {t("po.orderedOn", { day: dateLabel(loc, o.orderedAt) })}</div>
        </div>
        {pill}
      </div>
      <div className="po-l">
        <span><Items items={o.items} f={f} /></span>
        {o.total === null ? <b className="muted" data-tip={t("po.noPriceTip")}>{t("po.noPrice")}</b> : <b><Money f={f} v={o.total} /></b>}
      </div>
      <div className="prog">
        <small>{t.rich("po.received", { b, r: f.n(o.received), o: f.n(o.ordered) })}</small>
        <div className="pbarx" data-tip={t("po.receivedTip", { r: f.n(o.received), o: f.n(o.ordered) })}>
          <i style={{ width: `${o.ordered > 0 ? Math.min(100, (o.received / o.ordered) * 100) : 0}%` }} />
        </div>
      </div>
      <div className="steps" role="list" aria-label={t("po.steps")}>
        {steps.map((s, i) => (
          <div key={s} role="listitem" className={`st ${i < at ? "done" : i === at ? `now${o.state === "late" || o.state === "partial" ? " warn" : ""}` : ""}`}>
            <i>{i < at ? <Check className="ic" aria-hidden /> : null}</i>
            {s}
          </div>
        ))}
      </div>
      <div className="sched">
        {o.firstReceivedAt ? (
          <div><Check className="ic ok" aria-hidden /><span>{t("po.first", { day: dateLabel(loc, o.firstReceivedAt) })}</span></div>
        ) : (
          <div><Clock className="ic" aria-hidden /><span>{t("po.nothing")}</span></div>
        )}
        {o.received > 0 && o.received < o.ordered && (
          <div><Clock className="ic" aria-hidden /><span>{t.rich("po.rest", { b, n: f.n(o.ordered - o.received) })}</span></div>
        )}
      </div>
      <div className="po-f">
        <Truck className="ic" aria-hidden />
        <span><b>{o.wantedBy ? t("po.wanted", { day: dateLabel(loc, o.wantedBy, { weekday: "long", day: "numeric", month: "short" }) }) : t("po.noWanted")}</b></span>
      </div>
    </article>
  );
}

function OrderPanel({ data, f, t, loc, locale, onNew }: { data: View; f: Fmt; t: T; loc: Loc; locale: string; onNew: (p: OrderPrefill) => void }) {
  return (
    <section className="card panel rise" style={{ ["--d" as string]: 2 }} aria-label={t("po.title")}>
      <div className="chead">
        <div>
          <h2>{t("po.title")}</h2>
          <p className="q">{t("po.q", { n: data.orders.length, v: f.money(data.committed) })}</p>
        </div>
      </div>
      {data.suggestions.length > 0 && (
        <div className="sugg">
          <span><Layers className="ic" aria-hidden />{t("po.sugg")}</span>
          {data.suggestions.map((g) => (
            <span className="sg" key={`${g.productId}-${g.siteId}`}>
              <div>
                <b><bdi>{g.name}</bdi> {f.n(g.qty)} · {g.siteName ?? "—"}</b>
                <small>{g.days != null ? t("po.suggSub", { days: g.days, v: f.money(g.value) }) : t("po.suggSubNoDays", { v: f.money(g.value) })}</small>
              </div>
              <button className="btn2 sm" type="button" onClick={() => onNew({ product: g.productId, site: g.siteId, qty: g.qty })}>{t("po.create")}</button>
            </span>
          ))}
          <a className="link to-stock" href={`/${locale}/dashboard/stock`}>
            {t("po.toStock")}
            <ChevronRight className="ic flip" aria-hidden />
          </a>
        </div>
      )}
      {data.orders.length === 0 ? (
        <p className="empty in-panel">{t("po.empty")}</p>
      ) : (
        <div className="pos-g">
          {data.orders.map((o) => (
            <OrderCardView key={o.id} o={o} f={f} t={t} loc={loc} />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Fournisseurs ─────────────────────────────────────────────────────────────

function ClaimBlock({ s, f, t, onDone }: { s: SupplierCard; f: Fmt; t: T; onDone: (msg: string) => void }) {
  const [menu, setMenu] = useState(false);
  const [credit, setCredit] = useState(false);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = s.claims.reduce((a, c) => a + c.amount, 0);
  const c0 = s.claims[0];
  const why = (c: SupplierCard["claims"][number]) =>
    c.kind === "damaged" ? t("sup.claimDamaged", { units: c.units ?? 0, ref: c.receptionRef ?? "—" }) : c.kind === "shortage" ? t("sup.claimShortage", { ref: c.receptionRef ?? "—" }) : t("sup.claimOverbilled", { ref: c.receptionRef ?? "—" });

  async function resolve(outcome: "credited" | "conceded") {
    if (busy || (outcome === "credited" && !ref.trim())) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/purchases/claims/${c0.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(outcome === "credited" ? { outcome, credit_ref: ref.trim() } : { outcome }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(out.error ?? String(res.status));
      setMenu(false);
      onDone(t("claimDone"));
    } catch (e) {
      setErr(t("writeError", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lit">
      <span className="hold"><Scale className="ic" aria-hidden /></span>
      <div>
        <b>{t("sup.claim", { n: s.claims.length, v: f.n(total) })}</b>
        <small>{why(c0)}</small>
      </div>
      <div className="popw">
        <button className="btn2 sm" type="button" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          {t("sup.resolve")}
          <ChevronDown className="ic" aria-hidden />
        </button>
        {menu && (
          <div className="pop">
            {!credit ? (
              <>
                <button className="mi" type="button" onClick={() => setCredit(true)}>
                  <b>{t("sup.credited")}</b>
                  <small>{t("sup.creditedSub", { name: s.name, v: f.n(c0.amount) })}</small>
                </button>
                <button className="mi" type="button" disabled={busy} onClick={() => void resolve("conceded")}>
                  <b>{t("sup.conceded")}</b>
                  <small>{t("sup.concededSub", { v: f.n(c0.amount) })}</small>
                </button>
              </>
            ) : (
              <div className="fg" style={{ padding: 8 }}>
                <div className="fld">
                  <label htmlFor={`cr-${c0.id}`}>{t("sup.creditRef")}</label>
                  <input id={`cr-${c0.id}`} className="inp" value={ref} onChange={(e) => setRef(e.target.value)} />
                </div>
                <button className="btn sm" type="button" disabled={busy || !ref.trim()} onClick={() => void resolve("credited")}>{t("sup.confirm")}</button>
              </div>
            )}
            {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function SupplierPanel({ data, f, t, onDone }: { data: View; f: Fmt; t: T; onDone: (msg: string) => void }) {
  return (
    <section className="card panel rise" style={{ ["--d" as string]: 2 }} aria-label={t("sup.title")}>
      <div className="chead">
        <div>
          <h2>{t("sup.title")}</h2>
          <p className="q">{t("sup.q", { n: data.suppliers.length })}</p>
        </div>
      </div>
      {data.suppliers.length === 0 ? (
        <p className="empty in-panel">{t("sup.empty")}</p>
      ) : (
        <div className="sups">
          {data.suppliers.map((s) => (
            <article key={s.id} className="glass sup">
              <div className="sup-h">
                <span className="sav">{initials(s.name)}</span>
                <div style={{ minWidth: 0 }}>
                  <h3 dir="auto">{s.name}</h3>
                  <div className="tags">
                    {s.city && <span className="tg" dir="auto">{s.city}</span>}
                    {s.category && <span className="tg" dir="auto">{s.category}</span>}
                    {s.toSettle > 0 && <span className="tg warn"><FileText className="ic" aria-hidden />{t("sup.toSettle", { n: s.toSettle })}</span>}
                  </div>
                </div>
              </div>
              <div className="kv">
                <div>
                  <b className={s.owed ? (s.overdue ? "bad" : "") : "zero"}>{s.owed ? <Money f={f} v={s.owed} /> : "0"}</b>
                  <small>{s.overdue ? t("sup.owedLate") : t("sup.owed")}</small>
                </div>
                <div>
                  <b className={s.openOrders ? "" : "zero"}>{f.n(s.openOrders)}</b>
                  <small>{t("sup.openOrders", { n: s.openOrders })}</small>
                </div>
                <div data-tip={s.fillRate === null ? t("sup.fullNone") : t("sup.fullTip", { n: s.sampleOrders })}>
                  <b className={s.fillRate === null ? "zero" : ""}>{s.fillRate === null ? "—" : `${f.n(s.fillRate)} %`}</b>
                  <small>{t("sup.full")}</small>
                </div>
                <div data-tip={t("sup.delayTip")}>
                  <b className={s.leadTimeDays === null ? "zero" : ""}>{s.leadTimeDays === null ? "—" : t("sup.days", { n: s.leadTimeDays })}</b>
                  <small>{t("sup.delay")}</small>
                </div>
              </div>
              {s.claims.length > 0 && <ClaimBlock s={s} f={f} t={t} onDone={onDone} />}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}


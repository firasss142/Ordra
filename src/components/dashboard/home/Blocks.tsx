"use client";

// The blocks of Accueil v9 (prototypes/dashboard-v9.html): a header (greeting, the
// doors to Performance, the date button), one hero card — « Commandes reçues » and
// « Chiffre d'affaires » as two panels with their sparkline, then a ring and ONE
// ranked list of the stores — and one card per store. Every figure arrives computed
// from the API; the page only draws.

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { shareRound } from "@/lib/dashboard/stores/shares";
import { RING_KEYS, type SparkBar, type StoreCard as Card } from "@/lib/dashboard/stores/view";
import type { Hue } from "@/lib/dashboard/stores/model";
import { DateButton, type DpState } from "./Dates";
import { Ic, MoneyVal, StoreLogo, TrendPct, hueVars, initials, moneyText, useHome } from "./ui";

// ── header ──────────────────────────────────────────────────────────────────

export function Header({ dp, setDp, stale, onRefresh }: { dp: DpState | null; setDp: (d: DpState | null) => void; stale: number | null; onRefresh: () => void }) {
  const c = useHome();
  const { view: v, t, f } = c;
  return (
    <header className="ph">
      <div>
        <h1>{t("head.hello", { name: c.userName })}</h1>
        <div className="sub">
          <span>
            {c.marketName} · {f.dayLong(v.today)}
          </span>
          {stale != null ? (
            <button type="button" className="live stale" onClick={onRefresh}>
              <Ic n="refresh" />
              {t("head.stale", { n: f.n(stale) })}
            </button>
          ) : (
            <span className="live">
              <i />
              {t("head.live", { time: c.timeOf(v.now) })}
            </span>
          )}
        </div>
      </div>
      <div className="ph-r">
        <nav className="doors">
          <Link className="door" href={c.href("performance/orders")}>
            <Ic n="funnel" />
            <span>{t("head.doorOrders")}</span>
          </Link>
          <Link className="door" href={c.href("team/performance")}>
            <Ic n="users" />
            <span>{t("head.doorTeam")}</span>
          </Link>
          <Link className="door" href={c.href("carriers")}>
            <Ic n="route" />
            <span>{t("head.doorDelivery")}</span>
          </Link>
        </nav>
        <DateButton dp={dp} setDp={setDp} />
      </div>
    </header>
  );
}

// ── the hero: two KPI panels, then the breakdown ────────────────────────────

/** A quiet trend inside each KPI — the time the ring cannot show. Today's bar is hatched. */
function KSpark({ bars, money }: { bars: SparkBar[]; money: boolean }) {
  const c = useHome();
  if (bars.length < 3) return null;
  const val = (b: SparkBar) => (money ? b.val : b.n);
  const max = Math.max(1, ...bars.map(val));
  const lastFull = bars.map((b) => !b.part).lastIndexOf(true);
  const lab = (b: SparkBar) => c.f.range(b.from, b.to);
  return (
    <div className="kspark">
      {bars.map((b, i) => (
        <i
          key={b.from}
          className={b.part ? "part" : i === lastFull ? "last" : ""}
          style={{ height: `${val(b) ? Math.max(6, (val(b) / max) * 100).toFixed(1) : 4}%` }}
          data-tip={
            c.t("kpi.sparkTip", { label: lab(b), v: money ? moneyText(c.f, b.val) : c.f.n(b.n) }) + (b.part ? ` · ${c.t("kpi.inProgress")}` : "")
          }
        />
      ))}
    </div>
  );
}

function Kpis() {
  const c = useHome();
  const { view: v, t, f } = c;
  const k = v.kpi;
  let badge: ReactNode = null;
  let cmp: ReactNode = null;
  let caBadge: ReactNode = null;
  let caCmp: ReactNode = null;
  if (c.day) {
    if (k.verdict) {
      const cls = { early: "flat", high: "good", normal: "ok", low: "warn", none: "bad" }[k.verdict];
      badge = (
        <span className={`verdict ${cls}`}>
          <i />
          {t(`kpi.${k.verdict}`)}
        </span>
      );
    }
    if (k.yN != null) {
      cmp = (
        <span className="mchip">
          {t("kpi.yesterday")}
          <b>{f.n(k.yN)}</b>
        </span>
      );
    }
    if (k.yVal != null) {
      caCmp = (
        <span className="mchip">
          {t("kpi.yesterday")}
          <b>
            <MoneyVal v={k.yVal} />
          </b>
        </span>
      );
    }
  } else {
    badge = <TrendPct now={k.n} prev={k.prevN} fmt={(x) => f.n(x)} />;
    cmp = (
      <span className="mchip" data-tip={c.prevName}>
        {t("kpi.before")}
        <b>{f.n(k.prevN ?? 0)}</b>
      </span>
    );
    if (k.val != null) {
      caBadge = k.prevVal ? <TrendPct now={k.val} prev={k.prevVal} fmt={(x) => moneyText(f, x)} /> : null;
      caCmp = (
        <span className="mchip" data-tip={c.prevName}>
          {t("kpi.before")}
          <b>
            <MoneyVal v={k.prevVal ?? 0} />
          </b>
        </span>
      );
    }
  }
  return (
    <div className="kpis">
      <div className="kpi k-ord">
        <div className="k-top">
          <span className="k-ic">
            <Ic n="bag" />
          </span>
          <span className="k-l">{t("kpi.orders")}</span>
        </div>
        <div className="k-mid">
          <b className="k-v">{f.n(k.n)}</b>
          <KSpark bars={k.spark} money={false} />
        </div>
        <div className="k-sub">
          {badge}
          {cmp}
        </div>
      </div>
      {c.owner && k.val != null && (
        <div className="kpi k-ca">
          <div className="k-top">
            <span className="k-ic">
              <Ic n="cash" />
            </span>
            <span className="k-l">{t("kpi.ca")}</span>
            <span className="info" data-tip={t("kpi.caTip")} tabIndex={0} aria-label={t("kpi.caTip")}>
              <Ic n="info" />
            </span>
          </div>
          <div className="k-mid">
            <b className="k-v">
              <MoneyVal v={k.val} />
            </b>
            <KSpark bars={k.spark} money />
          </div>
          <div className="k-sub">
            {caBadge}
            {caCmp}
            {(k.paid ?? 0) > 0 && (
              <span className="k-note">
                {t("kpi.paid")} <b>{moneyText(f, k.paid ?? 0)}</b>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface BrkRow {
  id: string;
  name: string;
  logo: string | null;
  hue: Hue;
  n: number;
  ca: number;
  sh: number;
  zero: boolean;
}

/** The stores in the order of the list: the first six, the rest folded into « N autres ». */
export function breakdownRows(stores: readonly Card[], othersLabel: (n: number) => string): BrkRow[] {
  const top = stores.slice(0, 6);
  const rest = stores.slice(6);
  const rows: BrkRow[] = top.map((x) => ({ id: x.id, name: x.name, logo: x.logo, hue: x.hue, n: x.n, ca: x.ca ?? 0, sh: 0, zero: x.n === 0 && x.alarm }));
  if (rest.length) {
    rows.push({
      id: "",
      name: othersLabel(rest.length),
      logo: null,
      hue: "slate",
      n: rest.reduce((s, x) => s + x.n, 0),
      ca: rest.reduce((s, x) => s + (x.ca ?? 0), 0),
      sh: 0,
      zero: false,
    });
  }
  const sh = shareRound(rows.map((r) => r.n));
  rows.forEach((r, i) => (r.sh = sh[i]));
  return rows;
}

/** The ring for the shape, ONE ranked list for the numbers — every figure appears once. */
function Breakdown({ focus, setPinned, pinned }: { focus: string | null; pinned: string | null; setPinned: (id: string | null) => void }) {
  const c = useHome();
  const { view: v, t, f } = c;
  const tot = v.kpi.n;
  const rows = breakdownRows(v.stores, (n) => t("brk.others", { n: f.n(n) }));
  const R = 84;
  const C = 2 * Math.PI * R;
  const lit = rows.filter((r) => r.n);
  const gap = lit.length > 1 ? 3 : 0;
  let acc = 0;
  const segs = lit.map((r) => {
    const len = (r.n / (tot || 1)) * C;
    const vis = Math.max(len - gap, 1.5);
    const el = (
      <circle
        key={r.id || "others"}
        className={`slice${focus && focus === r.id ? " lit" : ""}`}
        data-store={r.id || undefined}
        cx="100"
        cy="100"
        r={R}
        strokeDasharray={`${vis.toFixed(2)} ${(C + 10).toFixed(2)}`}
        strokeDashoffset={(-acc - gap / 2).toFixed(2)}
        style={hueVars(r.hue)}
      />
    );
    acc += len;
    return el;
  });
  const hit = focus ? rows.find((r) => r.id === focus) : null;
  return (
    <div className="brk" role="group" aria-label={t("brk.aria", { list: rows.map((r) => `${r.name} ${r.n}`).join(", ") })}>
      <div className="donut">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle className="trk" cx="100" cy="100" r={R} />
          <g transform="rotate(-90 100 100)">{segs}</g>
        </svg>
        <div className="pie-c">
          {!tot ? (
            <small>{t("brk.none")}</small>
          ) : hit ? (
            <>
              <b>{f.pct(hit.sh)}</b>
              <small>{hit.name}</small>
            </>
          ) : null}
        </div>
      </div>
      <div className={`lst${c.owner ? "" : " noca"}`}>
        <div className="lrow lh" aria-hidden="true">
          <span />
          <span>{t("brk.store")}</span>
          <span className="r span2">{t("brk.orders")}</span>
          {c.owner && <span className="r">{t("brk.ca")}</span>}
        </div>
        {rows.map((r) => (
          <button
            key={r.id || "others"}
            type="button"
            className={`lrow${focus && focus === r.id ? " lit" : ""}${r.id ? "" : " fold"}`}
            data-store={r.id || undefined}
            aria-pressed={r.id ? pinned === r.id : undefined}
            disabled={!r.id}
            style={hueVars(r.hue)}
            onClick={() => r.id && setPinned(pinned === r.id ? null : r.id)}
          >
            <span className={`sw${r.id ? "" : " slate"}`}>{r.id ? initials(r.name) : "+"}</span>
            <span className="ln">{r.name}</span>
            <b className={`r${r.zero ? " zero" : ""}`}>{f.n(r.n)}</b>
            <span className="r sh">{r.n ? f.pct(r.sh) : "—"}</span>
            {c.owner && <span className="r ca">{r.n ? <MoneyVal v={r.ca} /> : "—"}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Hero() {
  const c = useHome();
  const { view: v, t } = c;
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const focus = hover ?? pinned;

  if (v.waiting) {
    return (
      <section className="card hero">
        <div className="empty">
          <span className="ei">
            <Ic n="store" />
          </span>
          <b>{t("empty.wait", { store: v.waiting.name })}</b>
          <small>{t("empty.waitSub", { when: v.waiting.since ? c.when(v.waiting.since) : "—" })}</small>
          {c.owner && (
            <Link className="btn ghost" href={c.href("system/connections")}>
              <Ic n="plus" />
              {t("stores.connect")}
            </Link>
          )}
        </div>
      </section>
    );
  }
  return (
    <section
      className={`card hero${focus ? " focus" : ""}${c.owner ? "" : " solo"}`}
      onPointerOver={(e) => {
        if (e.pointerType === "touch") return;
        const el = (e.target as HTMLElement).closest?.("[data-store]") as HTMLElement | null;
        setHover(el?.dataset.store ?? null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <Kpis />
      <div className="h-brk">
        <Breakdown focus={focus} pinned={pinned} setPinned={setPinned} />
      </div>
    </section>
  );
}

// ── one card per store ──────────────────────────────────────────────────────

function Spark({ x }: { x: Card }) {
  const max = Math.max(1, ...x.spark.map((b) => b.n));
  const lastFull = x.spark.map((b) => !b.part).lastIndexOf(true);
  return (
    <div className="spark" aria-hidden="true">
      {x.spark.map((b, i) => (
        <i key={i} className={b.part ? "part" : !b.n ? "z" : i === lastFull ? "last" : ""} style={{ height: `${b.n ? Math.max(8, (b.n / max) * 100).toFixed(1) : 6}%` }} />
      ))}
    </div>
  );
}

function Ring({ x }: { x: Card }) {
  const { t, f } = useHome();
  const R = 50;
  const C = 2 * Math.PI * R;
  const gap = 2.5;
  const segs = RING_KEYS.map((k) => [k, x.ring[k]] as const).filter(([, n]) => n);
  let acc = 0;
  const arcs = segs.map(([k, n]) => {
    const len = (n / x.n) * C;
    const whole = n === x.n;
    const vis = whole ? C : Math.max(len - gap, 1.2);
    const off = -acc - (whole ? 0 : gap / 2);
    acc += len;
    return (
      <circle
        key={k}
        className={`sgr k-${k}`}
        cx="60"
        cy="60"
        r={R}
        strokeDasharray={`${vis.toFixed(2)} ${(C + 10).toFixed(2)}`}
        strokeDashoffset={off.toFixed(2)}
        data-tip={t("card.ringTip", { n: f.n(n), o: t(`o.${k}`), pct: f.pct(Math.round((n / x.n) * 100)) })}
      />
    );
  });
  return (
    <div className="ring">
      <svg viewBox="0 0 120 120" role="img" aria-label={segs.map(([k, n]) => `${n} ${t(`o.${k}`)}`).join(", ")}>
        <circle className="tk" cx="60" cy="60" r={R} />
        <g transform="rotate(-90 60 60)">{arcs}</g>
      </svg>
      <div className="rc">
        <b>{f.n(x.ring.del)}</b>
        <small>
          {t("card.ringL")}
          {x.delRate != null && (
            <>
              <br />
              {f.pct(Math.round(x.delRate))}
            </>
          )}
        </small>
      </div>
    </div>
  );
}

function noteOf(c: ReturnType<typeof useHome>, x: Card): { cls: string; icon: string; b: string; s: string } {
  const { t, f } = c;
  const n = x.note;
  const vs = (del: number | null, mkt: number | null) => (del == null || mkt == null ? "" : t("note.vsMarket", { del: f.pct(del), mkt: f.pct(mkt) }));
  switch (n.kind) {
    case "broken": {
      const since = n.broken.since;
      const b = !since ? t("note.brokenNoTime") : c.dayOf(since) === c.view.today ? t("note.broken", { time: c.timeOf(since) }) : t("note.brokenDay", { day: f.day(c.dayOf(since)) });
      return { cls: "bad", icon: "plug", b, s: t("note.brokenSub", { n: n.broken.n }) };
    }
    case "stopped":
      return {
        cls: "bad",
        icon: "moon",
        b: t("note.stopped", { day: f.day(n.stop.since) }),
        s: t("note.stoppedSub", { recent: f.n(n.stop.recent), days: f.n(n.stop.days), usual: f.n(n.stop.usual) }) + (n.ads ? t("note.stoppedAds") : ""),
      };
    case "unmapped":
      // The owner reads the store's CA here (2026-10-08); a manager, who sees no money, keeps the orders to link.
      if (c.owner && x.ca != null) {
        return {
          cls: "ca",
          icon: "cash",
          b: t("note.ca", { v: moneyText(f, x.ca) }),
          s: (x.paid ?? 0) > 0 ? t("note.caPaid", { v: moneyText(f, x.paid ?? 0) }) : t("note.caSub", { n: x.n }),
        };
      }
      return { cls: "warn", icon: "link", b: t("note.unmapped", { n: n.n }), s: t("note.unmappedSub", { platform: t(`platform.${x.platform}`) }) };
    case "waiting":
      return { cls: "new", icon: "clock", b: t("note.waiting"), s: x.connectedAt ? t("note.waitingSub", { when: c.when(x.connectedAt) }) : "" };
    case "todayOk":
      return { cls: "ok", icon: "check", b: t("note.todayOk"), s: t("note.todayOkSub", { ago: c.ago(x.lastAt) }) };
    case "new":
      return { cls: "new", icon: "spark", b: t("note.new"), s: t("note.newSub", { day: x.firstDay ? f.day(x.firstDay) : "—" }) };
    case "few":
      return { cls: "flat", icon: "clock", b: t("note.few"), s: t("note.fewSub") };
    case "best":
      return { cls: "good", icon: "star", b: t("note.best"), s: vs(n.del, n.mkt) };
    case "below":
      return { cls: "warn", icon: "alert", b: t("note.below"), s: vs(n.del, n.mkt) };
    default:
      return { cls: "ok", icon: "check", b: t("note.ok"), s: vs(n.del, n.mkt) };
  }
}

/** The inside of a store card — the same on the desktop card and in the phone's sheet. */
export function CardBody({ x }: { x: Card }) {
  const c = useHome();
  const { t, f } = c;
  const n = noteOf(c, x);
  const pf = t(`platform.${x.platform}`) + (x.sheets ? ` · ${t("card.viaSheets")}` : "");
  const mi = (l: string, v: number) => (
    <div className="mi">
      {l}
      <b className={v ? "" : "z"}>{f.n(v)}</b>
    </div>
  );
  let q: ReactNode;
  if (c.day || !x.n) {
    // the four tiles, in the order an order lives them; a confirmed order not yet sent to the
    // carrier is in none of the four, so it is said underneath — the tiles always add up
    q = (
      <div className="sc-q flat">
        <div className="minis row four">
          {mi(t("card.wait"), x.tiles.wait)}
          {mi(t("card.tried"), x.tiles.tried)}
          {mi(t("card.up"), x.tiles.up)}
          {mi(t("card.rej"), x.tiles.rej)}
        </div>
        {x.tiles.gap > 0 && <div className="mi-gap">{t("card.gap", { n: x.tiles.gap })}</div>}
      </div>
    );
  } else {
    q = (
      <div className="sc-q">
        {x.n >= 30 ? (
          <Ring x={x} />
        ) : (
          <div className="ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle className="tk dash" cx="60" cy="60" r="50" />
            </svg>
            <div className="rc early">
              <small>
                {t("card.early")}
                <br />
                {t("card.earlyS")}
              </small>
            </div>
          </div>
        )}
        <div className="minis">
          <div className="mi">
            {t("card.conf")}
            <b>
              {x.confRate != null ? f.pct(Math.round(x.confRate)) : "—"}
              <small>{f.n(x.conf)}</small>
            </b>
          </div>
          <div className="mi">
            {t("card.ret")}
            <b className={x.ret ? "" : "z"}>{f.n(x.ret)}</b>
          </div>
          {c.owner ? (
            <div className="mi">
              {t("card.paid")}
              <b className={x.paid ? "" : "z"}>
                <MoneyVal v={x.paid ?? 0} />
              </b>
            </div>
          ) : (
            <div className="mi">
              {t("card.rej")}
              <b className={x.rejAll ? "" : "z"}>{f.n(x.rejAll)}</b>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="sc-h">
        <StoreLogo name={x.name} logo={x.logo} />
        <div className="sc-n">
          <b>{x.name}</b>
          <small>{pf}</small>
        </div>
        {x.lastAt && (
          <span className={`fresh ${x.fresh}`} data-tip={t("card.freshTip", { at: c.ago(x.lastAt) })}>
            <i />
            {c.ago(x.lastAt)}
          </span>
        )}
      </div>
      <div className="sc-c">
        <div>
          <div className="cnt">
            <b className={!x.n && x.alarm ? "zero" : ""}>{f.n(x.n)}</b>
            {!c.day && x.prevN != null && <TrendPct now={x.n} prev={x.prevN} fmt={(v) => f.n(v)} />}
            {x.pace && (
              <span className={`verdict sm ${{ high: "good", normal: "ok", low: "warn", none: "bad", early: "flat" }[x.pace]}`}>
                <i />
                {t(`pace.${x.pace}`)}
              </span>
            )}
          </div>
          <div className="sc-sub">{t("card.received", { n: x.n })}</div>
        </div>
        <Spark x={x} />
      </div>
      {x.products.length > 0 && (
        <div className="prods">
          {x.products.slice(0, 2).map((p) => (
            <span key={p} className="pc" data-tip={p}>
              <Ic n="tag" />
              <span>{p}</span>
            </span>
          ))}
          {x.products.length > 2 && (
            <span className="pc more" data-tip={x.products.slice(2).join(" · ")}>
              +{f.n(x.products.length - 2)}
            </span>
          )}
        </div>
      )}
      {q}
      <div className={`note ${n.cls}`}>
        <span className="ni">
          <Ic n={n.icon} />
        </span>
        <div>
          <b>{n.b}</b>
          {n.s && <small>{n.s}</small>}
        </div>
      </div>
    </>
  );
}

export function StoresBlock({ onOpen, view, setView }: { onOpen: (id: string) => void; view: "cards" | "list"; setView: (v: "cards" | "list") => void }) {
  const c = useHome();
  const { view: v, t, f } = c;
  const [open, setOpen] = useState(false);
  if (!v.stores.length && !v.silent.length) return null;
  const key = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(id);
    }
  };
  const statusCls = (x: Card) => {
    const k = noteOf(c, x).cls;
    return k === "bad" ? "bad" : k === "warn" ? "warn" : k === "flat" || k === "new" ? "flat" : "";
  };

  const cards = (
    <div className="cards">
      {v.stores.map((x) => (
        <article
          key={x.id}
          className={`card sc${x.alarm ? " alarm" : ""}`}
          role="button"
          tabIndex={0}
          style={hueVars(x.hue)}
          aria-label={t("stores.open", { name: x.name })}
          onClick={() => onOpen(x.id)}
          onKeyDown={key(x.id)}
        >
          <CardBody x={x} />
        </article>
      ))}
    </div>
  );

  const list = (
    <div className="card slist" role="table">
      <div className="sr hd" role="row">
        <span>{t("stores.title")}</span>
        <span>{t("kpi.orders")}</span>
        <span />
        <span>{t("card.conf")}</span>
        <span>{c.day ? t("card.call") : c.owner ? t("card.paid") : t("card.ret")}</span>
        <span />
        <span />
      </div>
      {v.stores.map((x) => (
        <div key={x.id} className="sr" role="row" tabIndex={0} style={hueVars(x.hue)} onClick={() => onOpen(x.id)} onKeyDown={key(x.id)}>
          <span className="who">
            <StoreLogo name={x.name} logo={x.logo} />
            <span>
              <b>{x.name}</b>
              <small>{t(`platform.${x.platform}`)}</small>
            </span>
          </span>
          <span className="vol">
            <b>{f.n(x.n)}</b>
          </span>
          <span>{!c.day && x.prevN != null ? <TrendPct now={x.n} prev={x.prevN} tip={false} fmt={(n) => f.n(n)} /> : null}</span>
          <span className="num-c">
            {x.confRate != null ? f.pct(Math.round(x.confRate)) : "—"}
            <small>{f.n(x.conf)}</small>
          </span>
          <span className="num-c">{c.day ? f.n(x.tiles.wait + x.tiles.tried) : c.owner ? <MoneyVal v={x.paid ?? 0} /> : f.n(x.ret)}</span>
          <span className={`st ${statusCls(x)}`}>
            <i className="dot" />
            <span>{noteOf(c, x).b}</span>
          </span>
          <span className="go">
            <Ic n="right" />
          </span>
        </div>
      ))}
    </div>
  );

  const rows = (
    <div className="card srows">
      {v.stores.map((x) => {
        const n = noteOf(c, x);
        const alarm = n.cls === "bad" || n.cls === "warn";
        return (
          <div key={x.id} className="prow" role="button" tabIndex={0} style={hueVars(x.hue)} onClick={() => onOpen(x.id)} onKeyDown={key(x.id)}>
            <StoreLogo name={x.name} logo={x.logo} />
            <div className="tx">
              <b>{x.name}</b>
              <small>
                <i className={x.fresh === "live" && !alarm ? "on" : ""} />
                {t(`platform.${x.platform}`)} · {c.ago(x.lastAt)}
              </small>
              {alarm && (
                <div className={`al ${n.cls}`}>
                  <Ic n={n.icon} />
                  <span>{n.b}</span>
                </div>
              )}
            </div>
            <div className="rt">
              <b className={!x.n && x.alarm ? "zero" : ""}>{f.n(x.n)}</b>
              {!c.day && x.prevN != null ? (
                <TrendPct now={x.n} prev={x.prevN} tip={false} fmt={(n) => f.n(n)} />
              ) : x.pace ? (
                <span className="meta sm">{t(`pace.${x.pace}`)}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <section className="stores">
      <div className="sec-h">
        <div>
          <h2>{t("stores.title")}</h2>
          <div className="meta">{c.phone ? t("stores.metaPhone") : t("stores.meta")}</div>
        </div>
        {v.stores.length > 0 && (
          <div className="vt" role="group">
            <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
              <Ic n="grid" />
              {t("stores.cards")}
            </button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
              <Ic n="list" />
              {t("stores.list")}
            </button>
          </div>
        )}
      </div>
      {v.stores.length > 0 && (c.phone ? rows : view === "list" ? list : cards)}
      {v.silent.length > 0 ? (
        <div className={`silent${open ? " open" : ""}`}>
          <button type="button" className="sil-t" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Ic n="moon" />
            {t("stores.silent", { n: v.silent.length })} · <b>{open ? t("stores.hide") : t("stores.show")}</b>
          </button>
          {c.owner && <ConnectLink />}
          <div className="sil-l">
            {v.silent.map((x) => (
              <span key={x.id} className="sil-c" style={hueVars(x.hue) as CSSProperties}>
                <span className="sw mini">{initials(x.name)}</span>
                {x.name} <small>{x.lastAt ? t("stores.silentLast", { ago: c.ago(x.lastAt) }) : t("stores.silentNever")}</small>
              </span>
            ))}
          </div>
        </div>
      ) : (
        c.owner && (
          <div className="silent">
            <ConnectLink />
          </div>
        )
      )}
    </section>
  );
}

function ConnectLink() {
  const c = useHome();
  return (
    <Link className="connect" href={c.href("system/connections")}>
      <Ic n="plus" />
      {c.t("stores.connect")}
    </Link>
  );
}

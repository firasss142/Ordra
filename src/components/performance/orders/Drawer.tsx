"use client";

// The drill-down drawer (prototype `renderDrawer`): the orders behind one
// number, broken down by motif, product, agent and city; a click on a
// breakdown narrows the list; each order opens its own page.

import Link from "next/link";
import useSWR from "swr";
import type { CSSProperties, ReactNode } from "react";
import { jsonFetcher } from "@/lib/fetchers";
import { GROUP, type Bk } from "@/lib/performance/orders/facts";
import type { FamKey } from "@/lib/performance/orders/model";
import type { DrillOrder, DrillView } from "@/lib/performance/orders/view";
import { famIcon, famTone } from "./Flow";
import { useWindowLabel } from "./Dates";
import { Av, Ic, Thumb, Trend, glue, usePerf } from "./ui";

export interface DrillState {
  key: string;
  dsel: { t: "r" | "p" | "a" | "c"; v: string } | null;
  limit: number;
}

const OUT_ICON: Record<string, string> = { del: "check", ret: "ret", rej: "g_refus_client", junk: "g_commande_invalide", pend: "clock" };

function useSpec(key: string): { title: string; tone: string; icon: string } {
  const { t, f } = usePerf();
  const [kind, v] = key.split(":");
  if (kind === "out") return { title: t(`o.${v}`), tone: `var(--o-${v})`, icon: OUT_ICON[v] ?? "clock" };
  if (kind === "fam") return { title: t(`fam.${v}`), tone: famTone(v as FamKey), icon: famIcon(v as FamKey) };
  if (kind === "bk") return { title: t(v === "c" ? "drawer.bkC" : v === "u" ? "drawer.bkU" : "drawer.bkR"), tone: v === "r" ? "var(--o-road)" : "var(--ink-3)", icon: "clock" };
  if (kind === "day") return { title: f.dayLong(v), tone: "var(--accent)", icon: "cal" };
  return { title: t("drawer.stuck"), tone: "var(--o-ret)", icon: "clock" };
}

function Badge({ o }: { o: DrillOrder }) {
  const { t, subLabel } = usePerf();
  const g = GROUP[o.bk as Bk];
  let lab = t(`o1.${g}`);
  let icn: string | null = null;
  if (o.bk === "x" || o.bk === "j" || o.bk === "s") {
    lab = subLabel(o.sub, true);
    icn = o.bk === "x" ? "g_refus_client" : "g_commande_invalide";
  } else if (o.bk === "f") {
    lab = t("drawer.returned", { s: subLabel(o.sub, true) });
    icn = "ret";
  } else if (o.bk === "b") {
    lab = t("drawer.before");
    icn = "stop";
  } else if (o.bk === "c") lab = t("drawer.bkC");
  else if (o.bk === "u") lab = t("drawer.bkU");
  else if (o.bk === "r") lab = t("drawer.bkR");
  const k = o.bk === "r" ? "road" : g;
  return (
    <span className={`badge k-${k}`}>
      {icn && <Ic n={icn} />}
      {glue(lab)}
    </span>
  );
}

export function Drawer({ drill, setDrill, query, locale, tz }: { drill: DrillState | null; setDrill: (d: DrillState | null) => void; query: string; locale: string; tz: string }) {
  const { view, state, t, f, product, agentName, subLabel, fullName } = usePerf();
  const windowLabel = useWindowLabel()(view.window);
  const url = drill
    ? `/api/performance/orders/drill?${query}&drill=${encodeURIComponent(drill.key)}&limit=${drill.limit}${drill.dsel ? `&dsel=${encodeURIComponent(`${drill.dsel.t}:${drill.dsel.v}`)}` : ""}`
    : null;
  const { data } = useSWR<DrillView>(url, jsonFetcher, { keepPreviousData: true });
  const spec = useSpec(drill?.key ?? "stuck");
  const on = !!drill;
  const close = () => setDrill(null);

  const brk = (title: string, tkey: "r" | "p" | "a" | "c", entries: [string, number][], fmt: (k: string) => ReactNode) => {
    if (!drill || !data) return null;
    if (entries.length < 2 && !(entries.length === 1 && drill.dsel)) return null;
    return (
      <div className="dr-sec">
        <h4>{title}</h4>
        {entries.slice(0, 6).map(([k, v]) => {
          const sel = drill.dsel?.t === tkey && drill.dsel.v === k;
          return (
            <button
              key={k}
              type="button"
              className={`br${sel ? " on" : ""}`}
              style={{ "--t": spec.tone } as CSSProperties}
              onClick={() => setDrill({ ...drill, dsel: sel ? null : { t: tkey, v: k }, limit: 40 })}
            >
              {fmt(k)}
              <span className="bar">
                <i style={{ width: `${(v / Math.max(1, data.n)) * 100}%` }} />
              </span>
              <b>{f.n(v)}</b>
            </button>
          );
        })}
      </div>
    );
  };

  const time = (iso: string) =>
    new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

  // « Ouvrir dans Commandes »: same received dates, plus the one agent / product when there is exactly one.
  const oneAgent = drill?.dsel?.t === "a" ? drill.dsel.v : state.ag.length === 1 ? state.ag[0] : null;
  const ks = Object.keys(state.sel);
  const oneProduct = drill?.dsel?.t === "p" ? drill.dsel.v : ks.length === 1 ? ks[0] : null;
  const ordersHref = `/${locale}/orders?date_from=${view.window.from}&date_to=${view.window.to}${oneAgent ? `&agent_id=${oneAgent}` : ""}${oneProduct ? `&product_id=${oneProduct}` : ""}`;
  const hasSel = ks.length > 0 || state.ag.length > 0;

  return (
    <>
      <div className={`scrim${on ? " on" : ""}`} onClick={close} />
      <aside className={`drawer${on ? " on" : ""}`} aria-label={t("drawer.label")} aria-hidden={!on}>
        {on && drill && (
          <>
            <div className="dr-h">
              <span className="lk-ic" style={{ "--t": spec.tone } as CSSProperties}>
                <Ic n={spec.icon} />
              </span>
              <div>
                <h3>{spec.title}</h3>
                <div className="meta">
                  {data
                    ? glue(
                        t("drawer.meta", { n: data.n, nf: f.n(data.n), per: f.n(data.per, data.per < 10 ? 1 : 0), period: windowLabel }) +
                          (hasSel ? ` · ${fullName(state.sel, state.ag)}` : ""),
                      )
                    : t("head.loading")}
                </div>
              </div>
              <button type="button" className="dr-x" aria-label={t("drawer.close")} onClick={close}>
                <Ic n="x" />
              </button>
            </div>
            <div className="dr-b">
              {data && (
                <>
                  <div className="dr-kpi">
                    <span className="rate">
                      {t("drawer.per")} <b>{f.n(data.per, data.per < 10 ? 1 : 0)}</b>
                      <Trend now={data.per} prev={data.prevPer} upGood={spec.tone.includes("del")} />
                    </span>
                    <span className="rate">
                      {t("drawer.prev")} <b>{f.n(data.prevN)}</b>
                    </span>
                    {data.value != null && (
                      <span className="rate" data-tip={t("drawer.valueTip")}>
                        {t("drawer.value")} <b>{f.money(data.value)}</b>
                      </span>
                    )}
                  </div>
                  {brk(t("drawer.byReason"), "r", data.breakdowns.r, (k) => <span>{glue(subLabel(k))}</span>)}
                  {brk(t("drawer.byProduct"), "p", data.breakdowns.p, (k) => (
                    <span className="who">
                      <Thumb id={k} />
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{product(k)?.name ?? "?"}</span>
                    </span>
                  ))}
                  {brk(t("drawer.byAgent"), "a", data.breakdowns.a, (k) => (
                    <span className="who">
                      <Av id={k} />
                      {agentName(k)}
                    </span>
                  ))}
                  {brk(t("drawer.byCity"), "c", data.breakdowns.c, (k) => <span>{k}</span>)}
                  {drill.dsel?.t === "a" && (
                    <Link className="link" href={`/${locale}/team/performance`}>
                      {t("drawer.seeAgent", { name: agentName(drill.dsel.v) })} <Ic n="ext" />
                    </Link>
                  )}
                  <div className="dr-sec">
                    <h4>{drill.dsel ? t("drawer.listFiltered", { nf: f.n(data.total) }) : t("drawer.list", { nf: f.n(data.total) })}</h4>
                    <div className="ol">
                      {data.orders.map((o) => (
                        <Link key={o.id} className="or" href={`/${locale}/orders/${o.id}`}>
                          <code>#{o.ref ?? o.id.slice(0, 6)}</code>
                          <span className="wh">
                            {f.day(dayOf(o.at))} · {time(o.at)}
                          </span>
                          <span className="pp">
                            {o.product && <Thumb id={o.product} />}
                            <span>{o.product ? product(o.product)?.name ?? "?" : "—"}</span>
                            {o.agent && <Av id={o.agent} />}
                            {o.city && <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>{o.city}</span>}
                          </span>
                          <Badge o={o} />
                        </Link>
                      ))}
                    </div>
                    {data.total > data.orders.length && (
                      <button type="button" className="chipb more" onClick={() => setDrill({ ...drill, limit: drill.limit + 40 })}>
                        {t("drawer.more", { nf: f.n(data.total - data.orders.length) })}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="dr-f">
              <Link className="btn" href={ordersHref} data-tip={t("drawer.openTip")}>
                {t("drawer.open")} <Ic n="ext" />
              </Link>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

"use client";

// 2 · Classement — one card per agent (prototype `card`, `ring`, `detail`, `classement`).

import type { CSSProperties, KeyboardEvent } from "react";
import Link from "next/link";
import { ORDER, per100, round100, type Outcomes } from "@/lib/team/performance/model";
import type { CardView } from "@/lib/team/performance/build";
import { Av, CmpBars, Ic, SayBox, Trend, agv, useLeakView, useTp } from "./ui";

function Ring({ o, n, id }: { o: Outcomes; n: number; id: string }) {
  const { t, f } = useTp();
  const R = 70, C = 2 * Math.PI * R, gap = 3.2;
  const p = round100(per100(o));
  let acc = 0;
  const segs: JSX.Element[] = [];
  for (const k of ORDER) {
    const len = (o[k] / o.a) * C;
    if (len <= 0) continue;
    const vis = Math.max(len - gap, 1.2);
    segs.push(
      <circle
        key={k}
        className={`sg k-${k}`}
        cx="88"
        cy="88"
        r={R}
        strokeDasharray={`${vis.toFixed(2)} ${(C + 10).toFixed(2)}`}
        strokeDashoffset={(-acc - gap / 2).toFixed(2)}
        data-tip={t("card.segTip", { label: t(`o1.${k}`), p: p[k], n: o[k], nf: f.n(o[k]) })}
      />,
    );
    acc += len;
  }
  const mid = `tpm-${id}`;
  return (
    <svg className="ringsvg" viewBox="0 0 176 176" aria-hidden="true">
      <defs>
        <mask id={mid} maskUnits="userSpaceOnUse" x="0" y="0" width="176" height="176">
          <circle className="sweep" cx="88" cy="88" r={R} transform="rotate(-90 88 88)" style={{ "--n": n } as CSSProperties} />
        </mask>
      </defs>
      <g mask={`url(#${mid})`}>
        <g className="segs" transform="rotate(-90 88 88)">
          {segs}
        </g>
      </g>
    </svg>
  );
}

function Card({ r, n }: { r: CardView; n: number }) {
  const { t, f, focus, setFocus, agent, prevName } = useTp();
  const leakView = useLeakView();
  const a = agent(r.id), o = r.o, p = round100(per100(o));
  const lk = r.leaks[0];
  const on = focus === r.id;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setFocus(r.id);
    }
  };
  return (
    <article
      className={`ag${on ? " on" : ""}${focus && !on ? " dim" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={on}
      onClick={() => setFocus(r.id)}
      onKeyDown={onKey}
      style={{ ...agv(a), "--n": n, "--t": lk ? leakView(lk).tone : "var(--o-del)" } as CSSProperties}
    >
      <div className="ag-h">
        <Av a={a} />
        <div className="ag-n">
          <b>{a.name}</b>
          <span>{t("card.sub", { n: f.n(o.a), d: f.n(r.days) })}</span>
        </div>
        <span className={`medal m${Math.min(r.rank, 4)}`} data-tip={t("card.place", { rank: r.rank })}>
          {f.n(r.rank)}
        </span>
      </div>
      <div className="ag-ring">
        <Ring o={o} n={n} id={r.id} />
        <div className="rc">
          <div className="n">
            <b>{f.n(Math.round(r.score))}</b>
            <small>/100</small>
          </div>
          <div className="l">{t("card.delivered")}</div>
        </div>
      </div>
      <div className="ag-tr">
        {r.prev != null ? (
          <>
            <Trend now={r.score} prev={r.prev} upGood />
            <span>{t("card.against", { prev: prevName })}</span>
          </>
        ) : (
          <span>{t("card.noPrev")}</span>
        )}
      </div>
      <div className="mini">
        {(["ret", "rej", "junk", "pend"] as const).map((k) => (
          <span key={k} className={`k-${k}`} data-tip={t("card.segTip", { label: t(`o.${k}`), p: p[k], n: o[k], nf: f.n(o[k]) })}>
            <i />
            {f.n(p[k])}
          </span>
        ))}
      </div>
      <div className="ag-b">
        {lk ? (
          <>
            <div>
              <div className="eyebrow">{t("card.leak")}</div>
              <div className="lk-row">
                <span className="lk-ic">
                  <Ic n={leakView(lk).icon} />
                </span>
                <span className="lk-l">{leakView(lk).label}</span>
                <span className="lk-n">{f.n(lk.her)}</span>
              </div>
              <CmpBars lk={lk} />
            </div>
            <SayBox k={lk.key} />
          </>
        ) : (
          <div>
            <div className="eyebrow">{t("card.leak")}</div>
            <div className="noleak">
              <Ic n="check" />
              {t("card.noLeak")}
            </div>
          </div>
        )}
      </div>
      <div className="open-hint">
        {t(on ? "card.close" : "card.open")}
        <Ic n="down" />
      </div>
    </article>
  );
}

/** Her detail: up to three leaks, each with its comparison, its size and the line to tell her. */
function Detail({ r }: { r: CardView }) {
  const { t, f, agent, setFocus, perName, locale } = useTp();
  const leakView = useLeakView();
  const a = agent(r.id);
  return (
    <section className="card xp" style={agv(a)}>
      <div className="xp-h">
        <Av a={a} />
        <div>
          <h3>{t("xp.title", { name: a.name })}</h3>
          <div className="meta">{t("xp.meta", { n: f.n(r.o.a), score: f.n(Math.round(r.score)), period: perName.toLowerCase() })}</div>
        </div>
        <div className="xp-x">
          <Link className="link" href={`/${locale}/team?agent=${encodeURIComponent(r.id)}`}>
            {t("xp.room")} <Ic n="ext" />
          </Link>
          <button className="xbtn" onClick={() => setFocus(r.id)} aria-label={t("xp.close")}>
            <Ic n="x" />
          </button>
        </div>
      </div>
      {r.leaks.length ? (
        <div className="xp-rows">
          {r.leaks.map((lk, i) => {
            const v = leakView(lk), ex = Math.round(lk.ex);
            return (
              <div key={lk.key} className="xp-row" style={{ "--t": v.tone, "--n": 0 } as CSSProperties}>
                <span className="xp-i">{f.n(i + 1)}</span>
                <div className="xp-l">
                  <span className="lk-ic">
                    <Ic n={v.icon} />
                  </span>
                  <b>{v.label}</b>
                  <span className="lk-n">{f.n(lk.her)}</span>
                </div>
                <CmpBars lk={lk} />
                <div className="xp-ex">
                  <b>{t(`xp.ex.${lk.unit}`, { n: ex, nf: f.n(ex) })}</b>
                  {t("xp.exWhy")}
                </div>
                <SayBox k={lk.key} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="xp-none">{t("xp.none")}</div>
      )}
    </section>
  );
}

export function Classement() {
  const { view, t, f, focus, agent } = useTp();
  const { ranked, hors } = view;
  const open = ranked.find((r) => r.id === focus);
  return (
    <section>
      <div className="sec-h">
        <div>
          <h2>{t("rank.title")}</h2>
          <div className="meta" style={{ marginTop: 6 }}>
            {t("rank.meta")}
          </div>
        </div>
        <div className="legend">
          {ORDER.map((k) => (
            <span key={k} className={`k-${k}`}>
              <span className="sw" />
              {t(`o1.${k}`)}
            </span>
          ))}
        </div>
      </div>
      {ranked.length ? (
        <div className="cards">
          {ranked.map((r, i) => (
            <Card key={r.id} r={r} n={i} />
          ))}
        </div>
      ) : (
        <div className="card empty">{t("rank.empty")}</div>
      )}
      {open && <Detail r={open} />}
      {hors.length > 0 && (
        <div className="hors">
          <span>{t("rank.hors")}</span>
          {hors.map((h) => {
            const a = agent(h.id);
            return (
              <span key={h.id} className="chip" style={agv(a)}>
                <Av a={a} />
                <b>{a.name}</b>
                <small>{h.n ? t("rank.horsN", { n: h.n, nf: f.n(h.n) }) : t("rank.horsNone")}</small>
              </span>
            );
          })}
        </div>
      )}
      <div className="fn">{t("rank.fn")}</div>
    </section>
  );
}

"use client";

// 5 · Présence — the day strip (who worked how much, stacked in their colours) and that
// day's shift timelines (prototype `presence`, `drawTimeline`).

import Link from "next/link";
import { segMinutes } from "@/lib/team/performance/model";
import { dayOfWeek } from "@/lib/team/room/time";
import { Av, Ic, agv, useTp, useWidth } from "./ui";

function Timeline({ day }: { day: string }) {
  const { view, t, f, agent, dimIf, setFocus, dur, hm, shortName } = useTp();
  const [ref, hostW] = useWidth<HTMLDivElement>();
  const P = view.presence;
  const all = P.agents.flatMap((a) => Object.values(P.segs[a]).flat());
  const H0 = Math.max(0, Math.floor(Math.min(...all.map((g) => g.b)) / 60) - 1);
  const H1 = Math.min(24, Math.ceil(Math.max(...all.map((g) => g.e)) / 60) + 1);
  const span = (H1 - H0) * 60, X = (m: number) => ((m - H0 * 60) / span) * 100;
  const hours: number[] = [];
  for (let h = H0 + (H0 % 2); h <= H1; h += 2) hours.push(h);
  const trackW = Math.max(200, hostW - 150 - 84 - 118 - 48);
  const grid = hours.map((h) => <i key={h} className="gl" style={{ left: `${X(h * 60)}%` }} />);

  return (
    <div className="tl" ref={ref}>
      <div className="tl-grid">
        <div />
        <div className="tl-hours">
          {hours.map((h) => (
            <span key={h} style={{ left: `${X(h * 60)}%` }}>
              {t("ps.hour", { h })}
            </span>
          ))}
        </div>
        <div className="tl-head">{t("ps.thisDay")}</div>
        <div className="tl-head">{shortName}</div>
        {P.agents.map((id) => {
          const a = agent(id), sg = P.segs[id][day] ?? [], dm = segMinutes(sg), tot = P.totals[id];
          const last = sg[sg.length - 1];
          return (
            <div key={id} className={`tl-row${dimIf(id)}`} style={agv(a)}>
              <div className={`tl-who${dimIf(id)}`} onClick={() => setFocus(id)}>
                <Av a={a} />
                {a.name}
              </div>
              <div className={`track${dimIf(id)}`}>
                {grid}
                {!sg.length && (
                  <div className="tl-none">
                    {t("ps.none")}
                    <i />
                  </div>
                )}
                {sg.map((g, j) => {
                  const out: JSX.Element[] = [];
                  if (j > 0) {
                    const prev = sg[j - 1], gap = g.b - prev.e, wpx = (gap / span) * trackW;
                    out.push(
                      <div key={`b${j}`} className="brk" style={{ left: `${X(prev.e)}%`, width: `${((gap / span) * 100).toFixed(2)}%` }}>
                        {wpx >= 66 && <span>{t("ps.pause", { d: dur(gap) })}</span>}
                      </div>,
                    );
                  }
                  out.push(
                    <div
                      key={`s${j}`}
                      className="sgm"
                      style={{ left: `${X(g.b)}%`, width: `${(((g.e - g.b) / span) * 100).toFixed(2)}%`, animationDelay: `${j * 60}ms` }}
                      data-tip={t("ps.segTip", { b: hm(g.b), e: hm(g.e), d: dur(g.e - g.b), n: g.n, nf: f.n(g.n) })}
                    />,
                  );
                  return out;
                })}
                {sg.length > 0 && (
                  <>
                    <span className="tl-t" style={{ right: `${(100 - X(sg[0].b)).toFixed(2)}%`, marginRight: 8 }}>
                      {hm(sg[0].b)}
                    </span>
                    <span className="tl-t" style={{ left: `${X(last.e).toFixed(2)}%`, marginLeft: ((last.e - last.b) / span) * trackW < 8 ? 14 : 8 }}>
                      {hm(last.e)}
                    </span>
                  </>
                )}
              </div>
              <div className={`tl-v${dimIf(id)}`}>
                {sg.length ? (
                  <>
                    <b>{dur(dm)}</b>
                    <small>
                      {hm(sg[0].b)} → {hm(last.e)}
                    </small>
                  </>
                ) : (
                  <small>—</small>
                )}
              </div>
              <div className={`tl-tot${dimIf(id)}`}>
                <b>{dur(tot.min)}</b>
                <small>{t("ps.total", { n: tot.days, nf: f.n(tot.days), avg: dur(tot.min / Math.max(1, tot.days)) })}</small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Presence({ day, setDay, city }: { day: string | null; setDay: (d: string) => void; city: string }) {
  const { view, t, f, agent, dur, locale } = useTp();
  const P = view.presence;
  const head = (
    <div className="chead">
      <div>
        <h2>{t("ps.title")}</h2>
        <div className="q">{t("ps.q")}</div>
      </div>
    </div>
  );
  if (!P.agents.length || !P.defaultDay) {
    return (
      <section className="card ps">
        {head}
        <div className="empty">{t("ps.empty")}</div>
      </section>
    );
  }
  const d = day && P.days.includes(day) ? day : P.defaultDay;
  const dayMin = (a: string, x: string) => segMinutes(P.segs[a][x]);
  const maxDay = Math.max(1, ...P.days.map((x) => P.agents.reduce((s, a) => s + dayMin(a, x), 0)));
  const i = P.days.indexOf(d);
  const wd = t("ps.wd").split(",");

  return (
    <section className="card ps">
      {head}
      <div className="strip" style={{ gridTemplateColumns: `repeat(${P.days.length},minmax(0,1fr))` }}>
        {P.days.map((x) => {
          const tot = P.agents.reduce((s, a) => s + dayMin(a, x), 0), w = dayOfWeek(x);
          return (
            <button
              key={x}
              className={`dbtn${x === d ? " on" : ""}${w === 5 ? " fri" : ""}`}
              onClick={() => setDay(x)}
              data-tip={`${f.dayLong(x)} · ${tot ? t("ps.dayTip", { d: dur(tot) }) : t("ps.dayNone")}`}
            >
              <span className={`stk${tot ? "" : " zero"}`}>
                {P.agents
                  .filter((a) => dayMin(a, x) > 0)
                  .map((a) => (
                    <i key={a} style={{ ...agv(agent(a)), height: `${Math.max(2, (dayMin(a, x) / maxDay) * 48).toFixed(1)}px` }} />
                  ))}
              </span>
              <span className="wd">{wd[w]}</span>
              <span className="dn">{f.n(Number(x.slice(8)))}</span>
            </button>
          );
        })}
      </div>
      <div className="ps-day">
        <button className="navb" disabled={i <= 0} onClick={() => setDay(P.days[i - 1])} aria-label={t("ps.prevDay")}>
          <Ic n={f.loc === "ar" ? "right" : "left"} />
        </button>
        <button className="navb" disabled={i >= P.days.length - 1} onClick={() => setDay(P.days[i + 1])} aria-label={t("ps.nextDay")}>
          <Ic n={f.loc === "ar" ? "left" : "right"} />
        </button>
        <h3>{f.dayLong(d)}</h3>
        <Link className="link" href={`/${locale}/team?day=${d}`}>
          {t("ps.room")} <Ic n="ext" />
        </Link>
      </div>
      <Timeline day={d} />
      <div className="ps-f">
        <span>
          <i className="pill" />
          {t("ps.legShift")}
        </span>
        <span>
          <i className="dots" />
          {t("ps.legPause")}
        </span>
        <span>{t("ps.tz", { city })}</span>
        <span>{t("ps.legClick")}</span>
      </div>
    </section>
  );
}

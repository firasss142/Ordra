"use client";

// 3 · Débit × taux — the bubble map and its table (prototype `carteShell`, `drawMap`, `mapTable`).

import type { MapPoint } from "@/lib/team/performance/model";
import { Av, useTp, useWidth } from "./ui";

function niceStep(v: number) {
  const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}

type Box = { x: number; y: number; w: number; h: number; prev?: true; id?: string };
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function MapSvg({ width }: { width: number }) {
  const { view, t, f, agent, dimIf, dur } = useTp();
  const pts = view.map.points, tm = view.map.team;
  if (!pts.length || tm.x == null || tm.y == null) return <div className="empty">{t("map.empty")}</div>;
  const W = Math.max(320, width), H = Math.round(Math.max(320, Math.min(420, W * 0.6)));
  const pl = 44, pr = 14, pt = 26, pb = 40;
  const xs = pts.flatMap((p) => [p.x, p.px]).filter((v): v is number => v != null).concat(tm.x);
  const ys = pts.flatMap((p) => [p.y, p.py]).filter((v): v is number => v != null).concat(tm.y);
  const xStep = niceStep((Math.max(...xs) * 1.2) / 5), xMax = Math.ceil((Math.max(...xs) * 1.15) / xStep) * xStep;
  // the rate axis hugs the data: 5-point steps when the spread is small, 10 otherwise
  const ySpread = Math.max(...ys) - Math.min(...ys), yStep = ySpread > 30 ? 10 : 5;
  const yMin = Math.max(0, Math.floor((Math.min(...ys) - 4) / yStep) * yStep), yMax = Math.min(100, Math.ceil((Math.max(...ys) + 4) / yStep) * yStep);
  const X = (v: number) => pl + (v / xMax) * (W - pl - pr), Y = (v: number) => pt + (1 - (v - yMin) / (yMax - yMin)) * (H - pt - pb);
  const x0 = pl, x1 = W - pr, y0 = pt, y1 = H - pb, tx = X(tm.x), ty = Y(tm.y);
  const maxDec = Math.max(...pts.map((p) => p.dec)), R = (p: MapPoint) => 11 + 11 * Math.sqrt(p.dec / maxDec);
  const key = (p: MapPoint) => agent(p.id).color;
  const val = (p: MapPoint) => `${f.n(p.x, 1)}/h · ${f.pct(p.y)}`;

  const xTicks: number[] = [];
  for (let v = 0; v <= xMax + 1e-9; v += xStep) xTicks.push(v);
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += yStep) yTicks.push(v);

  // label placement: try right, left, above, below — keep clear of bubbles, other labels and the frame
  const boxes: Box[] = pts.map((p) => ({ x: X(p.x) - R(p), y: Y(p.y) - R(p), w: R(p) * 2, h: R(p) * 2, id: p.id }));
  // last period's hollow dots are obstacles too
  for (const p of pts) if (p.px != null && p.py != null) boxes.push({ x: X(p.px) - 7, y: Y(p.py) - 7, w: 14, h: 14, prev: true });
  const labels: Box[] = [];
  const placed = new Map<string, { x: number; y: number; anchor: "start" | "end" | "middle" }>();
  for (const p of pts) {
    const bx = X(p.x), by = Y(p.y), r = R(p), name = agent(p.id).name;
    const lw = Math.max(name.length * 8, val(p).length * 6.4) + 6, lh = 32;
    const cands: [number, number, "start" | "end" | "middle"][] = [
      [bx + r + 8, by - lh / 2, "start"],
      [bx - r - 8 - lw, by - lh / 2, "end"],
      [bx - lw / 2, by - r - 8 - lh, "middle"],
      [bx - lw / 2, by + r + 6, "middle"],
    ];
    let pick = cands[0];
    for (const c of cands) {
      const b = { x: c[0], y: c[1], w: lw, h: lh };
      if (b.x < x0 + 4 || b.x + b.w > x1 - 4 || b.y < y0 + 26 || b.y + b.h > y1 - 4) continue;
      if (boxes.some((o) => (o.prev || o.id !== p.id) && hit(b, o)) || labels.some((l) => hit(b, l))) continue;
      pick = c;
      break;
    }
    const b = { x: pick[0], y: pick[1], w: lw, h: lh };
    labels.push(b);
    placed.set(p.id, { x: pick[2] === "end" ? b.x + b.w : pick[2] === "middle" ? b.x + b.w / 2 : b.x, y: b.y, anchor: pick[2] });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={t("map.aria")}>
      <defs>
        {pts.map((p) => (
          <linearGradient key={p.id} id={`tpf-gb-${p.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: `var(--agent-${key(p)}-5)` }} />
            <stop offset="1" style={{ stopColor: `var(--agent-${key(p)}-7)` }} />
          </linearGradient>
        ))}
        <clipPath id="tpf-plot">
          <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx="16" />
        </clipPath>
      </defs>
      <g clipPath="url(#tpf-plot)">
        <rect className="zone z-tl" x={x0} y={y0} width={tx - x0} height={ty - y0} fill="#E9EAFF" opacity=".75" />
        <rect className="zone z-tr" x={tx} y={y0} width={x1 - tx} height={ty - y0} fill="#DDF6EA" opacity=".85" />
        <rect className="zone z-bl" x={x0} y={ty} width={tx - x0} height={y1 - ty} fill="#FFF0DB" opacity=".8" />
        <rect className="zone z-br" x={tx} y={ty} width={x1 - tx} height={y1 - ty} fill="#FFE4EA" opacity=".85" />
      </g>
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx="16" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1.5" />
      {xTicks.map((v) => (
        <g key={`x${v}`}>
          <text className="ax" x={X(v)} y={y1 + 18} textAnchor="middle">
            {f.n(v, xStep < 1 ? 1 : 0)}
          </text>
          {v > 0 && v < xMax && <line x1={X(v)} y1={y0} x2={X(v)} y2={y1} stroke="rgba(15,23,40,.05)" />}
        </g>
      ))}
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <text className="ax" x={x0 - 8} y={Y(v) + 4} textAnchor="end">
            {f.pct(v)}
          </text>
          {v > yMin && v < yMax && <line x1={x0} y1={Y(v)} x2={x1} y2={Y(v)} stroke="rgba(15,23,40,.05)" />}
        </g>
      ))}
      <text className="ax-t" x={x1} y={H - 4} textAnchor="end">
        {t("map.xAxis")}
      </text>
      <text className="ax-t" x={x0} y={y0 - 10} textAnchor="start">
        {t("map.yAxis")}
      </text>
      {/* zone names, quietly in the corners */}
      <text className="zone-l" x={x0 + 14} y={y0 + 20} textAnchor="start" fill="#5B5FC7">{t("map.quad.tl")}</text>
      <text className="zone-l good" x={x1 - 14} y={y0 + 20} textAnchor="end" fill="#067647">{t("map.quad.tr")}</text>
      <text className="zone-l" x={x0 + 14} y={y1 - 12} textAnchor="start" fill="#B54708">{t("map.quad.bl")}</text>
      <text className="zone-l bad" x={x1 - 14} y={y1 - 12} textAnchor="end" fill="#C01048">{t("map.quad.br")}</text>
      {/* team cross */}
      <line x1={tx} y1={y0} x2={tx} y2={y1} stroke="var(--ink-3)" strokeDasharray="4 5" strokeWidth="1.3" />
      <line x1={x0} y1={ty} x2={x1} y2={ty} stroke="var(--ink-3)" strokeDasharray="4 5" strokeWidth="1.3" />
      <text className="team-l" x={tx + 6} y={y0 + 38}>{t("map.teamX", { v: f.n(tm.x, 1) })}</text>
      <text className="team-l" x={x1 - 14} y={ty - 7} textAnchor="end">{t("map.teamY", { v: f.pct(tm.y) })}</text>
      {/* trails (under the bubbles) */}
      {pts.map((p) => {
        if (p.px == null || p.py == null) return null;
        const ax = X(p.px), ay = Y(p.py), bx = X(p.x), by = Y(p.y), d = Math.hypot(bx - ax, by - ay);
        if (d < 4) return null;
        const ex = bx - ((bx - ax) / d) * (R(p) + 4), ey = by - ((by - ay) / d) * (R(p) + 4);
        return (
          <g key={`tr-${p.id}`} className={`bub${dimIf(p.id)}`}>
            <line x1={ax} y1={ay} x2={ex} y2={ey} style={{ stroke: `var(--agent-${key(p)}-5)` }} strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" opacity=".7" />
            <circle cx={ax} cy={ay} r="5" fill="#fff" style={{ stroke: `var(--agent-${key(p)}-5)` }} strokeWidth="2" data-tip={t("map.prevTip", { name: agent(p.id).name, x: f.n(p.px, 1), y: f.pct(p.py) })} />
          </g>
        );
      })}
      {/* bubbles, biggest first so small ones stay on top */}
      {[...pts]
        .sort((a, b) => b.dec - a.dec)
        .map((p) => {
          const bx = X(p.x), by = Y(p.y), r = R(p), a = agent(p.id), l = placed.get(p.id)!;
          const tip =
            t("map.tip", { name: a.name, dec: f.n(p.dec), dur: dur(p.min), x: f.n(p.x, 1), y: f.pct(p.y) }) +
            (p.px != null && p.py != null ? t("map.tipPrev", { x: f.n(p.px, 1), y: f.pct(p.py) }) : "");
          return (
            <g key={p.id} className={`bub${dimIf(p.id)}`} data-focus={p.id} data-tip={tip}>
              <circle cx={bx} cy={by} r={r + 3} fill="#fff" style={{ filter: `drop-shadow(0 6px 12px color-mix(in srgb, var(--agent-${a.color}-5) 35%, transparent))` }} />
              <circle cx={bx} cy={by} r={r} style={{ fill: `url(#tpf-gb-${p.id})` }} />
              <text className="ini" x={bx} y={by} style={{ fontSize: Math.round(r * 0.78) }}>
                {a.name.charAt(0).toUpperCase()}
              </text>
              <text className="lbl-n" x={l.x} y={l.y + 13} textAnchor={l.anchor} style={{ fill: `var(--agent-${a.color}-9)` }}>
                {a.name}
              </text>
              <text className="lbl-v" x={l.x} y={l.y + 28} textAnchor={l.anchor}>
                {val(p)}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

function MapTable() {
  const { view, t, f, agent, dimIf, dur } = useTp();
  const pts = view.map.points, tm = view.map.team;
  if (!pts.length) return <div className="empty">{t("map.empty")}</div>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>{t("map.th.agent")}</th>
          <th>{t("map.th.dec")}</th>
          <th>{t("map.th.shift")}</th>
          <th>{t("map.th.rate")}</th>
          <th>{t("map.th.up")}</th>
          <th>{t("map.th.prev")}</th>
        </tr>
      </thead>
      <tbody>
        {pts.map((p) => (
          <tr key={p.id} className={dimIf(p.id)}>
            <td>
              <span className="who">
                <Av a={agent(p.id)} />
                {agent(p.id).name}
              </span>
            </td>
            <td>{f.n(p.dec)}</td>
            <td>{dur(p.min)}</td>
            <td>{f.n(p.x, 1)}/h</td>
            <td>{f.pct(p.y)}</td>
            <td>
              <span className="muted">{p.px != null && p.py != null ? `${f.n(p.px, 1)}/h · ${f.pct(p.py)}` : "—"}</span>
            </td>
          </tr>
        ))}
        <tr className="team">
          <td>{t("map.team")}</td>
          <td>{f.n(tm.dec)}</td>
          <td>{dur(tm.min)}</td>
          <td>{tm.x != null ? `${f.n(tm.x, 1)}/h` : "—"}</td>
          <td>{tm.y != null ? f.pct(tm.y) : "—"}</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}

/** Owns the measured box, so it measures again each time « Carte » comes back. */
function MapBody() {
  const [ref, width] = useWidth<HTMLDivElement>();
  return (
    <div className="mp-body">
      <div id="map" ref={ref}>
        {width > 0 && <MapSvg width={width} />}
      </div>
    </div>
  );
}

export function DebitMap({ mode, setMode }: { mode: "map" | "table"; setMode: (m: "map" | "table") => void }) {
  const { t } = useTp();
  return (
    <section className="card mp">
      <div className="chead">
        <div>
          <h2>{t("map.title")}</h2>
          <div className="q">{t("map.q")}</div>
        </div>
        <div className="seg sm">
          <button className={mode === "map" ? "on" : ""} onClick={() => setMode("map")}>
            {t("map.map")}
          </button>
          <button className={mode === "table" ? "on" : ""} onClick={() => setMode("table")}>
            {t("map.table")}
          </button>
        </div>
      </div>
      {mode === "map" ? (
        <>
          <MapBody />
          <div className="mp-leg">
            <span>
              <i className="o" />
              {t("map.legNow")}
            </span>
            <span>
              <i className="h" />
              {t("map.legPrev")}
            </span>
            <span>{t("map.legMin")}</span>
          </div>
        </>
      ) : (
        <div className="tblwrap">
          <MapTable />
        </div>
      )}
    </section>
  );
}

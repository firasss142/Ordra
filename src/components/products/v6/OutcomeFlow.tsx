"use client";

// « Ce que sont devenues les N commandes » — the prototype's sankey(), as SVG.
// ONE scale for every band, so a thin ribbon is a small number, never a styling
// choice. Mirrored for Arabic: x is flipped, text anchors keep reading order.

import { useTranslations } from "next-intl";
import { groupDigits, NBSP } from "@/lib/products/format";
import type { CohortCounts } from "@/types/product-overview";
import { useUiLocale } from "./atoms";

/** The outcome hue of a node (products-v6.css: .k-up, .k-rej… — v6 colours, kept). */
type Tone = "up" | "rej" | "del" | "call" | "dlv" | "fly" | "fail" | "wd";

const W = 720;
const H = 320;
const TOP = 34;
const BOT = 10;
const NW = 12;
const GAP = 12;
const X0 = 104;
const X1 = 330;
const X2 = 530;

export function OutcomeFlow({ counts, invoiced }: { counts: CohortCounts; invoiced: boolean }) {
  const t = useTranslations("products.v6");
  const locale = useUiLocale();
  const rtl = locale === "ar";
  const c = counts;
  if (c.received === 0) return null;

  const c1 = (
    [
      ["up", c.uploaded, "up", t("nd_up")],
      ["rej", c.rejected, "rej", t("nd_rej")],
      ["del", c.deleted, "del", t("nd_del")],
      ["cancel", c.cancelled, "del", t("nd_cancel")],
      ["call", c.calling + c.to_upload, "call", t("nd_call")],
    ] as [string, number, Tone, string][]
  ).filter((n) => n[1] > 0);
  const c2 = (
    [
      ["dlv", c.delivered, "dlv", t("nd_dlv")],
      ["fly", c.in_flight, "fly", invoiced ? t("nd_fly") : t("nd_fly_c")],
      ["fail", c.failed, "fail", t("nd_fail")],
      ["wd", c.withdrawn, "wd", t("nd_wd")],
    ] as [string, number, Tone, string][]
  ).filter((n) => n[1] > 0);

  const k = (H - TOP - BOT - GAP * (c1.length - 1)) / c.received;
  const hh = (v: number) => Math.max(v * k, 2.5);
  const c1tot = c1.reduce((s, n) => s + hh(n[1]), 0) + GAP * (c1.length - 1);
  const n0 = { y: TOP + (c1tot - c.received * k) / 2, h: c.received * k };
  const N1: Record<string, { y: number; h: number }> = {};
  const N2: Record<string, { y: number; h: number }> = {};
  let y = TOP;
  for (const n of c1) {
    N1[n[0]] = { y, h: hh(n[1]) };
    y += hh(n[1]) + GAP;
  }
  if (N1.up) {
    let y2 = N1.up.y;
    for (const n of c2) {
      N2[n[0]] = { y: y2, h: hh(n[1]) };
      y2 += hh(n[1]) + 10;
    }
  }

  const mx = (x: number) => (rtl ? W - x : x);
  const dir = rtl ? "rtl" : "ltr";
  const settled = c.delivered + c.failed;
  const pct = (x: number) => `${groupDigits(x * 100)}${rtl ? "%" : `${NBSP}%`}`;

  const rect = (key: string, x: number, yy: number, h: number, cls: string, tip: string) => (
    <rect key={key} className={`nd ${cls}`} x={(rtl ? W - x - NW : x).toFixed(1)} y={yy.toFixed(1)} width={NW} height={h.toFixed(1)} rx="4" data-tip={tip} />
  );
  const rib = (key: string, x0: number, y0: number, x1: number, y1: number, h0: number, h1: number, tone: Tone, tip: string) => {
    const a = mx(x0);
    const b = mx(x1);
    const m = mx((x0 + x1) / 2);
    return (
      <path
        key={key}
        className={`rb k-${tone}`}
        data-tip={tip}
        d={`M${a} ${y0.toFixed(1)} C${m} ${y0.toFixed(1)} ${m} ${y1.toFixed(1)} ${b} ${y1.toFixed(1)} L${b} ${(y1 + h1).toFixed(1)} C${m} ${(y1 + h1).toFixed(1)} ${m} ${(y0 + h0).toFixed(1)} ${a} ${(y0 + h0).toFixed(1)} Z`}
      />
    );
  };
  // A label is name · value · share. In Arabic the prototype set direction="rtl"
  // with dx="6" on each tspan — but dx moves along x, so in a right-to-left run it
  // pushed every figure back over the previous one (« 158 ؟ »). Here an Arabic
  // label is drawn as a LEFT-TO-RIGHT run anchored at its end, parts reversed:
  // read from the right it is still name, value, share, and dx moves forward.
  const label = (key: string, x: number, yy: number, name: string, val: number, share: number | null) => {
    const parts = [
      <tspan key="lb" className="lb">
        {name}
      </tspan>,
      <tspan key="lv" className="lv">
        {groupDigits(val)}
      </tspan>,
      ...(share !== null
        ? [
            <tspan key="lp" className="lp">
              {pct(share)}
            </tspan>,
          ]
        : []),
    ];
    const ordered = (rtl ? [...parts].reverse() : parts).map((p, i) =>
      i === 0 ? p : <tspan key={p.key} className={p.props.className} dx="6">{p.props.children}</tspan>,
    );
    return (
      <text key={key} x={mx(x)} y={yy.toFixed(1)} textAnchor={rtl ? "end" : "start"} direction="ltr">
        {ordered}
      </text>
    );
  };

  const ribbons: JSX.Element[] = [];
  let so = n0.y;
  for (const n of c1) {
    const tn = N1[n[0]];
    const h = n[1] * k;
    ribbons.push(rib(`r1-${n[0]}`, X0 + NW, so, X1, tn.y, h, Math.max(h, tn.h), n[2], `${n[3]} · ${groupDigits(n[1])}\n${t("fl_of_rec", { p: pct(n[1] / c.received) })}`));
    so += h;
  }
  if (N1.up) {
    let so2 = N1.up.y;
    for (const n of c2) {
      const tn = N2[n[0]];
      const h = n[1] * k;
      ribbons.push(rib(`r2-${n[0]}`, X1 + NW, so2, X2, tn.y, h, Math.max(h, tn.h), n[2], `${n[3]} · ${groupDigits(n[1])}\n${t("fl_of_up", { p: pct(n[1] / c.uploaded) })}`));
      so2 += h;
    }
  }
  const c0y = n0.y + n0.h / 2;

  return (
    <div className="flowscroll">
      <svg className="flowsvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("fl_title", { n: groupDigits(c.received) })}>
        {ribbons}
        {rect("n0", X0, n0.y, n0.h, "k-src", `${t("nd_rec")} · ${groupDigits(c.received)}`)}
        {c1.map((n) => rect(`n1-${n[0]}`, X1, N1[n[0]].y, N1[n[0]].h, `k-${n[2]}`, `${n[3]} · ${groupDigits(n[1])}`))}
        {c2.map((n) => rect(`n2-${n[0]}`, X2, N2[n[0]].y, N2[n[0]].h, `k-${n[2]}`, `${n[3]} · ${groupDigits(n[1])}`))}
        <text x={mx(X0 - 12)} y={(c0y - 10).toFixed(1)} textAnchor="end" direction={dir} className="l0">
          {t("nd_rec")}
        </text>
        <text x={mx(X0 - 12)} y={(c0y + 20).toFixed(1)} textAnchor="end" direction={dir} className="v0">
          {groupDigits(c.received)}
        </text>
        {c1.map((n) => {
          const node = N1[n[0]];
          return n[0] === "up"
            ? label(`l1-${n[0]}`, X1, node.y - 11, n[3], n[1], n[1] / c.received)
            : label(`l1-${n[0]}`, X1 + NW + 8, node.y + node.h / 2 + 4.5, n[3], n[1], n[1] / c.received);
        })}
        {c2.map((n) => {
          const node = N2[n[0]];
          const share = (n[0] === "dlv" || n[0] === "fail") && settled ? n[1] / settled : null;
          return label(`l2-${n[0]}`, X2 + NW + 8, node.y + node.h / 2 + 4.5, n[3], n[1], share);
        })}
      </svg>
    </div>
  );
}

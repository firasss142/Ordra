"use client";

// « Aurore calme » (2026-10-05) — the chart that replaced the waffle on the Salle de
// contrôle and both Performance pages: one row per outcome, every bar on the SAME
// scale (the total), so a bar's length is its share and the biggest leak is the
// longest bar. Count first, its share small after it, then the page's own arrow.
// Colours arrive per row (validated palette, docs/design-system.md §2.4); text never
// wears them.

import type { CSSProperties, ReactNode } from "react";
import "./outcome-rows.css";

export interface OutcomeRow {
  key: string;
  label: string;
  /** The outcome's fill — a CSS colour or a background (the overdue hatch). */
  color: string;
  n: number;
  hint?: ReactNode;
  trend?: ReactNode;
  tip?: string;
  /** Draws the count in the alert red (the one thing on the page that needs action). */
  alert?: boolean;
  onClick?: () => void;
}

interface Props {
  label: string;
  rows: OutcomeRow[];
  total: number;
  num: (v: number) => string;
  /** Omit to hide the share column. */
  pct?: (v: number) => string;
}

export function OutcomeRows({ label, rows, total, num, pct }: Props) {
  return (
    <ul className="obr" aria-label={label} data-pct={pct ? "" : undefined}>
      {rows.map((r) => {
        const share = total > 0 ? (r.n / total) * 100 : 0;
        const head = (
          <>
            <span className="obr-l">
              <i className="obr-dot" aria-hidden="true" />
              <span>
                <b>{r.label}</b>
                {r.hint && <small>{r.hint}</small>}
              </span>
            </span>
            <span className="obr-t" aria-hidden="true">
              <i data-fill style={{ width: `${r.n ? share.toFixed(2) : 0}%` }} />
            </span>
            <span className="obr-n">{num(r.n)}</span>
            {pct && <span className="obr-p">{pct(share)}</span>}
            <span className="obr-d">{r.trend}</span>
          </>
        );
        return (
          <li
            key={r.key}
            className={`obr-r${r.alert ? " alert" : ""}`}
            data-k={r.key}
            data-zero={r.n === 0 ? "" : undefined}
            data-tip={r.tip}
            style={{ "--obr-c": r.color } as CSSProperties}
          >
            {r.onClick ? (
              <button type="button" className="obr-in" onClick={r.onClick}>
                {head}
              </button>
            ) : (
              <div className="obr-in">{head}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

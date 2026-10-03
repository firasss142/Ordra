"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Check, Package, TriangleAlert, X } from "lucide-react";
import { CARD, CHIP, LABEL, MONO } from "./ui";
import { POP, RING, SHAKE, SWEEP, useMotion } from "./motion";

/**
 * What a scan turned into, as the prototype draws it (`.outcome`).
 *
 *   ok    a flat green band crosses the card ONCE — motion, not decoration —
 *         and the check badge pops. The stock that moved rides in a chip.
 *   warn  amber, still: the parcel left (or is live at Darb) but somebody has
 *         to read this one, so it never advances on its own.
 *   bad   a short shake, then a sentence that says what to do, not an error
 *         code.
 *
 * Shared by the scan run and by Sortir's sticker-first bind.
 */

export type OutcomeTone = "ok" | "warn" | "bad";

const SURFACE: Record<OutcomeTone, string> = {
  ok: "bg-wh-ok-bg border-wh-ok-edge",
  warn: "bg-wh-warn-bg border-wh-warn-edge",
  bad: "bg-wh-bad-bg border-wh-bad-edge",
};
const BADGE: Record<OutcomeTone, string> = {
  ok: "bg-wh-ok",
  warn: "bg-status-warning",
  bad: "bg-wh-bad",
};

export function OutcomeCard({
  tone,
  outcome,
  title,
  body,
  code,
  codeSize = 30,
  sub,
  testId = "wh-run-result",
  children,
}: {
  tone: OutcomeTone;
  /** What the scan turned into, for tests and for the screen reader's sake. */
  outcome: string;
  title: string;
  /** One sentence under the title (the wrong-building card). */
  body?: React.ReactNode;
  code: string;
  codeSize?: 22 | 24 | 30;
  /** "<product> · <city>" */
  sub?: React.ReactNode;
  testId?: string;
  children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const sweep = useRef<HTMLSpanElement>(null);
  const badge = useRef<HTMLDivElement>(null);
  useMotion(sweep, ...SWEEP, tone === "ok" ? outcome + code : null);
  useMotion(box, ...SHAKE, tone === "bad" ? outcome + code : null);
  useMotion(badge, ...POP, outcome + code);
  const Icon = tone === "ok" ? Check : tone === "warn" ? TriangleAlert : X;

  return (
    <div
      ref={box}
      role={tone === "ok" ? "status" : "alert"}
      data-testid={testId}
      data-outcome={outcome}
      className={`relative overflow-hidden rounded-[16px] border px-[18px] py-[22px] text-center ${SURFACE[tone]}`}
    >
      {tone === "ok" ? (
        <span
          ref={sweep}
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[45%] bg-[rgba(21,128,61,0.10)]"
          style={{ transform: "translateX(-110%)" }}
        />
      ) : null}
      <div
        ref={badge}
        aria-hidden="true"
        className={`mx-auto mb-[12px] grid h-[56px] w-[56px] place-items-center rounded-full text-white ${BADGE[tone]}`}
      >
        <Icon size={28} strokeWidth={3} />
      </div>
      <p className={`relative font-bold text-wm-ink ${tone === "bad" ? "text-[18px]" : "text-[17px]"}`}>{title}</p>
      {body ? <p className="relative mt-[6px] text-[14px] text-wm-ink">{body}</p> : null}
      <p
        dir="ltr"
        className={`relative mb-[4px] mt-[6px] font-semibold tracking-[.04em] text-wm-ink ${MONO}`}
        style={{ fontSize: codeSize }}
      >
        {code}
      </p>
      {sub ? <p className={`relative text-wm-ink-2 ${tone === "bad" ? "text-[12.5px]" : "text-[14px]"}`}>{sub}</p> : null}
      {children}
    </div>
  );
}

/** `.chip.ok` — the stock as the server moved it, read left to right in both languages. */
export function StockChip({ from, to }: { from?: number; to?: number }) {
  const t = useTranslations("warehouse.run");
  return (
    <span data-testid="wh-run-stock" className={`${CHIP} relative mt-[12px] bg-wh-ok-bg text-wh-ok`}>
      <i aria-hidden="true" className="h-[6px] w-[6px] shrink-0 rounded-full bg-wh-ok" />
      {t("stockFx")}{" "}
      <span dir="ltr" className="tabular-nums">
        {from ?? "—"} → {to ?? "—"}
      </span>
    </span>
  );
}

/** The parcel a run hands over next, and the ring that counts down to it. */
export function NextParcel({
  label,
  product,
  quantity,
  line,
  imageUrl,
  auto,
}: {
  label: string;
  product: string;
  quantity: number;
  /** "<city> · <name>" */
  line: React.ReactNode;
  imageUrl?: string | null;
  /** Shows the ring and "passe tout seul". */
  auto: boolean;
}) {
  const t = useTranslations("warehouse.run");
  const ring = useRef<SVGCircleElement>(null);
  useMotion(ring, ...RING, auto ? product + quantity : null);
  return (
    <>
      <p className={`${LABEL} mb-[8px] mt-[20px]`}>{label}</p>
      <div data-testid="wh-run-next" className={`${CARD} p-[18px]`}>
        <div className="flex items-center gap-[12px]">
          <Thumb size={40} imageUrl={imageUrl} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-wm-ink">
              <bdi>{product}</bdi>{" "}
              <span dir="ltr" className="tabular-nums">×{quantity}</span>
            </p>
            <p className="truncate text-[12.5px] text-wm-ink-2">{line}</p>
          </div>
          {auto ? (
            <svg viewBox="0 0 22 22" className="h-[22px] w-[22px] shrink-0" aria-hidden="true">
              <circle cx="11" cy="11" r="9" fill="none" strokeWidth="3" className="stroke-line" />
              <circle
                ref={ring}
                cx="11"
                cy="11"
                r="9"
                fill="none"
                strokeWidth="3"
                className="stroke-brand"
                strokeDasharray="57"
                style={{ strokeDashoffset: 57, transform: "rotate(-90deg)", transformOrigin: "center" }}
              />
            </svg>
          ) : null}
        </div>
      </div>
      {auto ? <p className="mt-[8px] text-center text-[12.5px] text-wm-ink-2">{t("autoNext")}</p> : null}
    </>
  );
}

/**
 * The product tile (`.thumb`): the product's photo when it has one, else a box
 * in the job's tint. The catalogue carries no category, so a book cannot be
 * told from a boxing doll — the box is the honest glyph for both.
 */
export function Thumb({ size, imageUrl }: { size: 40 | 56; imageUrl?: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center overflow-hidden rounded-[10px] bg-job-bg text-job-ink"
      style={{ width: size, height: size }}
    >
      {imageUrl ? (
        // Raw <img>: the project configures no images.remotePatterns.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <Package size={size === 56 ? 24 : 18} strokeWidth={2} />
      )}
    </span>
  );
}

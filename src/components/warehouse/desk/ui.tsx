"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { PAGE_SIZE, pageOf, thumbTint, type Paged } from "@/lib/warehouse/desk";
import { ICON_PATHS, type IconName } from "./icons";
import "./entrepot-desk.css";

/*
 * The Entrepôt desk's building blocks — one per pattern of
 * prototypes/entrepot-desk-v1.html, under its own stylesheet (.ent). Every
 * screen of the section is assembled from these, so a tile, a list or a drawer
 * cannot look one way on Sortir and another on Stock.
 */

export function Ic({ n, className = "" }: { n: IconName; className?: string }) {
  return (
    <svg
      className={`ic ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      // Static paths from icons.ts — never user data.
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[n] }}
    />
  );
}

/** The page ground: the aurora, the 1240 px column. */
export function DeskPage({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  return (
    <div className="ent">
      <div className="page">{children}</div>
      {overlay}
    </div>
  );
}

export function DeskHeader({ title, sub, acts }: { title: ReactNode; sub?: ReactNode; acts?: ReactNode }) {
  return (
    <div className="ph">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {acts ? <div className="acts">{acts}</div> : null}
    </div>
  );
}

/** « Libye · dimanche 4 octobre · en direct ». */
export function LiveSub({ parts, live = true }: { parts: ReactNode[]; live?: boolean }) {
  const t = useTranslations("warehouse.desk");
  const items = parts.filter((p) => p !== null && p !== undefined && p !== "");
  return (
    <>
      {items.map((p, i) => (
        <span key={i} style={{ display: "contents" }}>
          {i > 0 ? <span className="sep" aria-hidden="true" /> : null}
          <span dir="auto">{p}</span>
        </span>
      ))}
      {live ? (
        <>
          <span className="sep" aria-hidden="true" />
          <span className="live">
            <i aria-hidden="true" />
            {t("live")}
          </span>
        </>
      ) : null}
    </>
  );
}

export interface DeskSite {
  id: string;
  name: string;
}

/** Les deux · Tripoli · Benghazi. Hidden where there is one building, or none to choose. */
export function SiteSeg({
  sites,
  value,
  onChange,
  withAll = true,
}: {
  sites: DeskSite[];
  value: string | null;
  onChange: (id: string | null) => void;
  withAll?: boolean;
}) {
  const t = useTranslations("warehouse.desk");
  if (sites.length < 2) return null;
  const options: Array<{ id: string | null; name: string }> = [
    ...(withAll ? [{ id: null, name: t("bothSites") }] : []),
    ...sites,
  ];
  return (
    <div className="seg" role="tablist" aria-label={t("siteLabel")}>
      {options.map((s) => (
        <button
          key={s.id ?? "all"}
          type="button"
          role="tab"
          aria-selected={value === s.id}
          className={value === s.id ? "on" : ""}
          onClick={() => onChange(s.id)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}

export type Hue = "h-neutral" | "h-amber" | "h-green" | "h-red" | "h-violet" | "j-out" | "j-ret" | "j-rec" | "j-cnt";

/**
 * A counted tile. It is a filter: pressing it narrows the list under it.
 * `n={null}` while its figure is on its way — a zero would be a claim the desk cannot make yet.
 */
export function Tile({
  hue,
  icon,
  n,
  label,
  small,
  on,
  onClick,
}: {
  hue: Hue;
  icon: IconName;
  n: number | null;
  label: ReactNode;
  small?: ReactNode;
  on?: boolean;
  onClick?: () => void;
}) {
  const waiting = n === null;
  return (
    <button
      type="button"
      className={`wt ${hue} ${on ? "on" : ""} ${n === 0 ? "zero" : ""} ${waiting ? "wait" : ""}`}
      aria-pressed={!!on}
      aria-busy={waiting || undefined}
      onClick={onClick}
    >
      <span className="hold">
        <Ic n={icon} />
      </span>
      <span className="wt-t">
        {waiting ? <b className="skn" aria-hidden="true" /> : <b>{n.toLocaleString("fr-FR").replace(/\s/g, " ")}</b>}
        <span>{label}</span>
        {small && !waiting ? <small>{small}</small> : null}
      </span>
    </button>
  );
}

/** Stands in for a list's rows until they arrive — instead of its empty state, which would be untrue. */
export function Waiting({ rows = 6, style }: { rows?: number; style?: React.CSSProperties }) {
  const t = useTranslations("warehouse.desk");
  return (
    <div className="waiting" role="status" aria-busy="true" aria-label={t("loading")} style={style}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="wrow" aria-hidden="true">
          <span className="skb th" />
          <span className="skb ln" />
          <span className="skb ln sh" />
        </div>
      ))}
    </div>
  );
}

export function Tiles({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="wts" style={{ "--n": n } as React.CSSProperties}>
      {children}
    </div>
  );
}

/** The one search line. `/` focuses it from anywhere on the page. */
export function SearchLine({
  value,
  onChange,
  placeholder,
  onEnter,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onEnter?: (v: string) => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || !el || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="tools">
      <label className="srch">
        <Ic n="search" />
        <input
          ref={ref}
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) {
              e.preventDefault();
              onEnter(value);
            }
          }}
        />
        <span className="kbd2" aria-hidden="true">
          /
        </span>
      </label>
      {children}
    </div>
  );
}

/**
 * A list's page, 25 rows at a time. `resetOn` names what the list is filtered
 * by: when it changes the list goes back to its first page, because page 3 of
 * a different question is not the operator's place any more.
 */
export function usePaged<T>(rows: T[], resetOn: string): [Paged<T>, (page: number) => void] {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetOn]);
  return [pageOf(rows, page), setPage];
}

/** The pages a pager offers: the ends, and two either side of where you are. */
function pageList(page: number, pages: number): Array<number | "…"> {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: Array<number | "…"> = [];
  let prev = 0;
  for (const n of Array.from(keep).sort((a, b) => a - b)) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}

/**
 * Previous · numbers · next, under a list. Nothing at all when the list fits
 * on one page — a pager that offers « 1 » is noise. Turning a page brings the
 * list's head back into view, or the operator lands mid-list.
 */
export function Pager({
  paged,
  onPage,
}: {
  paged: Pick<Paged<unknown>, "page" | "pages" | "from" | "to" | "total">;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("warehouse.desk.pager");
  const box = useRef<HTMLElement>(null);
  if (paged.pages <= 1) return null;
  const go = (n: number) => {
    onPage(n);
    const list = box.current?.closest(".list");
    if (list && list.getBoundingClientRect().top < 0) list.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };
  return (
    <nav ref={box} className="pager" data-testid="pager" aria-label={t("label")}>
      <span className="pg-r num">{t("range", { from: paged.from, to: paged.to, total: paged.total })}</span>
      <button type="button" className="kb" aria-label={t("prev")} disabled={paged.page <= 1} onClick={() => go(paged.page - 1)}>
        <Ic n="left" className="flip" />
      </button>
      {pageList(paged.page, paged.pages).map((n, i) =>
        n === "…" ? (
          <span key={`gap${i}`} className="pg-gap" aria-hidden="true">…</span>
        ) : (
          <button
            key={n}
            type="button"
            className={`pg-n num ${n === paged.page ? "on" : ""}`}
            aria-label={t("page", { n })}
            aria-current={n === paged.page ? "page" : undefined}
            onClick={() => go(n)}
          >
            {n}
          </button>
        ),
      )}
      <button type="button" className="kb" aria-label={t("next")} disabled={paged.page >= paged.pages} onClick={() => go(paged.page + 1)}>
        <Ic n="right" className="flip" />
      </button>
    </nav>
  );
}

/**
 * The pager of a list the SERVER pages with a cursor (the Journal): it knows
 * where it is and whether more follows, never the total, so it says
 * « 26–50 » and offers back and next only.
 */
export function StepPager({
  page,
  shown,
  hasNext,
  onPrev,
  onNext,
}: {
  page: number;
  shown: number;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const t = useTranslations("warehouse.desk.pager");
  if (page <= 1 && !hasNext) return null;
  const from = (page - 1) * PAGE_SIZE + (shown ? 1 : 0);
  return (
    <nav className="pager" data-testid="pager" aria-label={t("label")}>
      <span className="pg-r num">{t("rangeOpen", { from, to: (page - 1) * PAGE_SIZE + shown })}</span>
      <button type="button" className="kb" aria-label={t("prev")} disabled={page <= 1} onClick={onPrev}>
        <Ic n="left" className="flip" />
      </button>
      <span className="pg-n on num" aria-current="page">{page}</span>
      <button type="button" className="kb" aria-label={t("next")} disabled={!hasNext} onClick={onNext}>
        <Ic n="right" className="flip" />
      </button>
    </nav>
  );
}

/** A product's picture, or a tinted wash with a box when it has none. */
export function Thumb({
  seed,
  image,
  size,
  icon = "box",
}: {
  seed: string;
  image?: string | null;
  size?: "lg";
  icon?: IconName;
}) {
  const [bg, ink] = thumbTint(seed);
  return (
    <span className={`thumb ${size ?? ""}`} style={{ "--tb": bg, "--ti": ink } as React.CSSProperties}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading="lazy" />
      ) : (
        <Ic n={icon} />
      )}
    </span>
  );
}

export function Pill({ hue, icon, children, style }: { hue: Hue; icon?: IconName; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <span className={`pl ${hue}`} style={style}>
      {icon ? <Ic n={icon} /> : null}
      {children}
    </span>
  );
}

export function Tag({ hue, icon, children, style }: { hue: Hue; icon?: IconName; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <span className={`tg ${hue}`} style={style}>
      {icon ? <Ic n={icon} /> : null}
      {children}
    </span>
  );
}

/** A Darb sticker roll: the dot AND its name — a colour alone is not readable. */
export function RollDot({ hex, name }: { hex: string; name: string | null }) {
  return (
    <span className="roll">
      <i className="dot" style={{ "--c": hex } as React.CSSProperties} aria-hidden="true" />
      {name ?? "—"}
    </span>
  );
}

export function Empty({ icon = "check", children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <Ic n={icon} />
      <span>{children}</span>
    </div>
  );
}

/**
 * The floating drawer. Escape and the scrim close it; focus moves into it on
 * open so a keyboard user is not left on the page behind.
 */
export function Drawer({
  onClose,
  wide,
  label,
  head,
  title,
  sub,
  children,
  foot,
}: {
  onClose: () => void;
  wide?: boolean;
  label: string;
  head: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
}) {
  const t = useTranslations("warehouse.desk");
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    box.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={box} tabIndex={-1} className={`drawer ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={label}>
        <div className="dr-top">
          {head}
          <div className="dr-title">
            <b>{title}</b>
            {sub ? <small>{sub}</small> : null}
          </div>
          <button type="button" className="xbtn" onClick={onClose} aria-label={t("close")}>
            <Ic n="x" />
          </button>
        </div>
        <div className="dr-body">{children}</div>
        {foot ? <div className="dr-foot">{foot}</div> : null}
      </aside>
    </>
  );
}

export function Sec({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="sec" style={style}>
      {children}
    </div>
  );
}

export function Eb({ icon, children, aside }: { icon?: IconName; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="eb">
      {icon ? <Ic n={icon} /> : null}
      {children}
      {aside !== undefined && aside !== null ? <span>{aside}</span> : null}
    </div>
  );
}

export interface ToastState {
  text: string;
  tone: "ok" | "bad";
}

/** One toast at a time, gone after a few seconds — the prototype's confirmation. */
export function useToast(): [ReactNode, (text: string, tone?: "ok" | "bad") => void] {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    setToast({ text, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), tone === "bad" ? 6000 : 3200);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const node = toast ? (
    <div className={`toast ${toast.tone === "bad" ? "bad" : ""}`} role="status">
      <Ic n={toast.tone === "bad" ? "alert" : "check"} />
      <span dir="auto">{toast.text}</span>
    </div>
  ) : null;
  return [node, show];
}

/** Grouped figures the French way: 1 240, with a non-breaking space. */
export function fnum(n: number, locale = "fr-FR"): string {
  return Math.round(n).toLocaleString(locale).replace(/\s/g, " ");
}

export function fmoney(n: number, locale = "fr-FR"): string {
  return n.toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/\s/g, " ");
}

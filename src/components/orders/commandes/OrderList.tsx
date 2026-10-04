"use client";

// The list (prototype `listBlock` / `rowHTML`): one glass container holding
// plain white rows with hairlines and no motion. Same columns as before —
// Commande · Montant · Statut · Âge · Agent · Boutique · ⋯ — signals in words.
// Archivées reuses it with « Issue » and « Finie » (or « Supprimée »).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { OrdersListRow } from "@/hooks/useOrdersList";
import type { RejectionBadge } from "@/hooks/useRejectionBadge";
import type { Fmt } from "@/components/performance/orders/ui";
import { ageTone, rowTags } from "@/lib/orders/row-signals";
import { PAGE_SIZE_OPTIONS, type PageSize } from "@/lib/orders/list-filters";
import { Avatar, FreeAvatar, Ic, RowTags, StatusPill, StoreTag, Thumb, ageWords, type PillOrder, type StoreInfo, type When } from "./ui";

export type ListMode = "list" | "eligible" | "archived" | "recent" | "deleted";

export interface RowAction {
  key: string;
  icon: string;
  label: string;
  neg?: boolean;
  /** Opens a second level (the agents) instead of acting. */
  agents?: boolean;
}

export interface OrderListProps {
  mode: ListMode;
  rows: OrdersListRow[];
  loading: boolean;
  total: number | null;
  page: number;
  pageSize: PageSize;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onPageSize: (n: PageSize) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  openId: string | null;
  onOpen: (id: string) => void;
  hasFilters: boolean;
  onClearAll: () => void;
  f: Fmt;
  when: When;
  maxAttempts: number | null;
  slaMinutes: number | null;
  rejection: (o: PillOrder) => RejectionBadge | null;
  agentName: (id: string) => string | null;
  store: (id: string | null) => StoreInfo | undefined;
  /** Whether the assignee is inside the order right now (managers only). */
  isHere?: (row: OrdersListRow) => boolean;
  actionsFor: (row: OrdersListRow) => RowAction[];
  agents: { id: string; full_name: string }[];
  onAction: (row: OrdersListRow, key: string, agentId?: string | null) => void;
}

export function OrderList(p: OrderListProps) {
  const t = useTranslations("commandes");
  const arch = p.mode !== "list";
  const head = arch
    ? [t("cols.order"), t("cols.amount"), p.mode === "deleted" ? t("cols.status") : t("cols.outcome"), p.mode === "deleted" ? t("cols.deletedAt") : t("cols.finished"), t("cols.agent"), t("cols.store")]
    : [t("cols.order"), t("cols.amount"), t("cols.status"), t("cols.age"), t("cols.agent"), t("cols.store")];
  const ids = p.rows.map((r) => r.id);
  const allOn = ids.length > 0 && ids.every((id) => p.selected.has(id));
  const from = (p.page - 1) * p.pageSize;
  const now = new Date();

  return (
    <section className="list">
      <div className="lh">
        <button type="button" className={`ck${allOn ? " on" : ""}`} aria-label={t("row.selectAll")} onClick={() => p.onToggleAll(ids)}>
          {allOn && <Ic n="check" />}
        </button>
        <span>{head[0]}</span>
        <span className="e">{head[1]}</span>
        <span>{head[2]}</span>
        <span>{head[3]}</span>
        <span>{head[4]}</span>
        <span>{head[5]}</span>
        <span />
      </div>
      <div className={`rows${p.loading && p.rows.length ? " busy" : ""}`}>
        {p.loading && !p.rows.length ? (
          Array.from({ length: 6 }, (_, i) => <div key={i} className="sk-row" aria-hidden="true" />)
        ) : p.rows.length ? (
          p.rows.map((o) => <Row key={o.id} o={o} p={p} now={now} />)
        ) : (
          <div className="empty">
            <Ic n="search" />
            <span>{p.hasFilters ? t("row.empty") : t("row.emptyAll")}</span>
            {p.hasFilters && (
              <button type="button" className="btn2" onClick={p.onClearAll}>
                {t("chips.clearAll")}
              </button>
            )}
          </div>
        )}
      </div>
      <footer className="pg">
        <span>
          {p.total != null
            ? t("pager.range", { from: p.f.n(p.rows.length ? from + 1 : 0), to: p.f.n(from + p.rows.length), total: p.f.n(p.total) })
            : t("pager.rangeOpen", { from: p.f.n(p.rows.length ? from + 1 : 0), to: p.f.n(from + p.rows.length) })}
        </span>
        <span className="nav">
          <button type="button" className="btn2" disabled={!p.hasPrev} onClick={p.onPrev}>
            <Ic n="left" className="flip" />
            {t("pager.prev")}
          </button>
          <button type="button" className="btn2" disabled={!p.hasNext} onClick={p.onNext}>
            {t("pager.next")}
            <Ic n="right" className="flip" />
          </button>
        </span>
        <label className="ps">
          <select aria-label={t("pager.perPageAria")} value={p.pageSize} onChange={(e) => p.onPageSize(Number(e.target.value) as PageSize)}>
            {PAGE_SIZE_OPTIONS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          {t("pager.perPage")}
        </label>
      </footer>
    </section>
  );
}

function Row({ o, p, now }: { o: OrdersListRow; p: OrderListProps; now: Date }) {
  const t = useTranslations("commandes");
  const sel = p.selected.has(o.id);
  const ag = o.assigned_to ? p.agentName(o.assigned_to) : null;
  const here = !!o.assigned_to && !!p.isHere?.(o);
  const product = o.product_display_name || o.product_name;
  const ref = o.external_id ?? o.id.slice(0, 8);

  let ageCls = "";
  let ageTxt: ReactNode;
  let ageTip: string;
  if (p.mode === "list") {
    ageCls = ageTone(o, p.slaMinutes, now);
    ageTxt = ageWords(t, (now.getTime() - Date.parse(o.created_at)) / 60_000);
    ageTip = t("row.received", { when: p.when(o.created_at, { now }) }) + (ageCls ? t("row.lateSuffix", { h: Math.round((p.slaMinutes ?? 120) / 60) }) : "");
  } else {
    const at = p.mode === "deleted" ? o.updated_at : o.terminal_at ?? o.updated_at;
    const days = Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / 86_400_000));
    ageTxt = days ? t("row.agoDays", { n: days }) : t("row.todayWord");
    ageTip = p.mode === "deleted" ? t("row.deletedOn", { when: p.when(at, { now }) }) : t("row.finishedOn", { day: p.when(at, { now }) });
  }

  return (
    <div
      className={`row${sel ? " sel" : ""}${p.openId === o.id ? " open" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => p.onOpen(o.id)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          p.onOpen(o.id);
        }
      }}
    >
      <button
        type="button"
        className={`ck${sel ? " on" : ""}`}
        aria-label={t("row.select", { ref })}
        onClick={(e) => {
          e.stopPropagation();
          p.onToggle(o.id);
        }}
      >
        {sel && <Ic n="check" />}
      </button>
      <div className="oc">
        <Thumb src={o.product_image_url} seed={o.product_id ?? product} />
        <div className="oc-t">
          <div className="l1">
            <span className="nm" dir="auto">
              {o.customer_name}
            </span>
            <RowTags tags={rowTags(o)} />
          </div>
          <div className="l2">
            <b dir="auto">
              {product}
              {o.variant_label ? ` · ${o.variant_label}` : ""}
            </b>
            {o.quantity > 1 && <span className="qty"> ×{o.quantity}</span>}
            {" · "}
            {o.customer_city ? <span dir="auto">{o.customer_city}</span> : <span className="miss">{t("row.noCity")}</span>}
          </div>
        </div>
      </div>
      <div className="amt">
        {p.f.n(Number(o.total_price ?? 0))}
        <small>{p.f.sym}</small>
      </div>
      <div>
        <StatusPill o={o} maxAttempts={p.maxAttempts} rejection={p.rejection} when={p.when} now={now} />
      </div>
      <div>
        <span className={`age ${ageCls}`} data-tip={ageTip}>
          {ageCls && <Ic n="clock" />}
          {ageTxt}
        </span>
      </div>
      <div className="who" data-tip={here && ag ? t("row.here", { name: ag }) : undefined}>
        {ag && o.assigned_to ? (
          <>
            <Avatar id={o.assigned_to} name={ag} here={here} />
            <span>{ag}</span>
          </>
        ) : (
          <>
            <FreeAvatar />
            <span className="none">{t("row.unassigned")}</span>
          </>
        )}
      </div>
      <div>
        <StoreTag s={p.store(o.storefront_id ?? null)} />
      </div>
      <RowMenu o={o} p={p} />
    </div>
  );
}

function RowMenu({ o, p }: { o: OrdersListRow; p: OrderListProps }) {
  const t = useTranslations("commandes.row");
  const [open, setOpen] = useState<false | "main" | "agents">(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const actions = p.actionsFor(o);
  if (!actions.length) return <div />;
  return (
    <div className="kbw" ref={ref} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" className="kb" aria-label={t("more")} aria-haspopup="menu" aria-expanded={!!open} onClick={() => setOpen(open ? false : "main")}>
        <Ic n="more" />
      </button>
      {open === "main" && (
        <div className="menu end" role="menu">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              className={`mi act${a.neg ? " neg" : ""}`}
              onClick={() => {
                if (a.agents) return setOpen("agents");
                setOpen(false);
                p.onAction(o, a.key);
              }}
            >
              <Ic n={a.icon} />
              <span className="ml">{a.label}</span>
            </button>
          ))}
        </div>
      )}
      {open === "agents" && (
        <div className="menu end" role="menu">
          <h6>{t("assignTo")}</h6>
          {p.agents.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              className="mi act"
              onClick={() => {
                setOpen(false);
                p.onAction(o, "assign", a.id);
              }}
            >
              <Avatar id={a.id} name={a.full_name} />
              <span className="ml">{a.full_name}</span>
            </button>
          ))}
          <div className="msep" />
          <button
            type="button"
            role="menuitem"
            className="mi act"
            onClick={() => {
              setOpen(false);
              p.onAction(o, "assign", null);
            }}
          >
            <FreeAvatar />
            <span className="ml">{t("toPool")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

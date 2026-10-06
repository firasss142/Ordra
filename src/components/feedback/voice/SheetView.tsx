"use client";

import { Fragment, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Info } from "lucide-react";
import type { FeedbackCategory } from "@/lib/feedback/taxonomy";
import type { FeedbackOverviewResponse, FeedbackSheetRow } from "@/types/feedback";
import { Avatar, catStyle, MOMENT_ICON, pct, Thumb, topicLabel, Trend } from "./parts";

export type SheetView = "all" | FeedbackCategory | "check";
export type SheetGroup = "reason" | "product" | "none";

/** Rows shown under a group before « + n autres ». */
const PER_GROUP = 8;
const NONE = "_none";

export const isToCheck = (r: Pick<FeedbackSheetRow, "topic_id" | "category">) => r.topic_id === null && r.category !== "reclamation";

interface Props {
  overview: FeedbackOverviewResponse;
  rows: FeedbackSheetRow[];
  total: number;
  view: SheetView;
  group: SheetGroup;
  closed: Set<string>;
  selected: Set<string>;
  peek: string | null;
  timeZone: string;
  onView: (v: SheetView) => void;
  onGroup: (g: SheetGroup) => void;
  onToggleGroup: (key: string) => void;
  onSelect: (id: string) => void;
  onPeek: (id: string) => void;
}

/**
 * « Feuille » — prototype voix-du-client-et-messages-v2, `sheetView()`: four minis, the saved
 * views, « Grouper par », and the table. The page loads the whole period; views and groups are
 * cut here.
 */
export function SheetView({ overview, rows, total, view, group, closed, selected, peek, timeZone, onView, onGroup, onToggleGroup, onSelect, onPeek }: Props) {
  const t = useTranslations("feedback.voice");
  const tf = useTranslations("feedback");
  const locale = useLocale();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const kpi = (c: FeedbackCategory) => overview.kpis.find((k) => k.category === c) ?? { category: c, count: 0, prev: null };
  const familyOf = useMemo(() => {
    const m = new Map<string, FeedbackOverviewResponse["families"][number]>();
    for (const f of overview.families) for (const id of f.productIds) m.set(id, f);
    return m;
  }, [overview.families]);
  const reasonName = (id: string | null) => topicLabel(overview.topics, id, locale) ?? t("noReason");
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone }), [locale, timeZone]);

  const shown = rows.filter((r) => (view === "all" ? true : view === "check" ? isToCheck(r) : r.category === view));

  const views: [SheetView, string, number][] = [
    ["all", t("views.all"), overview.total],
    ["objection", tf("catPlural.objection"), kpi("objection").count],
    ["suggestion", tf("catPlural.suggestion"), kpi("suggestion").count],
    ["reclamation", tf("catPlural.reclamation"), kpi("reclamation").count],
    ["check", t("views.check"), overview.toCheck],
  ];

  // ── groups
  const groups = useMemo(() => {
    if (group === "none") return null;
    const key = (r: FeedbackSheetRow) =>
      group === "reason" ? r.topic_id ?? NONE : (r.product && familyOf.get(r.product.id)?.id) ?? r.product?.id ?? NONE;
    const m = new Map<string, FeedbackSheetRow[]>();
    for (const r of shown) {
      const k = key(r);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort(([ka, a], [kb, b]) => (ka === NONE ? 1 : kb === NONE ? -1 : b.length - a.length));
  }, [shown, group, familyOf]);

  const showReason = group !== "reason";
  const showProduct = group !== "product";
  const ncol = 6 + (showReason ? 1 : 0) + (showProduct ? 1 : 0);

  const row = (r: FeedbackSheetRow) => {
    const MomentIcon = MOMENT_ICON[r.moment];
    const courier = r.source === "courier";
    const who = courier ? t("courier") : r.author?.name ?? "—";
    const sel = selected.has(r.id);
    return (
      <tr key={r.id} className={`r${sel ? " sel" : ""}${peek === r.id ? " peek" : ""}`} onClick={() => onPeek(r.id)}>
        <td style={{ width: 36 }}>
          <button type="button" role="checkbox" aria-checked={sel} aria-label={`${t("cols.select")} ${r.body}`} className="cb"
            onClick={(e) => { e.stopPropagation(); onSelect(r.id); }}>
            {sel && <Check className="ic" aria-hidden />}
          </button>
        </td>
        <td className="date num">{date.format(new Date(r.created_at))}</td>
        <td><span className="says">{r.body}</span></td>
        {showReason && (
          <td><span className="rchip" style={catStyle(r.category)}><span className="dot" />{reasonName(r.topic_id)}</span></td>
        )}
        {showProduct && (
          <td>
            {r.product ? (
              <span className="rchip"><Thumb id={r.product.id} url={r.product.image_url} small /><span className="ar">{r.product.name}</span></span>
            ) : <span className="meta">{t("noProduct")}</span>}
          </td>
        )}
        <td><span className="mom"><MomentIcon className="ic" aria-hidden />{t(`momentShort.${r.moment}`)}</span></td>
        <td><span className="who"><Avatar id={r.author?.id ?? null} name={who} courier={courier} />{who}</span></td>
        <td>
          {r.category === "reclamation" && r.status ? (
            <span className={`st ${r.status}`}><i />{t(`status.${r.status}`)}</span>
          ) : isToCheck(r) ? (
            <span className="st check">{t("toCheck")}</span>
          ) : r.source === "import" ? (
            <span className="st imp">{t("imported")}</span>
          ) : null}
        </td>
      </tr>
    );
  };

  const groupLabel = (k: string, list: FeedbackSheetRow[]) => {
    if (group === "reason") {
      return (
        <span className="rchip" style={{ ...catStyle(list[0].category), color: "var(--ink)", fontWeight: 800 }}>
          <span className="dot" />{reasonName(k === NONE ? null : k)}
        </span>
      );
    }
    const f = overview.families.find((x) => x.id === k);
    const p = list[0].product;
    return (
      <span className="rchip" style={{ color: "var(--ink)", fontWeight: 800 }}>
        {k === NONE || !p ? t("noProduct") : <><Thumb id={k} url={f?.imageUrl ?? p.image_url} small /><span className="ar">{f?.label ?? p.name}</span></>}
      </span>
    );
  };

  return (
    <>
      <section className="card minis">
        {(["objection", "suggestion", "reclamation"] as const).map((c) => {
          const k = kpi(c);
          return (
            <div key={c} style={catStyle(c)} className={c === "reclamation" ? "alert" : undefined}>
              <div className="lbl"><span className="dot" />{tf(`catPlural.${c}`)}</div>
              <div className="v">
                {c === "reclamation" ? (
                  <><b className="num">{overview.complaints.open}</b><small>{t(overview.complaints.open === 1 ? "minis.openOne" : "minis.openMany")}</small></>
                ) : (
                  <><b className="num">{k.count}</b><small>{pct(k.count, overview.total, locale)}</small></>
                )}
                <Trend n={k.count} prev={k.prev} category={c} />
              </div>
            </div>
          );
        })}
        <div>
          <div className="lbl"><Info className="ic" aria-hidden />{t("views.check")}</div>
          <div className="v"><b className="num">{overview.toCheck}</b><small>{t("minis.noReason")}</small></div>
        </div>
      </section>

      <section className="card sheet">
        <div className="stools">
          <div className="views">
            {views.map(([k, label, n]) => (
              <button key={k} type="button" className="vw" aria-pressed={view === k} onClick={() => onView(k)}>
                {k !== "all" && k !== "check" && <span className="dot" style={catStyle(k)} />}
                {label}<span className="n num">{n}</span>
              </button>
            ))}
          </div>
          <div className="grpby">
            {t("group.label")}
            <div className="mini">
              {(["reason", "product", "none"] as const).map((g) => (
                <button key={g} type="button" aria-pressed={group === g} onClick={() => onGroup(g)}>{t(`group.${g}`)}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }} aria-label={t("cols.select")} />
                <th>{t("cols.date")}</th>
                <th>{t("cols.says")}</th>
                {showReason && <th>{t("cols.reason")}</th>}
                {showProduct && <th>{t("cols.product")}</th>}
                <th>{t("cols.moment")}</th>
                <th>{t("cols.by")}</th>
                <th>{t("cols.state")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr className="empty"><td colSpan={ncol}>{t("empty")}</td></tr>}
              {groups === null
                ? shown.map(row)
                : groups.map(([k, list]) => {
                    const isClosed = closed.has(k);
                    const all = expanded.has(k);
                    const visible = all ? list : list.slice(0, PER_GROUP);
                    return (
                      <Fragment key={k}>
                        <tr className={`g${isClosed ? " closed" : ""}`} onClick={() => onToggleGroup(k)} aria-expanded={!isClosed}>
                          <td colSpan={ncol}>
                            <div className="gin"><ChevronDown className="ic chev" aria-hidden />{groupLabel(k, list)}<span className="gn num">{list.length}</span></div>
                          </td>
                        </tr>
                        {!isClosed && visible.map(row)}
                        {!isClosed && list.length > visible.length && (
                          <tr className="more">
                            <td colSpan={ncol}>
                              <button type="button" onClick={() => setExpanded((s) => new Set(s).add(k))}>{t("more", { n: list.length - visible.length })}</button>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
            </tbody>
          </table>
        </div>
        {total > rows.length && <div className="rgone">{t("truncated", { shown: rows.length, total })}</div>}
      </section>
    </>
  );
}

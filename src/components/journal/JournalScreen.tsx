"use client";

import "../orders/commandes/commandes.css";
import "./journal.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { useLocale, useTranslations } from "next-intl";
import { fetcher } from "@/lib/swr-config";
import { groupSeries } from "@/lib/journal/series";
import {
  CATEGORIES,
  HISTORY_CATEGORIES,
  categoryOfIssue,
  categoryOfRow,
  feedQueryFor,
  type Category,
  type HistoryCategory,
} from "@/lib/journal/categories";
import type { FeedItem, FeedPage, Issue, Overview, SystemTile, TileState } from "@/lib/journal/types";
import { Ic } from "@/components/orders/commandes/ui";
import { describeFeed, describeIssue, describeTile, type Tr } from "./describe";
import { makeFmt, type Fmt } from "./format";
import { AreaIcon, Avatar } from "./parts";
import { JournalPanel, type PanelState } from "./Panels";

/**
 * Système › Journaux, built like Commandes (2026-10-07): a header, four tiles
 * (urgent · to watch · down · working), the search line, ONE filter line
 * (view tabs, Catégorie, Gravité or État, the count), then ONE table with
 * column headers. Three views answer three questions:
 *   À régler  — what is wrong, one row per problem;
 *   Systèmes  — what works, one row per system;
 *   Historique — what happened, one row per event.
 * The category (lib/journal/categories) is a column and a filter, the same six
 * areas on every view; the tiles are shortcuts into the views, like Commandes'.
 */

type View = "fix" | "systems" | "history";
type SevFilter = "all" | "urgent" | "watch" | "muted";
type StateFilter = "all" | "fail" | "warn" | "ok" | "other";

const VIEW_PARAM: Record<View, string | null> = { fix: null, systems: "systemes", history: "historique" };

const viewOf = (tab: string | null): View => (tab === "historique" ? "history" : tab === "systemes" ? "systems" : "fix");

/** `tab` comes from the server page (?tab=), so the server and the browser render the same view. */
export function JournalScreen({ tab }: { tab?: string | null }) {
  const t = useTranslations("journaux") as unknown as Tr;
  const statusT = useTranslations("orders.statuses") as unknown as Tr;
  const locale = useLocale();
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Tripoli", []);
  const f = useMemo(() => makeFmt(locale, tz, (s) => (statusT.has(s) ? statusT(s) : s)), [locale, tz, statusT]);

  const [view, setViewState] = useState<View>(() =>
    viewOf(tab !== undefined ? tab : typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab")),
  );
  const [cat, setCat] = useState<HistoryCategory>("all");
  const [sev, setSev] = useState<SevFilter>("all");
  const [state, setState] = useState<StateFilter>("all");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [panel, setPanel] = useState<PanelState | null>(null);

  const overview = useSWR<Overview>("/api/admin/journal/overview", fetcher, { refreshInterval: 60_000 });
  const data = overview.data;
  const open = useMemo(() => data?.issues.filter((i) => i.status === "open") ?? [], [data]);
  const muted = useMemo(() => data?.issues.filter((i) => i.status === "muted") ?? [], [data]);

  const setView = (next: View) => {
    setViewState(next);
    setPanel(null);
    if (next !== "history" && cat === "team") setCat("all");
    const url = new URL(window.location.href);
    const p = VIEW_PARAM[next];
    if (p) url.searchParams.set("tab", p);
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.toString());
  };

  // « / » finds an order, from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== "/" || panel) return;
      if (typeof target?.closest === "function" && target.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      setPanel({ type: "trace" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);

  // ── what each view shows, after its filters ──
  const issuesShown = useMemo(() => {
    const base = sev === "muted" ? muted : open.filter((i) => sev === "all" || (sev === "urgent") === (i.severity === "critical"));
    return sortIssues(base.filter((i) => cat === "all" || categoryOfIssue(i) === cat));
  }, [open, muted, sev, cat]);
  const systemsShown = useMemo(
    () => sortSystems((data?.systems ?? []).filter((s) => inState(s.state, state) && (cat === "all" || s.family === cat))),
    [data, state, cat],
  );

  // ── tiles: shortcuts into a view with one filter; a second click clears it ──
  const tile = (v: View, on: boolean, apply: () => void, clear: () => void) => () => {
    if (on) clear();
    else {
      if (view !== v) setView(v);
      apply();
    }
  };
  const urgentOn = view === "fix" && sev === "urgent";
  const watchOn = view === "fix" && sev === "watch";
  const downOn = view === "systems" && state === "fail";
  const upOn = view === "systems" && state === "ok";
  const tracked = (data?.systems ?? []).filter((s) => s.state !== "off").length;

  const catItems: MenuItem<HistoryCategory>[] = (view === "history" ? HISTORY_CATEGORIES : (["all", ...CATEGORIES] as HistoryCategory[])).map((c) => ({
    key: c,
    label: t(`cats.${c}.label`),
    hint: view === "history" ? t(`cats.${c}.hint`) : undefined,
    n:
      view === "fix"
        ? (sev === "muted" ? muted : open).filter((i) => (sev === "all" || sev === "muted" || (sev === "urgent") === (i.severity === "critical")) && (c === "all" || categoryOfIssue(i) === c)).length
        : view === "systems"
          ? (data?.systems ?? []).filter((s) => inState(s.state, state) && (c === "all" || s.family === c)).length
          : undefined,
    dot: `jx-c-${c}`,
  }));

  return (
    <div className="cmd cmd-page" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="page">
        <header className="ph">
          <div>
            <h1>{t("title")}</h1>
            <div className="sub">
              <span className="live">
                <i />
                {t("head.live")}
              </span>
              {data && (
                <>
                  <span className="sep" />
                  {t("head.updated", { time: f.time(data.generated_at) })}
                  <span className="sep" />
                  {t("head.watched", { n: tracked })}
                </>
              )}
            </div>
          </div>
        </header>

        {data ? (
          <div role="group" aria-label={t("sum.label")} className="wts">
            <SumTile hue="h-red" icon="alert" n={open.filter((i) => i.severity === "critical").length} label={t("sum.urgent")} sub={t("sum.urgentSub")} on={urgentOn} onClick={tile("fix", urgentOn, () => setSev("urgent"), () => setSev("all"))} />
            <SumTile hue="h-amber" icon="eye" n={open.filter((i) => i.severity !== "critical").length} label={t("sum.watch")} sub={t("sum.watchSub")} on={watchOn} onClick={tile("fix", watchOn, () => setSev("watch"), () => setSev("all"))} />
            <SumTile hue="h-neutral" icon="plug" n={data.systems.filter((s) => s.state === "fail").length} label={t("sum.down")} sub={t("sum.downSub", { total: tracked })} on={downOn} onClick={tile("systems", downOn, () => setState("fail"), () => setState("all"))} />
            <SumTile hue="h-green" icon="check" n={data.systems.filter((s) => s.state === "ok").length} label={t("sum.up")} sub={t("sum.upSub", { total: tracked })} on={upOn} onClick={tile("systems", upOn, () => setState("ok"), () => setState("all"))} />
          </div>
        ) : overview.error ? (
          <p className="err">{t("verdict.error")}</p>
        ) : (
          <div className="wts" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="sk h-[76px]" />
            ))}
          </div>
        )}

        <div className="tools">
          <button type="button" className="srch jx-srch" onClick={() => setPanel({ type: "trace" })}>
            <Ic n="search" />
            <span>{t("find.placeholder")}</span>
            <kbd className="kbd2">/</kbd>
          </button>
        </div>

        <div className="fl">
          <div role="tablist" className="tabs jx-tabs">
            {(["fix", "systems", "history"] as const).map((k) => (
              <button key={k} role="tab" type="button" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>
                {t(`tabs.${k === "fix" ? "overview" : k}`)}
                {k === "fix" && open.length > 0 && <em className={open.some((i) => i.severity === "critical") ? "bad" : ""}>{open.length}</em>}
              </button>
            ))}
          </div>
          <Menu label={t("filter.label")} value={cat} items={catItems} onChange={setCat} icon="filter" />
          {view === "fix" && (
            <Menu
              label={t("sevMenu.label")}
              value={sev}
              icon="alert"
              onChange={setSev}
              items={(["all", "urgent", "watch", "muted"] as const).map((k) => ({
                key: k,
                label: t(`sevMenu.${k}`),
                n: k === "muted" ? muted.length : k === "all" ? open.length : open.filter((i) => (k === "urgent") === (i.severity === "critical")).length,
                dot: k === "urgent" ? "h-red" : k === "watch" ? "h-amber" : "h-neutral",
              }))}
            />
          )}
          {view === "systems" && (
            <Menu
              label={t("stateMenu.label")}
              value={state}
              icon="plug"
              onChange={setState}
              items={(["all", "fail", "warn", "ok", "other"] as const).map((k) => ({
                key: k,
                label: t(`stateMenu.${k}`),
                n: (data?.systems ?? []).filter((s) => inState(s.state, k)).length,
                dot: STATE_HUE[k === "other" ? "off" : k === "all" ? "off" : k],
              }))}
            />
          )}
          {view === "history" && (
            <button type="button" role="switch" aria-checked={onlyIssues} onClick={() => setOnlyIssues((v) => !v)} className="jx-sw">
              <i aria-hidden />
              {t("feed.onlyIssues")}
            </button>
          )}
          {data && view === "fix" && <span className="count">{t("count.problems", { n: issuesShown.length })}</span>}
          {data && view === "systems" && <span className="count">{t("count.systems", { n: systemsShown.length })}</span>}
        </div>

        {view === "history" ? (
          <HistoryTable cat={cat} onlyIssues={onlyIssues} t={t} f={f} onOpen={setPanel} />
        ) : !data ? (
          !overview.error && <TableSkeleton />
        ) : view === "fix" ? (
          <ProblemsTable issues={issuesShown} filtered={sev !== "all" || cat !== "all"} t={t} f={f} onOpen={setPanel} />
        ) : (
          <SystemsTable systems={systemsShown} t={t} f={f} onOpen={setPanel} />
        )}
      </div>

      {panel && (
        <JournalPanel state={panel} overview={data} onClose={() => setPanel(null)} onOpen={setPanel} onChanged={() => overview.mutate()} t={t} f={f} />
      )}
    </div>
  );
}

/* ═════════ shared pieces ═════════ */

function SumTile({ hue, icon, n, label, sub, on, onClick }: { hue: string; icon: string; n: number; label: string; sub: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`wt ${hue} ${on ? "on" : ""} ${n === 0 ? "zero" : ""}`}>
      <span className="hold">
        <Ic n={icon} />
      </span>
      <span className="wt-t">
        <b>{n}</b>
        <span>{label}</span>
        <small>{sub}</small>
      </span>
      {on && (
        <span className="wt-x" aria-hidden>
          <Ic n="x" />
        </span>
      )}
    </button>
  );
}

interface MenuItem<K extends string> {
  key: K;
  label: string;
  hint?: string;
  n?: number;
  dot?: string;
}

/** Commandes' filter button: says its value, opens a menu that counts each choice. */
function Menu<K extends string>({ label, value, items, onChange, icon }: { label: string; value: K; items: MenuItem<K>[]; onChange: (k: K) => void; icon: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const current = items.find((i) => i.key === value);
  const active = value !== items[0]?.key;
  return (
    <div className="fbw" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`fb ${open ? "open" : ""} ${active ? "on" : ""}`}>
        <Ic n={icon} />
        {label}
        {active && current && <span className="jx-fbv">· {current.label}</span>}
        <Ic n="down" className="chev" />
      </button>
      {open && (
        <div role="menu" className="menu">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitemradio"
              aria-checked={value === it.key}
              className={`mi ${it.dot ?? ""} ${value === it.key ? "on" : ""} ${it.n === 0 && value !== it.key ? "zero" : ""}`}
              onClick={() => {
                onChange(it.key);
                setOpen(false);
              }}
            >
              <span className="dotk" aria-hidden />
              <span className="ml">
                {it.label}
                {it.hint && <small className="jx-mi-hint">{it.hint}</small>}
              </span>
              {it.n !== undefined && <span className="n">{it.n}</span>}
              {value === it.key && <Ic n="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CatCell({ cat, t }: { cat: Exclude<HistoryCategory, "all">; t: Tr }) {
  return (
    <span className={`jx-cat jx-c-${cat}`} title={t(`cats.${cat}.label`)}>
      <i aria-hidden />
      <span>{t(`cats.${cat}.label`)}</span>
    </span>
  );
}

function Thumb({ cat, gear, children }: { cat: Exclude<HistoryCategory, "all">; gear?: boolean; children?: ReactNode }) {
  return (
    <span className={`thumb jx-c-${cat}`} aria-hidden>
      {children ?? <AreaIcon cat={cat} gear={gear} />}
    </span>
  );
}

function Head({ cls, cols }: { cls: string; cols: (string | [string, "e"])[] }) {
  return (
    <div className={`lh ${cls}`}>
      {cols.map((c, i) => (Array.isArray(c) ? <span key={i} className="e">{c[0]}</span> : <span key={i}>{c}</span>))}
    </div>
  );
}

function Empty({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <div className={`empty ${ok ? "jx-allgood" : ""}`}>
      <Ic n={ok ? "check" : "search"} />
      <span>{children}</span>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="sk overflow-hidden" aria-hidden>
      <div className="h-[42px]" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="sk-row" />
      ))}
    </div>
  );
}

/** « 42 j », « 10 h », « 5 min »: how long a problem has lasted, at a glance. */
function shortAge(iso: string, f: Fmt, t: Tr): string {
  const s = Math.max(0, (f.now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return t("age.min", { n: Math.max(1, Math.round(s / 60)) });
  if (s < 86_400) return t("age.h", { n: Math.floor(s / 3600) });
  return t("age.d", { n: Math.floor(s / 86_400) });
}

/* ═════════ À régler ═════════ */

/** Same-rule problems fold from this many on: « 30 transporteurs coupés… » is one row, not thirty. */
const FOLD_FROM = 3;

const catRank = (c: Category) => CATEGORIES.indexOf(c);

/** Urgent first, then the areas in their fixed order; the API's order (by cost) within. */
function sortIssues(list: Issue[]): Issue[] {
  return list
    .map((i, at) => ({ i, at }))
    .sort((a, b) => Number(b.i.severity === "critical") - Number(a.i.severity === "critical") || catRank(categoryOfIssue(a.i)) - catRank(categoryOfIssue(b.i)) || a.at - b.at)
    .map((x) => x.i);
}

type Line = { kind: "one"; issue: Issue } | { kind: "fold"; rule: Issue["rule"]; issues: Issue[] };

function foldByRule(issues: Issue[]): Line[] {
  const byRule = new Map<string, Issue[]>();
  for (const i of issues) byRule.set(i.rule, [...(byRule.get(i.rule) ?? []), i]);
  const lines: Line[] = [];
  const done = new Set<string>();
  for (const i of issues) {
    const same = byRule.get(i.rule) ?? [];
    if (same.length >= FOLD_FROM) {
      if (!done.has(i.rule)) lines.push({ kind: "fold", rule: i.rule, issues: same });
      done.add(i.rule);
    } else lines.push({ kind: "one", issue: i });
  }
  return lines;
}

function ProblemsTable({ issues, filtered, t, f, onOpen }: { issues: Issue[]; filtered: boolean; t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  return (
    <section aria-label={t("problems.title")} className="list">
      <Head cls="jx-p" cols={[t("cols.problem"), t("cols.category"), t("cols.severity"), [t("cols.size"), "e"], t("cols.since"), ""]} />
      <div className="rows">
        {issues.length === 0 ? (
          filtered ? <Empty>{t("feed.empty")}</Empty> : <Empty ok>{t("empty.none")}</Empty>
        ) : (
          foldByRule(issues).map((l) =>
            l.kind === "one" ? (
              <ProblemRow key={l.issue.id} issue={l.issue} t={t} f={f} onClick={() => onOpen({ type: "issue", id: l.issue.id })} />
            ) : (
              <FoldRow key={l.rule} rule={l.rule} issues={l.issues} t={t} f={f} onOpen={onOpen} />
            ),
          )
        )}
      </div>
    </section>
  );
}

function SevPill({ critical, t }: { critical: boolean; t: Tr }) {
  return (
    <span className={`pl ${critical ? "h-red" : "h-amber"}`}>
      <Ic n={critical ? "alert" : "eye"} />
      <span>{t(critical ? "sev.urgent" : "sev.watch")}</span>
    </span>
  );
}

function ProblemRow({ issue, t, f, onClick, sub }: { issue: Issue; t: Tr; f: Fmt; onClick: () => void; sub?: boolean }) {
  const d = describeIssue(issue, t, f);
  const cat = categoryOfIssue(issue);
  const muted = issue.status === "muted";
  const crit = issue.severity === "critical";
  return (
    <button type="button" onClick={onClick} className={`row jx-p ${sub ? "jx-sub" : ""} ${muted ? "jx-muted" : ""}`}>
      <span className="oc">
        <Thumb cat={cat} />
        <span className="oc-t">
          <span className="nm">{d.title}</span>
          <span className="l2">{muted && issue.muted_until ? t("common.mutedUntil", { date: f.date(issue.muted_until) }) : d.line}</span>
        </span>
      </span>
      <CatCell cat={cat} t={t} />
      <span>
        <SevPill critical={crit} t={t} />
      </span>
      <span className="amt jx-amt">
        <b className={crit ? "bad" : ""}>{d.impact[0]}</b>
        <small>{d.impact[1]}</small>
      </span>
      <span className="age">{shortAge(issue.first_seen, f, t)}</span>
      <Ic n="right" className="chev flip" />
    </button>
  );
}

function FoldRow({ rule, issues, t, f, onOpen }: { rule: Issue["rule"]; issues: Issue[]; t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const [open, setOpen] = useState(false);
  const total = issues.reduce((n, i) => n + Number(i.affected ?? 0), 0);
  const listId = `jx-fold-${rule}`;
  const crit = issues.some((i) => i.severity === "critical");
  const cat = categoryOfIssue(issues[0]);
  const oldest = issues.reduce((a, i) => (i.first_seen < a ? i.first_seen : a), issues[0].first_seen);
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)} className={`row jx-p ${open ? "jx-open" : ""}`}>
        <span className="oc">
          <Thumb cat={cat}>
            <b className="jx-n">{issues.length}</b>
          </Thumb>
          <span className="oc-t">
            <span className="nm">{t(`rules.${rule}.fold`, { n: issues.length })}</span>
            <span className="l2">
              {issues
                .slice(0, 3)
                .map((i) => describeIssue(i, t, f).title)
                .join(" · ")}
              {issues.length > 3 ? " …" : ""}
            </span>
          </span>
        </span>
        <CatCell cat={cat} t={t} />
        <span>
          <SevPill critical={crit} t={t} />
        </span>
        <span className="amt jx-amt">{total > 0 && <b>{f.num(total)}</b>}</span>
        <span className="age">{shortAge(oldest, f, t)}</span>
        <Ic n="down" className={`chev jx-rot ${open ? "open" : ""}`} />
      </button>
      {open && (
        <div id={listId}>
          {issues.map((i) => (
            <ProblemRow key={i.id} sub issue={i} t={t} f={f} onClick={() => onOpen({ type: "issue", id: i.id })} />
          ))}
        </div>
      )}
    </>
  );
}

/* ═════════ Systèmes ═════════ */

const STATE_RANK: Record<TileState, number> = { fail: 0, warn: 1, mute: 2, ok: 3, off: 4 };
const STATE_HUE: Record<TileState, string> = { fail: "h-red", warn: "h-amber", ok: "h-green", mute: "h-neutral", off: "h-neutral" };
const STATE_ICON: Record<TileState, string> = { fail: "alert", warn: "eye", ok: "check", mute: "pause", off: "plug" };

function inState(s: TileState, f: StateFilter): boolean {
  if (f === "all") return true;
  if (f === "other") return s === "mute" || s === "off";
  return s === f;
}

function sortSystems(list: SystemTile[]): SystemTile[] {
  return [...list].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || catRank(a.family) - catRank(b.family));
}

/** A long list shows this many systems before « Afficher les autres ». */
const SYS_VISIBLE = 25;

function SystemsTable({ systems, t, f, onOpen }: { systems: SystemTile[]; t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? systems : systems.slice(0, SYS_VISIBLE);
  const open = (s: SystemTile) => onOpen(s.id === "jobs" ? { type: "jobs" } : s.id === "app" ? { type: "app" } : { type: "tile", id: s.id });
  return (
    <section aria-label={t("sections.systems")} className="list">
      <Head cls="jx-s" cols={[t("cols.system"), t("cols.category"), t("cols.state"), t("cols.last"), ""]} />
      <div className="rows">
        {systems.length === 0 ? (
          <Empty>{t("feed.empty")}</Empty>
        ) : (
          shown.map((s) => <SystemRow key={s.id} tile={s} t={t} f={f} onClick={() => open(s)} />)
        )}
      </div>
      {systems.length > SYS_VISIBLE && !all && (
        <div className="pg">
          <button type="button" className="btn2" onClick={() => setAll(true)}>
            {t("list.more", { n: systems.length - SYS_VISIBLE })}
          </button>
        </div>
      )}
    </section>
  );
}

function SystemRow({ tile, t, f, onClick }: { tile: SystemTile; t: Tr; f: Fmt; onClick: () => void }) {
  const d = describeTile(tile, t, f);
  return (
    <button type="button" onClick={onClick} className={`row jx-s ${tile.state === "off" ? "jx-muted" : ""}`}>
      <span className="oc">
        <Thumb cat={tile.family} />
        <span className="oc-t">
          <span className="nm">{d.name}</span>
          <span className="l2">{d.where}</span>
        </span>
      </span>
      <CatCell cat={tile.family} t={t} />
      <span>
        <span className={`pl ${STATE_HUE[tile.state]}`}>
          <Ic n={STATE_ICON[tile.state]} />
          <span>{d.state}</span>
        </span>
      </span>
      <span className="jx-last">{d.last}</span>
      <Ic n="right" className="chev flip" />
    </button>
  );
}

/* ═════════ Historique ═════════ */

const PAGE = 150;

function HistoryTable({ cat, onlyIssues, t, f, onOpen }: { cat: HistoryCategory; onlyIssues: boolean; t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const query = feedQueryFor(cat);

  const keyOf = useCallback(
    (index: number, prev: FeedPage | null) => {
      if (prev && !prev.next) return null;
      const q = new URLSearchParams({ limit: String(PAGE), tz: f.tz });
      if (query.family) q.set("family", query.family);
      if (onlyIssues) q.set("only_issues", "1");
      if (index > 0 && prev?.next) {
        q.set("before", prev.next.before);
        q.set("before_id", prev.next.beforeId);
      }
      return `/api/admin/journal/feed?${q.toString()}`;
    },
    [query.family, onlyIssues, f.tz],
  );
  const feed = useSWRInfinite<FeedPage>(keyOf, fetcher, { refreshInterval: 60_000, revalidateFirstPage: true });
  const pages = feed.data ?? [];
  const last = pages[pages.length - 1];

  const days = useMemo(() => {
    const rows = pages.flatMap((p) => p.rows).filter((r) => !query.local || categoryOfRow(r) === cat);
    const items = groupSeries(rows, f.dayKey);
    const routine: Record<string, number> = {};
    for (const p of pages) for (const [d, n] of Object.entries(p.routine ?? {})) routine[d] = (routine[d] ?? 0) + n;
    const out: { day: string; items: FeedItem[]; routine: number }[] = [];
    for (const it of items) {
      const d = f.dayKey(it.at);
      if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, items: [], routine: routine[d] ?? 0 });
      out[out.length - 1].items.push(it);
    }
    return out;
  }, [pages, f, query.local, cat]);

  const today = f.dayKey(f.now.toISOString());
  const yesterday = f.dayKey(new Date(f.now.getTime() - 86_400_000).toISOString());
  const dayLabel = (d: string) => (d === today ? t("feed.today") : d === yesterday ? t("feed.yesterday", { date: f.date(d) }) : f.date(d));
  // routine passes are syncs and empty imports: only meaningful on the unfiltered stream
  const showRoutine = !onlyIssues && cat === "all";

  return (
    <>
      <section aria-label={t("tabs.history")} className="list">
        <Head cls="jx-h" cols={[t("cols.time"), t("cols.event"), t("cols.category"), t("cols.result"), ""]} />
        <div className="rows">
          {feed.error && !pages.length ? (
            <Empty>{t("feed.error")}</Empty>
          ) : !feed.data ? (
            <p className="jx-msg">{t("common.loading")}</p>
          ) : days.length === 0 ? (
            <Empty>{t("feed.empty")}</Empty>
          ) : (
            days.map((d) => (
              <div key={d.day}>
                <div className="jx-day">{dayLabel(d.day)}</div>
                {d.items.map((it) => (
                  <FeedLine key={it.id} item={it} t={t} f={f} onOpen={onOpen} />
                ))}
                {d.routine > 0 && showRoutine && <div className="jx-routine">{t("feed.routine", { n: d.routine })}</div>}
              </div>
            ))
          )}
        </div>
      </section>

      {last?.next && (
        <div className="jx-loadmore">
          <button type="button" className="btn2" onClick={() => feed.setSize(feed.size + 1)} disabled={feed.isValidating}>
            {feed.isValidating ? t("common.loading") : t("feed.more")}
          </button>
        </div>
      )}
    </>
  );
}

function FeedLine({ item, t, f, onOpen }: { item: FeedItem; t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const line = describeFeed(item, t, f);
  // An explicit event (sign-in, export) has no before → after to open.
  const empty = item.ref?.startsWith("audit:") && !item.params?.fields;
  const clickable = (!!item.ref && !empty) || item.count > 1;
  const sev = item.severity;
  const cat = categoryOfRow(item);
  const open = () => onOpen({ type: "item", item });
  return (
    <div
      data-row
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? open : undefined}
      onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open()) : undefined}
      className={`row jx-h ${clickable ? "" : "jx-static"} ${sev ? `jx-${sev}` : ""}`}
    >
      <time className="age">{f.time(item.at)}</time>
      <span className="oc">
        {cat === "team" ? (
          <Avatar name={item.actor_name} admin={item.actor_role === "super_admin"} unknown={!item.actor_id && !item.actor_name} />
        ) : (
          <Thumb cat={cat} gear={item.family === "auto"} />
        )}
        <span className="oc-t">
          <span className="nm jx-wrap">{line.title}</span>
          {line.sub && <span className="l2">{line.sub}</span>}
        </span>
      </span>
      <CatCell cat={cat} t={t} />
      <span>
        {sev === "fail" && (
          <span className="pl h-red">
            <Ic n="xcircle" />
            <span>{t("common.failed")}</span>
          </span>
        )}
        {sev === "warn" && (
          <span className="pl h-amber">
            <Ic n="eye" />
            <span>{t("common.toCheck")}</span>
          </span>
        )}
      </span>
      {clickable ? <Ic n="right" className="chev flip" /> : <span />}
    </div>
  );
}

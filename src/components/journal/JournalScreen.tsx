"use client";

import "../orders/commandes/commandes.css";
import "./journal.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  summarise,
  type Category,
  type HistoryCategory,
} from "@/lib/journal/categories";
import type { FeedItem, FeedPage, Issue, Overview, SystemTile } from "@/lib/journal/types";
import { Ic } from "@/components/orders/commandes/ui";
import { describeFeed, describeIssue, describeTile, type Tr } from "./describe";
import { makeFmt, type Fmt } from "./format";
import { AreaIcon, Avatar, StateLine, type Sev } from "./parts";
import { JournalPanel, type PanelState } from "./Panels";

/**
 * Système › Journaux, in the house language of Commandes (2026-10-06).
 *
 * ONE categorisation for the whole page — six areas of the business
 * (lib/journal/categories): the overview opens on a verdict and six area tiles,
 * then one card of problems and one card of systems, both grouped by area; a
 * tile narrows both cards to its area. The history files every row in the same
 * areas, plus « Équipe » for what people did by hand.
 */
export function JournalScreen() {
  const t = useTranslations("journaux") as unknown as Tr;
  const statusT = useTranslations("orders.statuses") as unknown as Tr;
  const locale = useLocale();
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Tripoli", []);
  const f = useMemo(() => makeFmt(locale, tz, (s) => (statusT.has(s) ? statusT(s) : s)), [locale, tz, statusT]);

  const [tab, setTab] = useState<"overview" | "history">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "historique" ? "history" : "overview",
  );
  const [panel, setPanel] = useState<PanelState | null>(null);

  const overview = useSWR<Overview>("/api/admin/journal/overview", fetcher, { refreshInterval: 60_000 });
  const open = overview.data?.issues.filter((i) => i.status === "open") ?? [];
  const urgent = open.some((i) => i.severity === "critical");

  const selectTab = (next: "overview" | "history") => {
    setTab(next);
    setPanel(null);
    const url = new URL(window.location.href);
    if (next === "history") url.searchParams.set("tab", "historique");
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

  return (
    <div className="cmd cmd-page" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="page jx-page">
        <header className="ph">
          <div>
            <h1>{t("title")}</h1>
            <div className="sub">
              <span className="live">
                <i />
                {t("head.live")}
              </span>
              {overview.data && (
                <>
                  <span className="sep" />
                  {t("head.updated", { time: f.time(overview.data.generated_at) })}
                  <span className="sep" />
                  {t("head.watched", { n: overview.data.systems.length })}
                </>
              )}
            </div>
          </div>
          <div className="acts">
            <button type="button" className="btn2 jx-find" onClick={() => setPanel({ type: "trace" })}>
              <Ic n="search" />
              <span>{t("find.placeholder")}</span>
              <kbd className="kbd2">/</kbd>
            </button>
          </div>
        </header>

        <div role="tablist" className="tabs jx-tabs">
          {(["overview", "history"] as const).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => selectTab(k)}>
              {t(`tabs.${k}`)}
              {k === "overview" && open.length > 0 && <em className={urgent ? "bad" : ""}>{open.length}</em>}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <OverviewTab data={overview.data} failed={!!overview.error} t={t} f={f} onOpen={setPanel} />
        ) : (
          <HistoryTab t={t} f={f} onOpen={setPanel} />
        )}
      </div>

      {panel && (
        <JournalPanel
          state={panel}
          overview={overview.data}
          onClose={() => setPanel(null)}
          onOpen={setPanel}
          onChanged={() => overview.mutate()}
          t={t}
          f={f}
        />
      )}
    </div>
  );
}

/* ═════════ Aperçu ═════════ */

function OverviewTab({
  data,
  failed,
  t,
  f,
  onOpen,
}: {
  data: Overview | undefined;
  failed: boolean;
  t: Tr;
  f: Fmt;
  onOpen: (p: PanelState) => void;
}) {
  const [area, setArea] = useState<Category | null>(null);
  if (failed && !data) return <p className="err">{t("verdict.error")}</p>;
  if (!data) return <OverviewSkeleton />;

  const open = data.issues.filter((i) => i.status === "open");
  const muted = data.issues.filter((i) => i.status === "muted");
  const healthy = data.systems.filter((s) => s.state !== "fail" && s.state !== "warn").length;
  const summary = summarise(data.issues, data.systems);
  const inArea = <X,>(list: X[], of: (x: X) => Category) => (area ? list.filter((x) => of(x) === area) : list);
  const ok = open.length === 0;

  return (
    <>
      <section className="jx-verdict" aria-live="polite">
        <span className={`hold ${ok ? "ok" : "bad"}`} aria-hidden>
          <Ic n={ok ? "check" : "alert"} />
        </span>
        <div>
          <h2>{ok ? t("verdict.ok") : t("verdict.issues", { n: open.length })}</h2>
          <p>{ok ? t("verdict.okSub", { total: data.systems.length }) : t("verdict.issuesSub", { ok: healthy, total: data.systems.length })}</p>
        </div>
      </section>

      <div role="group" aria-label={t("filter.label")} className="wts jx-cats">
        {CATEGORIES.map((c) => (
          <AreaTile key={c} cat={c} s={summary[c]} on={area === c} t={t} onClick={() => setArea((a) => (a === c ? null : c))} />
        ))}
      </div>

      <ProblemsCard issues={inArea(open, categoryOfIssue)} area={area} t={t} f={f} onOpen={onOpen} onClear={() => setArea(null)} />
      <SystemsCard systems={inArea(data.systems, (s) => s.family)} area={area} t={t} f={f} onOpen={onOpen} />
      {muted.length > 0 && <MutedLine issues={inArea(muted, categoryOfIssue)} t={t} f={f} onOpen={onOpen} />}
    </>
  );
}

function AreaTile({
  cat,
  s,
  on,
  t,
  onClick,
}: {
  cat: Category;
  s: { urgent: number; watch: number; systems: number };
  on: boolean;
  t: Tr;
  onClick: () => void;
}) {
  const problems = s.urgent + s.watch;
  const state =
    problems > 0 ? (
      <>
        {s.urgent > 0 && <em className="bad">{t("catState.urgent", { n: s.urgent })}</em>}
        {s.urgent > 0 && s.watch > 0 && " · "}
        {s.watch > 0 && t("catState.watch", { n: s.watch })}
      </>
    ) : s.systems === 0 ? (
      t("catState.none")
    ) : (
      t("catState.ok")
    );
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`wt jx-c-${cat} ${on ? "on" : ""} ${problems === 0 ? "zero" : ""}`}>
      <span className="hold">
        <AreaIcon cat={cat} />
      </span>
      <span className="wt-t">
        <b>{problems}</b>
        <span>{t(`cats.${cat}.label`)}</span>
        <small className={problems === 0 && s.systems > 0 ? "ok" : s.urgent === 0 && s.watch > 0 ? "warn" : ""}>{state}</small>
      </span>
      {on && (
        <span className="wt-x" aria-hidden>
          <Ic n="x" />
        </span>
      )}
    </button>
  );
}

/** Same-rule problems fold from this many on: « 30 transporteurs coupés… » is one line, not thirty. */
const FOLD_FROM = 3;
/** An area shows this many lines before « Voir plus ». */
const VISIBLE = 6;

type Line = { kind: "one"; issue: Issue } | { kind: "fold"; rule: Issue["rule"]; issues: Issue[] };

const bySeverity = (a: Issue, b: Issue) => Number(b.severity === "critical") - Number(a.severity === "critical");

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
    } else {
      lines.push({ kind: "one", issue: i });
    }
  }
  return lines;
}

/** Areas in their fixed order, the ones with something urgent first. */
function groupByArea(issues: Issue[]): { cat: Category; issues: Issue[] }[] {
  const groups = CATEGORIES.map((cat) => ({ cat, issues: issues.filter((i) => categoryOfIssue(i) === cat).sort(bySeverity) })).filter((g) => g.issues.length);
  return groups.sort((a, b) => Number(b.issues.some((i) => i.severity === "critical")) - Number(a.issues.some((i) => i.severity === "critical")));
}

function ProblemsCard({
  issues,
  area,
  t,
  f,
  onOpen,
  onClear,
}: {
  issues: Issue[];
  area: Category | null;
  t: Tr;
  f: Fmt;
  onOpen: (p: PanelState) => void;
  onClear: () => void;
}) {
  if (issues.length === 0 && !area) return null;
  return (
    <section aria-labelledby="jx-problems" className="list jx-card">
      <div className="jx-ch">
        <h2 id="jx-problems">{t("problems.title")}</h2>
        <span className="n">{t("problems.count", { n: issues.length })}</span>
        <span className="sp" />
        {area && (
          <button type="button" className="clearall" onClick={onClear}>
            {t("filter.clear")}
          </button>
        )}
      </div>
      <div className="jx-body">
        {issues.length === 0 && area ? (
          <div className="jx-none">
            <Ic n="check" />
            {t("problems.none", { cat: t(`cats.${area}.label`) })}
          </div>
        ) : (
          groupByArea(issues).map((g) => <ProblemGroup key={g.cat} cat={g.cat} issues={g.issues} t={t} f={f} onOpen={onOpen} />)
        )}
      </div>
    </section>
  );
}

function GroupHead({ cat, n, t }: { cat: Category; n: number; t: Tr }) {
  return (
    <div className={`jx-gh jx-c-${cat}`}>
      <i className="dotc" aria-hidden />
      <span>{t(`cats.${cat}.label`)}</span>
      <span className="gn">{n}</span>
    </div>
  );
}

function ProblemGroup({ cat, issues, t, f, onOpen }: { cat: Category; issues: Issue[]; t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const [all, setAll] = useState(false);
  const lines = foldByRule(issues);
  const shown = all ? lines : lines.slice(0, VISIBLE);
  return (
    <>
      <GroupHead cat={cat} n={issues.length} t={t} />
      {shown.map((l) =>
        l.kind === "one" ? (
          <ProblemRow key={l.issue.id} issue={l.issue} t={t} f={f} onClick={() => onOpen({ type: "issue", id: l.issue.id })} />
        ) : (
          <FoldRow key={l.rule} rule={l.rule} issues={l.issues} t={t} f={f} onOpen={onOpen} />
        ),
      )}
      {lines.length > VISIBLE && (
        <button type="button" className="jx-more" onClick={() => setAll((v) => !v)}>
          {all ? t("sections.hideCalm") : t("sections.more", { n: lines.length - VISIBLE })}
        </button>
      )}
    </>
  );
}

function SevPill({ issue, t }: { issue: Issue; t: Tr }) {
  const crit = issue.severity === "critical";
  return (
    <span className={`pl ${crit ? "h-red" : "h-amber"}`}>
      <Ic n={crit ? "alert" : "eye"} />
      <span>{t(crit ? "sev.urgent" : "sev.watch")}</span>
    </span>
  );
}

function ProblemRow({ issue, t, f, onClick }: { issue: Issue; t: Tr; f: Fmt; onClick: () => void }) {
  const d = describeIssue(issue, t, f);
  const muted = issue.status === "muted";
  return (
    <button type="button" onClick={onClick} className={`jx-row ${muted ? "muted" : ""}`}>
      <SevPill issue={issue} t={t} />
      <div>
        <h3>{d.title}</h3>
        <p>{muted && issue.muted_until ? t("common.mutedUntil", { date: f.date(issue.muted_until) }) : d.line}</p>
      </div>
      <span className="imp">
        <b className={issue.severity === "critical" ? "bad" : ""}>{d.impact[0]}</b>
        <small>{d.impact[1]}</small>
      </span>
      <Ic n="right" className="chev" />
    </button>
  );
}

function FoldRow({ rule, issues, t, f, onOpen }: { rule: Issue["rule"]; issues: Issue[]; t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const [open, setOpen] = useState(false);
  const total = issues.reduce((n, i) => n + Number(i.affected ?? 0), 0);
  const listId = `jx-fold-${rule}`;
  const worst = issues.find((i) => i.severity === "critical") ?? issues[0];
  return (
    <div className="jx-fold">
      <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)} className="jx-row">
        <SevPill issue={worst} t={t} />
        <div>
          <h3>{t(`rules.${rule}.fold`, { n: issues.length })}</h3>
          <p>
            {issues
              .slice(0, 3)
              .map((i) => describeIssue(i, t, f).title)
              .join(" · ")}
            {issues.length > 3 ? " …" : ""}
          </p>
        </div>
        <span className="imp">{total > 0 && <b>{f.num(total)}</b>}</span>
        <Ic n="right" className={`chev ${open ? "open" : ""}`} />
      </button>
      {open && (
        <div id={listId} className="jx-fold-list">
          {issues.map((i) => (
            <ProblemRow key={i.id} issue={i} t={t} f={f} onClick={() => onOpen({ type: "issue", id: i.id })} />
          ))}
        </div>
      )}
    </div>
  );
}

function SystemsCard({
  systems,
  area,
  t,
  f,
  onOpen,
}: {
  systems: SystemTile[];
  area: Category | null;
  t: Tr;
  f: Fmt;
  onOpen: (p: PanelState) => void;
}) {
  const [showOk, setShowOk] = useState(false);
  const [showWarn, setShowWarn] = useState(false);
  // Red systems stay in view; amber ones are already named in Problèmes, so they wait behind one line.
  const warnCount = systems.filter((s) => s.state === "warn").length;
  const okCount = systems.filter((s) => s.state !== "fail" && s.state !== "warn").length;
  const shown = (s: SystemTile) => (s.state === "fail" ? true : s.state === "warn" ? showWarn : showOk);
  const visible = systems.filter(shown);
  const open = (s: SystemTile) => onOpen(s.id === "jobs" ? { type: "jobs" } : s.id === "app" ? { type: "app" } : { type: "tile", id: s.id });
  const groups = CATEGORIES.map((cat) => ({ cat, list: visible.filter((s) => s.family === cat).sort((a, b) => rank(a) - rank(b)) })).filter((g) => g.list.length);
  return (
    <section aria-labelledby="jx-systems" className="list jx-card">
      <div className="jx-ch">
        <h2 id="jx-systems">{t("sections.systems")}</h2>
        <span className="n">{t("systemsCard.ratio", { ok: okCount, total: systems.length })}</span>
      </div>
      <div className="jx-body">
        {systems.length === 0 && area && (
          <div className="jx-none">
            <Ic n="info" />
            {t("systemsCard.none", { cat: t(`cats.${area}.label`) })}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.cat}>
            <GroupHead cat={g.cat} n={g.list.length} t={t} />
            {g.list.map((s) => (
              <SystemRow key={s.id} tile={s} t={t} f={f} onClick={() => open(s)} />
            ))}
          </div>
        ))}
      </div>
      {warnCount > 0 && (
        <button type="button" className="jx-more" aria-expanded={showWarn} onClick={() => setShowWarn((v) => !v)}>
          <i className="jx-dot warn" aria-hidden />
          {showWarn ? t("systemsCard.hideWarn") : t("sections.warnSystems", { n: warnCount })}
          <Ic n="right" className={`chev ${showWarn ? "open" : ""}`} />
        </button>
      )}
      {okCount > 0 && (
        <button type="button" className="jx-more" aria-expanded={showOk} onClick={() => setShowOk((v) => !v)}>
          <Ic n="check" />
          {showOk ? t("systemsCard.hideOk") : t("systemsCard.showOk", { n: okCount })}
          <Ic n="right" className={`chev ${showOk ? "open" : ""}`} />
        </button>
      )}
    </section>
  );
}

const rank = (s: SystemTile) => ({ fail: 0, warn: 1, ok: 2, mute: 3, off: 4 })[s.state] ?? 5;

function SystemRow({ tile, t, f, onClick }: { tile: SystemTile; t: Tr; f: Fmt; onClick: () => void }) {
  const d = describeTile(tile, t, f);
  return (
    <button type="button" onClick={onClick} className={`jx-sys jx-c-${tile.family}`}>
      <span className="jx-tile" aria-hidden>
        <AreaIcon cat={tile.family} />
      </span>
      <span className="min-w-0">
        <b>{d.name}</b>
        <small>{d.where}</small>
      </span>
      <span className="st">
        <StateLine sev={tile.state as Sev}>{d.state}</StateLine>
        <small>{d.last}</small>
      </span>
      <Ic n="right" className="chev" />
    </button>
  );
}

function MutedLine({ issues, t, f, onOpen }: { issues: Issue[]; t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const [open, setOpen] = useState(false);
  if (issues.length === 0) return null;
  return (
    <section aria-label={t("sections.muted")}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="jx-mutedbtn">
        <Ic n="right" className={open ? "open" : ""} />
        {t("sections.mutedToggle", { n: issues.length })}
      </button>
      {open && (
        <div className="list jx-card" style={{ marginTop: 10 }}>
          <div className="jx-body">
            {issues.map((i) => (
              <ProblemRow key={i.id} issue={i} t={t} f={f} onClick={() => onOpen({ type: "issue", id: i.id })} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-[16px]">
      <div className="sk h-[78px]" />
      <div className="wts jx-cats">
        {CATEGORIES.map((c) => (
          <div key={c} className="sk h-[76px]" />
        ))}
      </div>
      <div className="sk overflow-hidden">
        <div className="h-[48px]" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="jx-sk" />
        ))}
      </div>
    </div>
  );
}

/* ═════════ Historique ═════════ */

const PAGE = 150;

function HistoryTab({ t, f, onOpen }: { t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const [cat, setCat] = useState<HistoryCategory>("all");
  const [onlyIssues, setOnlyIssues] = useState(false);
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
  const dayLabel = (d: string) =>
    d === today ? t("feed.today") : d === yesterday ? t("feed.yesterday", { date: f.date(d) }) : f.date(d);
  // routine passes are syncs and empty imports: only meaningful on the unfiltered stream
  const showRoutine = !onlyIssues && cat === "all";

  return (
    <>
      <div className="fl">
        <CategoryMenu value={cat} onChange={setCat} t={t} />
        <button type="button" role="switch" aria-checked={onlyIssues} onClick={() => setOnlyIssues((v) => !v)} className="jx-sw">
          <i aria-hidden />
          {t("feed.onlyIssues")}
        </button>
      </div>

      <div className="list">
        {feed.error && !pages.length ? (
          <p className="jx-msg">{t("feed.error")}</p>
        ) : !feed.data ? (
          <p className="jx-msg">{t("common.loading")}</p>
        ) : days.length === 0 ? (
          <p className="jx-msg">{t("feed.empty")}</p>
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

/** Commandes' filter button: says its value, opens a menu of the areas. */
function CategoryMenu({ value, onChange, t }: { value: HistoryCategory; onChange: (c: HistoryCategory) => void; t: Tr }) {
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
  return (
    <div className="fbw" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`fb ${open ? "open" : ""} ${value !== "all" ? "on" : ""}`}>
        <Ic n="filter" />
        {t("filter.label")} · {t(`cats.${value}.label`)}
        <Ic n="down" className="chev" />
      </button>
      {open && (
        <div role="menu" className="menu">
          {HISTORY_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              aria-checked={value === c}
              className={`mi jx-c-${c} ${value === c ? "on" : ""}`}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            >
              <span className="dotk" aria-hidden />
              <span className="ml">
                {t(`cats.${c}.label`)}
                <small className="jx-mi-hint">{t(`cats.${c}.hint`)}</small>
              </span>
              {value === c && <Ic n="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
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
      className={`jx-fl ${clickable ? "click" : ""} ${sev ?? ""}`}
    >
      <time>{f.time(item.at)}</time>
      {cat === "team" ? (
        <Avatar name={item.actor_name} admin={item.actor_role === "super_admin"} unknown={!item.actor_id && !item.actor_name} />
      ) : (
        <span className={`jx-tile jx-c-${cat}`} title={t(`cats.${cat}.label`)} aria-hidden>
          <AreaIcon cat={cat} gear={item.family === "auto"} />
        </span>
      )}
      <div className="tx">
        <span>{line.title}</span>
        {sev === "fail" && <span className="tg h-red">{t("common.failed")}</span>}
        {sev === "warn" && <span className="tg h-amber">{t("common.toCheck")}</span>}
        {line.sub && <small>{line.sub}</small>}
      </div>
      {clickable ? <Ic n="right" className="chev" /> : <span />}
    </div>
  );
}

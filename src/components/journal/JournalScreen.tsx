"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  BellOff,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  Globe,
  Layers,
  Plug,
  Repeat,
  Search,
  Shield,
  User,
  Users,
  X,
} from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import { groupSeries } from "@/lib/journal/series";
import { AREAS, issueArea, rowArea } from "@/lib/journal/areas";
import type { Family, FeedItem, FeedPage, Issue, Overview, SystemTile, TileFamily } from "@/lib/journal/types";
import { describeFeed, describeIssue, describeTile, type Tr } from "./describe";
import { makeFmt, type Fmt } from "./format";
import { AREA_HUE, AreaPill, Avatar, Bars, Chevron, FamilyIcon, Pill, type Sev } from "./parts";
import { JournalPanel, type PanelState } from "./Panels";
import "./journal.css";

/**
 * Système › Journaux — prototypes/journaux-v3.html, approved 2026-10-09.
 * The /orders skeleton (header · four tiles that filter · search · one filter
 * line · ONE table) in the /feedback look. Two questions, two views: « Aperçu »
 * (does everything work?) and « Historique » (what happened?). Success carries
 * no colour; routine is counted, not listed; the detail lives in the drawer.
 */

interface Market {
  id: string;
  code: string;
  name: string;
}

export function JournalScreen() {
  const t = useTranslations("journaux") as unknown as Tr;
  const statusT = useTranslations("orders.statuses") as unknown as Tr;
  const roleT = useTranslations("nav.roles") as unknown as Tr;
  const locale = useLocale();
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Tripoli", []);
  const f = useMemo(() => makeFmt(locale, tz, (s) => (statusT.has(s) ? statusT(s) : s)), [locale, tz, statusT]);

  const [view, setView] = useState<"overview" | "history">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "historique" ? "history" : "overview",
  );
  const [panel, setPanel] = useState<PanelState | null>(null);
  const closePanel = useCallback(() => setPanel(null), []);

  const overview = useSWR<Overview>("/api/admin/journal/overview", fetcher, { refreshInterval: 60_000 });
  const markets = useSWR<{ data: Market[] }>("/api/markets", fetcher).data?.data ?? [];
  const open = overview.data?.issues.filter((i) => i.status === "open") ?? [];
  const critical = open.filter((i) => i.severity === "critical").length;
  const warning = open.length - critical;

  const selectView = (next: "overview" | "history") => {
    setView(next);
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
    <div className="jx">
      <div className="jx-page">
        <header className="ph">
          <div>
            <div className="crumb">
              {t("v3.crumb")}
              <i aria-hidden>›</i>
              {t("title")}
            </div>
            <h1>{t("title")}</h1>
            <div className="sub">
              <span className="live">
                <i aria-hidden />
                {t("v3.live")}
              </span>
              {overview.data && (
                <>
                  <span className="sep" aria-hidden />
                  <span>{t("v3.updated", { when: f.relative(overview.data.generated_at) })}</span>
                  <span className="sep" aria-hidden />
                  {critical > 0 && <span className="badw">{t("v3.toFix", { n: critical })}</span>}
                  {critical > 0 && warning > 0 && <span className="sep" aria-hidden />}
                  {warning > 0 && <span className="warnw">{t("v3.toWatch", { n: warning })}</span>}
                  {open.length === 0 && <span>{t("v3.allGood")}</span>}
                  <span className="sep" aria-hidden />
                  <span>{t("v3.tracked", { n: overview.data.systems.length })}</span>
                </>
              )}
            </div>
          </div>
          <div className="end">
            <div className="segc" role="tablist">
              {(["overview", "history"] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => selectView(k)}>
                  {t(`tabs.${k}`)}
                  {k === "overview" && open.length > 0 && <span className={`cc ${critical > 0 ? "bad" : ""}`}>{open.length}</span>}
                </button>
              ))}
            </div>
            <button type="button" className="btn2" onClick={() => setPanel({ type: "trace" })}>
              <Search className="ic" aria-hidden />
              {t("find.placeholder")}
              <kbd className="kbd2">/</kbd>
            </button>
          </div>
        </header>

        {view === "overview" ? (
          <OverviewView data={overview.data} failed={!!overview.error} markets={markets} t={t} f={f} panel={panel} onOpen={setPanel} />
        ) : (
          <HistoryView markets={markets} t={t} roleT={roleT} f={f} onOpen={setPanel} />
        )}
      </div>

      {panel && (
        <JournalPanel state={panel} overview={overview.data} onClose={closePanel} onOpen={setPanel} onChanged={() => overview.mutate()} t={t} f={f} />
      )}
    </div>
  );
}

/* ═════════ shared pieces ═════════ */

function Tile({
  on,
  hue,
  icon,
  big,
  label,
  small,
  zero,
  onClick,
  clear,
}: {
  on: boolean;
  hue: string;
  icon: ReactNode;
  big: ReactNode;
  label: string;
  small: ReactNode;
  zero?: boolean;
  onClick: () => void;
  clear: string;
}) {
  return (
    <button type="button" className={`wt ${zero ? "zero" : ""}`} aria-pressed={on} onClick={onClick}>
      <span className={`hold ${hue}`} aria-hidden>
        {icon}
      </span>
      <span className="wt-t">
        <b>{big}</b>
        <span>{label}</span>
        <small>{small}</small>
      </span>
      {on && (
        <span className="wt-x" title={clear} aria-hidden>
          <X className="ic" />
        </span>
      )}
    </button>
  );
}

function SearchLine({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="srch">
      <Search className="ic" aria-hidden />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && (
        <button type="button" className="x" onClick={() => onChange("")} aria-label={label}>
          <X className="ic" aria-hidden />
        </button>
      )}
    </label>
  );
}

interface Option {
  value: string | null;
  label: string;
  count?: number;
  hue?: string;
}

/** `.fb` + `.menu` — one filter button, one choice. */
function FilterMenu({ icon, label, options, value, onChange }: { icon: ReactNode; label: string; options: Option[]; value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className="fbw" ref={ref}>
      <button type="button" className={`fb ${value !== null ? "on" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {icon}
        <span className="l">{label}</span>
        {current?.label}
        <ChevronDown className="ic chev" aria-hidden />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={label}>
          {options.map((o) => (
            <button
              key={o.value ?? "all"}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className={`mi ${o.hue ?? ""}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="rad" aria-hidden />
              {o.hue && <span className="dotk" aria-hidden />}
              <span className="ml">{o.label}</span>
              {o.count != null && <span className="n">{o.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const lower = (s: unknown) => String(s ?? "").toLocaleLowerCase("fr");

/* ═════════ Aperçu ═════════ */

/** Same-rule problems fold from this many on: « 30 transporteurs coupés… » is one row, not thirty. */
const FOLD_FROM = 3;

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
    } else {
      lines.push({ kind: "one", issue: i });
    }
  }
  return lines;
}

type OTile = "now" | "watch" | "systems" | "muted" | null;

function OverviewView({
  data,
  failed,
  markets,
  t,
  f,
  panel,
  onOpen,
}: {
  data: Overview | undefined;
  failed: boolean;
  markets: Market[];
  t: Tr;
  f: Fmt;
  panel: PanelState | null;
  onOpen: (p: PanelState) => void;
}) {
  const [tile, setTile] = useState<OTile>(null);
  const [q, setQ] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [market, setMarket] = useState<string | null>(null);

  const inMarket = (code: string | null) => !market || !code || code === market;
  const systems = (data?.systems ?? []).filter((s) => inMarket(s.market));
  const all = (data?.issues ?? []).filter((i) => inMarket(i.market));
  const areaOfIssue = (i: Issue) => issueArea(i, data?.systems ?? []);
  const open = all.filter((i) => i.status === "open");
  const crit = open.filter((i) => i.severity === "critical");
  const warn = open.filter((i) => i.severity !== "critical");
  const muted = all.filter((i) => i.status === "muted");
  const healthy = systems.filter((s) => s.state === "ok" || s.state === "mute" || s.state === "off").length;
  const oldest = (list: Issue[]) => list.reduce<string | null>((m, i) => (!m || i.first_seen < m ? i.first_seen : m), null);

  const toggle = (k: OTile) => setTile((v) => (v === k ? null : k));
  const issueMatches = (i: Issue) => {
    if (area && areaOfIssue(i) !== area) return false;
    if (!q.trim()) return true;
    const d = describeIssue(i, t, f);
    const sys = data?.systems.find((s) => s.id === i.system);
    return lower(`${d.title} ${d.line} ${sys ? describeTile(sys, t, f).name : ""}`).includes(lower(q.trim()));
  };

  const [showCalm, setShowCalm] = useState(false);
  const needle = lower(q.trim());
  const narrowed = !!area || !!needle;
  const sysList = systems.filter((s) => {
    if (area && s.family !== area) return false;
    if (!needle) return true;
    const d = describeTile(s, t, f);
    return lower(`${d.name} ${d.where} ${d.state}`).includes(needle);
  });
  const attention = [...sysList.filter((s) => s.state === "fail"), ...sysList.filter((s) => s.state === "warn")];
  const calm = sysList.filter((s) => s.state !== "fail" && s.state !== "warn");
  const sysShown = narrowed || showCalm ? [...attention, ...calm] : attention;
  const problemRows = (tile === "muted" ? muted : tile === "now" ? crit : tile === "watch" ? warn : [...crit, ...warn]).filter(issueMatches);

  const areaCounts = (k: TileFamily) =>
    tile === "systems" ? systems.filter((s) => s.family === k).length : (tile === "muted" ? muted : open).filter((i) => areaOfIssue(i) === k).length;

  if (failed && !data) return <p className="quiet">{t("verdict.error")}</p>;

  return (
    <>
      <div className="wts">
        <Tile
          on={tile === "now"}
          hue="h-red"
          icon={<AlertTriangle className="ic" />}
          big={data ? f.num(crit.length) : "—"}
          label={t("v3.tiles.now")}
          small={crit.length ? <>{t("v3.tiles.oldestLead")} <em className="bad">{f.date(oldest(crit)!)}</em></> : t("v3.tiles.nowNone")}
          zero={!crit.length}
          onClick={() => toggle("now")}
          clear={t("v3.clearTile")}
        />
        <Tile
          on={tile === "watch"}
          hue="h-amber"
          icon={<Eye className="ic" />}
          big={data ? f.num(warn.length) : "—"}
          label={t("v3.tiles.watch")}
          small={warn.length ? <>{t("v3.tiles.oldestLead")} <em>{f.date(oldest(warn)!)}</em></> : t("v3.tiles.watchNone")}
          zero={!warn.length}
          onClick={() => toggle("watch")}
          clear={t("v3.clearTile")}
        />
        <Tile
          on={tile === "systems"}
          hue="h-green"
          icon={<CheckCircle2 className="ic" />}
          big={
            data ? (
              <>
                {f.num(healthy)}
                <small> / {f.num(systems.length)}</small>
              </>
            ) : (
              "—"
            )
          }
          label={t("v3.tiles.systems")}
          small={systems.length - healthy > 0 ? t("v3.tiles.systemsSub", { n: systems.length - healthy }) : t("v3.tiles.systemsOk")}
          onClick={() => toggle("systems")}
          clear={t("v3.clearTile")}
        />
        <Tile
          on={tile === "muted"}
          hue="h-neutral"
          icon={<BellOff className="ic" />}
          big={data ? f.num(muted.length) : "—"}
          label={t("v3.tiles.muted")}
          small={
            muted.length
              ? t("v3.tiles.mutedUntil", { date: f.date(muted.reduce((m, i) => (i.muted_until && i.muted_until < m ? i.muted_until : m), muted[0].muted_until ?? muted[0].last_seen)) })
              : t("v3.tiles.mutedNone")
          }
          zero={!muted.length}
          onClick={() => toggle("muted")}
          clear={t("v3.clearTile")}
        />
      </div>

      <SearchLine value={q} onChange={setQ} placeholder={t("v3.search.overview")} label={t("common.close")} />

      <div className="fl">
        <FilterMenu
          icon={<Layers className="ic" aria-hidden />}
          label={t("v3.filters.category")}
          value={area}
          onChange={setArea}
          options={[{ value: null, label: t("v3.filters.allCategories") }, ...AREAS.map((k) => ({ value: k, label: t(`v3.areas.${k}`), count: areaCounts(k), hue: AREA_HUE[k] }))]}
        />
        <FilterMenu
          icon={<Globe className="ic" aria-hidden />}
          label={t("v3.filters.market")}
          value={market}
          onChange={setMarket}
          options={[{ value: null, label: t("v3.filters.allMarkets") }, ...markets.map((m) => ({ value: m.code, label: m.name }))]}
        />
        {data && (
          <span className="count">
            {tile === "systems" ? (
              t("v3.count.systems", { n: sysShown.length, total: systems.length })
            ) : (
              <>
                <b>{f.num(problemRows.length)}</b> {t(tile === "muted" ? "v3.count.muted" : "v3.count.problems", { n: problemRows.length })}
              </>
            )}
          </span>
        )}
      </div>

      {!data ? (
        <TableSkeleton />
      ) : tile === "systems" ? (
        <SystemsTable
          shown={sysShown}
          calm={narrowed ? 0 : calm.length}
          showCalm={showCalm}
          onToggle={() => setShowCalm((v) => !v)}
          empty={!sysList.length}
          t={t}
          f={f}
          onOpen={onOpen}
        />
      ) : (
        <ProblemsTable
          rows={problemRows}
          filtered={narrowed}
          tile={tile}
          waiting={warn.length}
          total={systems.length}
          muted={tile === "muted" ? [] : muted}
          systems={data.systems}
          openId={panel?.type === "issue" ? panel.id : null}
          t={t}
          f={f}
          onOpen={onOpen}
          onTile={setTile}
        />
      )}
    </>
  );
}

function TableSkeleton() {
  return (
    <div className="list" aria-hidden>
      <div className="lh" />
      <div className="rows">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="row" style={{ gridTemplateColumns: "40px 1fr 120px" }}>
            <span className="skel" style={{ width: 40, height: 40, borderRadius: 11 }} />
            <span className="skel" style={{ height: 14, width: "60%" }} />
            <span className="skel" style={{ height: 14 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProblemsTable({
  rows,
  filtered,
  tile,
  waiting,
  total,
  muted,
  systems,
  openId,
  t,
  f,
  onOpen,
  onTile,
}: {
  rows: Issue[];
  filtered: boolean;
  tile: OTile;
  waiting: number;
  total: number;
  muted: Issue[];
  systems: SystemTile[];
  openId: string | null;
  t: Tr;
  f: Fmt;
  onOpen: (p: PanelState) => void;
  onTile: (t: OTile) => void;
}) {
  const [folds, setFolds] = useState<Set<string>>(new Set());
  const lines = foldByRule(rows);
  const row = (i: Issue) => <ProblemRow key={i.id} issue={i} systems={systems} open={openId === i.id} t={t} f={f} onOpen={onOpen} />;

  let empty: ReactNode = null;
  if (!rows.length) {
    if (filtered) empty = <p className="quiet">{t("v3.empty.noMatch")}</p>;
    else if (tile === "muted") empty = <p className="quiet">{t("v3.empty.noMuted")}</p>;
    else
      empty = (
        <div className="empty" role="row">
          <span className="okc" aria-hidden>
            <Check className="ic" />
          </span>
          <div role="cell">
            <b>{tile === "now" && waiting > 0 ? t("v3.empty.urgent") : t("v3.empty.ok")}</b>
            <small>{tile === "now" && waiting > 0 ? t("v3.empty.urgentSub", { n: waiting }) : t("v3.empty.okSub", { total })}</small>
          </div>
          <button type="button" className="lnk" onClick={() => onTile("systems")}>
            {t("v3.empty.seeSystems")}
            <ChevronRight className="ic flip" aria-hidden />
          </button>
        </div>
      );
  }

  return (
    <>
      <div className="list" role="table" aria-label={t("v3.tiles.watch")}>
        <div className="lh t-prob" role="row">
          <span role="columnheader">{t("v3.cols.problem")}</span>
          <span role="columnheader">{t("v3.cols.system")}</span>
          <span role="columnheader">{t("v3.cols.since")}</span>
          <span role="columnheader" className="e">
            {t("v3.cols.impact")}
          </span>
          <span role="columnheader">{t("v3.cols.state")}</span>
          <span aria-hidden />
        </div>
        <div className="rows" role="rowgroup">
          {empty}
          {lines.map((l) =>
            l.kind === "one" ? (
              row(l.issue)
            ) : (
              <div key={l.rule} role="row">
                <div role="cell">
                  <button
                    type="button"
                    className="foldrow"
                    aria-expanded={folds.has(l.rule)}
                    onClick={() =>
                      setFolds((s) => {
                        const n = new Set(s);
                        if (n.has(l.rule)) n.delete(l.rule);
                        else n.add(l.rule);
                        return n;
                      })
                    }
                  >
                    <ChevronRight className="ic chev flip" aria-hidden />
                    {t(`rules.${l.rule}.fold`, { n: l.issues.length })}
                  </button>
                  {folds.has(l.rule) && <div className="foldin">{l.issues.map(row)}</div>}
                </div>
              </div>
            ),
          )}
          {muted.length > 0 && (
            <div role="row">
              <div role="cell">
                <button type="button" className="foldrow" onClick={() => onTile("muted")}>
                  <BellOff className="ic" aria-hidden />
                  {t("v3.folds.mutedLine", { n: muted.length })}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ProblemRow({ issue, systems, open, t, f, onOpen }: { issue: Issue; systems: SystemTile[]; open: boolean; t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const d = describeIssue(issue, t, f);
  const area = issueArea(issue, systems);
  const sys = systems.find((s) => s.id === issue.system);
  const sev: Sev = issue.status === "muted" ? "mute" : issue.severity === "critical" ? "fail" : "warn";
  return (
    <div role="row" className={`row click t-prob ${open ? "open" : ""} ${sev === "mute" ? "mute" : ""}`}>
      <div role="cell" className="min-w-0">
        <button type="button" className="rowbtn oc" onClick={() => onOpen({ type: "issue", id: issue.id })}>
          <FamilyIcon family={area} />
          <span className="oc-t">
            <span className="nm">{d.title}</span>
            <span className="l2">{issue.status === "muted" && issue.muted_until ? t("common.mutedUntil", { date: f.date(issue.muted_until) }) : d.line}</span>
          </span>
        </button>
      </div>
      <span role="cell" className="cell">
        {sys ? describeTile(sys, t, f).name : t(`v3.areas.${area}`)}
        {issue.market && <span className="mk">{issue.market}</span>}
        <small>{t(`v3.areas.${area}`)}</small>
      </span>
      <span role="cell" className="cell">
        {f.date(issue.first_seen)}
      </span>
      <span role="cell" className="imp">
        <b className={sev === "fail" ? "bad" : undefined}>{d.impact[0]}</b>
        <small>{d.impact[1]}</small>
      </span>
      <span role="cell">
        <Pill sev={sev}>{sev === "mute" ? t("v3.state.muted") : sev === "fail" ? t("v3.state.toFix") : t("v3.state.toWatch")}</Pill>
      </span>
      <Chevron />
    </div>
  );
}

function SystemsTable({
  shown,
  calm,
  showCalm,
  onToggle,
  empty,
  t,
  f,
  onOpen,
}: {
  shown: SystemTile[];
  calm: number;
  showCalm: boolean;
  onToggle: () => void;
  empty: boolean;
  t: Tr;
  f: Fmt;
  onOpen: (p: PanelState) => void;
}) {
  const openOf = (s: SystemTile): PanelState => (s.id === "jobs" ? { type: "jobs" } : s.id === "app" ? { type: "app" } : { type: "tile", id: s.id });
  return (
    <>
      <div className="list" role="table" aria-label={t("v3.tiles.systems")}>
        <div className="lh t-sys" role="row">
          <span role="columnheader">{t("v3.cols.system")}</span>
          <span role="columnheader">{t("v3.cols.category")}</span>
          <span role="columnheader">{t("v3.cols.lastActivity")}</span>
          <span role="columnheader">{t("v3.cols.bars")}</span>
          <span role="columnheader">{t("v3.cols.state")}</span>
          <span aria-hidden />
        </div>
        <div className="rows" role="rowgroup">
          {empty && <p className="quiet">{t("v3.empty.noMatch")}</p>}
          {shown.map((s) => {
            const d = describeTile(s, t, f);
            return (
              <div key={s.id} role="row" className="row click t-sys">
                <div role="cell" className="min-w-0">
                  <button type="button" className="rowbtn oc" onClick={() => onOpen(openOf(s))}>
                    <FamilyIcon family={s.family} />
                    <span className="oc-t">
                      <span className="nm">
                        {d.name}
                        {s.market && <span className="mk">{s.market}</span>}
                      </span>
                      <span className="l2">{d.where}</span>
                    </span>
                  </button>
                </div>
                <span role="cell">
                  <AreaPill family={s.family} />
                </span>
                <span role="cell" className="cell">
                  {d.last}
                </span>
                <span role="cell">{s.bars ? <Bars bars={s.bars} /> : <span className="hb-none">—</span>}</span>
                <span role="cell">
                  <Pill sev={s.state as Sev}>{d.state}</Pill>
                </span>
                <Chevron />
              </div>
            );
          })}
          {calm > 0 && (
            <div role="row">
              <div role="cell">
                <button type="button" className="foldrow" aria-expanded={showCalm} onClick={onToggle}>
                  <ChevronRight className="ic chev flip" aria-hidden />
                  {showCalm ? t("v3.folds.lessSystems") : t("v3.folds.moreSystems", { n: calm })}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ═════════ Historique ═════════ */

const PAGE = 150;
type Period = "today" | "d7" | "d30";
type Summary = { families: Record<Family, { events: number; problems: number }> | null; routine: number };

function periodStart(p: Period, f: Fmt): string {
  const now = f.now.getTime();
  if (p === "d7") return new Date(now - 7 * 86_400_000).toISOString();
  if (p === "d30") return new Date(now - 30 * 86_400_000).toISOString();
  // today, in the reader's zone: step back the local hours and minutes
  const [h, m] = f.time(f.now.toISOString()).split(":").map(Number);
  const start = now - ((h || 0) * 3600 + (m || 0) * 60) * 1000;
  return new Date(start - (start % 60_000)).toISOString();
}

function HistoryView({ markets, t, roleT, f, onOpen }: { markets: Market[]; t: Tr; roleT: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const [family, setFamily] = useState<Family | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [period, setPeriod] = useState<Period>("d7");
  const [market, setMarket] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const from = useMemo(() => periodStart(period, f), [period, f]);

  const summary = useSWR<Summary>(
    `/api/admin/journal/summary?${new URLSearchParams({ from, tz: f.tz, ...(market ? { market } : {}) }).toString()}`,
    fetcher,
    { refreshInterval: 60_000 },
  );

  const keyOf = useCallback(
    (index: number, prev: FeedPage | null) => {
      if (prev && !prev.next) return null;
      const p = new URLSearchParams({ limit: String(PAGE), tz: f.tz });
      if (family) p.set("family", family);
      if (onlyIssues) p.set("only_issues", "1");
      if (market) p.set("market", market);
      if (index > 0 && prev?.next) {
        p.set("before", prev.next.before);
        p.set("before_id", prev.next.beforeId);
      }
      return `/api/admin/journal/feed?${p.toString()}`;
    },
    [family, onlyIssues, market, f.tz],
  );
  const feed = useSWRInfinite<FeedPage>(keyOf, fetcher, { refreshInterval: 60_000, revalidateFirstPage: true });
  const pages = useMemo(() => feed.data ?? [], [feed.data]);
  const last = pages[pages.length - 1];
  const hasMore = !!last?.next && Date.parse(last.next.before) >= Date.parse(from);

  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of pages) for (const r of p.rows) if (r.actor_name) seen.set(`${r.actor_id ?? "-"}|${r.actor_name}`, r.actor_name);
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [pages]);

  const days = useMemo(() => {
    const needle = lower(q.trim());
    const rows = pages
      .flatMap((p) => p.rows)
      .filter((r) => r.at >= from)
      .filter((r) => !person || `${r.actor_id ?? "-"}|${r.actor_name}` === person)
      .filter((r) => {
        if (!needle) return true;
        const line = describeFeed({ ...r, count: 1, since: r.at, members: [r] }, t, f);
        return lower(`${line.title} ${line.sub ?? ""} ${r.actor_name ?? ""} ${r.order_ref ?? ""}`).includes(needle);
      });
    const items = groupSeries(rows, f.dayKey);
    const routine: Record<string, number> = {};
    for (const p of pages) for (const [d, n] of Object.entries(p.routine ?? {})) routine[d] = (routine[d] ?? 0) + n;
    const out: { day: string; items: FeedItem[]; routine: number; n: number }[] = [];
    for (const it of items) {
      const d = f.dayKey(it.at);
      if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, items: [], routine: routine[d] ?? 0, n: 0 });
      out[out.length - 1].items.push(it);
      out[out.length - 1].n += it.count;
    }
    return out;
  }, [pages, from, person, q, t, f]);
  const shown = days.reduce((n, d) => n + d.n, 0);

  const today = f.dayKey(f.now.toISOString());
  const yesterday = f.dayKey(new Date(f.now.getTime() - 86_400_000).toISOString());
  const dayLabel = (d: string) => `${d === today ? t("feed.today") : d === yesterday ? t("feed.yesterday", { date: f.date(d) }).split(" · ")[0] : ""}${d === today || d === yesterday ? " · " : ""}${f.date(d)}`;

  const fam = summary.data?.families ?? null;
  const counted = !!summary.data;
  const big = (k: Family) => (fam ? f.num(fam[k].events + (k === "auto" ? summary.data!.routine : 0)) : "—");
  const smallOf = (k: Family): ReactNode => {
    if (!counted) return "…";
    if (!fam) return t("v3.tiles.noCount");
    const n = fam[k].problems;
    if (k === "team") return t("v3.tiles.teamSub");
    if (k === "ext") return n ? <em className="bad">{t("v3.tiles.extSub", { n })}</em> : t("v3.tiles.extSub", { n });
    if (k === "auto") return t("v3.tiles.autoSub", { n, routine: f.num(summary.data!.routine) });
    return t("v3.tiles.secSub", { n });
  };
  const TILE: { k: Family; hue: string; icon: ReactNode }[] = [
    { k: "team", hue: "h-violet", icon: <Users className="ic" /> },
    { k: "ext", hue: "h-blue", icon: <Plug className="ic" /> },
    { k: "auto", hue: "h-teal", icon: <Repeat className="ic" /> },
    { k: "sec", hue: "h-red", icon: <Shield className="ic" /> },
  ];
  const routineShown = !onlyIssues && !person && !q.trim() && (!family || family === "auto");

  return (
    <>
      <div className="wts">
        {TILE.map(({ k, hue, icon }) => (
          <Tile
            key={k}
            on={family === k}
            hue={hue}
            icon={icon}
            big={big(k)}
            label={t(`v3.tiles.${k}`)}
            small={smallOf(k)}
            onClick={() => setFamily((v) => (v === k ? null : k))}
            clear={t("v3.clearTile")}
          />
        ))}
      </div>

      <SearchLine value={q} onChange={setQ} placeholder={t("v3.search.history")} label={t("common.close")} />

      <div className="fl">
        <FilterMenu
          icon={<Calendar className="ic" aria-hidden />}
          label={t("v3.filters.period")}
          value={period}
          onChange={(v) => setPeriod((v as Period) ?? "d7")}
          options={(["today", "d7", "d30"] as const).map((p) => ({ value: p, label: t(`v3.filters.${p}`) }))}
        />
        <FilterMenu
          icon={<User className="ic" aria-hidden />}
          label={t("v3.filters.person")}
          value={person}
          onChange={setPerson}
          options={[{ value: null, label: t("v3.filters.everyone") }, ...people]}
        />
        <FilterMenu
          icon={<Globe className="ic" aria-hidden />}
          label={t("v3.filters.market")}
          value={market}
          onChange={setMarket}
          options={[{ value: null, label: t("v3.filters.allMarkets") }, ...markets.map((m) => ({ value: m.id, label: m.name }))]}
        />
        <button type="button" role="switch" aria-checked={onlyIssues} className={`fb ${onlyIssues ? "on" : ""}`} onClick={() => setOnlyIssues((v) => !v)}>
          <span className="sw" aria-hidden />
          {t("feed.onlyIssues")}
        </button>
        <span className="count">
          <b>{f.num(shown)}</b> {t("v3.count.events", { n: shown })}
        </span>
      </div>

      <div className="list" role="table" aria-label={t("tabs.history")}>
        <div className="lh t-hist" role="row">
          <span role="columnheader">{t("v3.cols.time")}</span>
          <span role="columnheader">{t("v3.cols.who")}</span>
          <span role="columnheader">{t("v3.cols.what")}</span>
          <span role="columnheader">{t("v3.cols.category")}</span>
          <span role="columnheader">{t("v3.cols.result")}</span>
          <span aria-hidden />
        </div>
        <div className="rows" role="rowgroup">
          {feed.error && !pages.length ? (
            <p className="quiet">{t("feed.error")}</p>
          ) : !feed.data ? (
            <p className="quiet">{t("common.loading")}</p>
          ) : days.length === 0 ? (
            <p className="quiet">{q.trim() || person ? t("v3.empty.noMatch") : t("feed.empty")}</p>
          ) : (
            days.map((d) => (
              <div key={d.day} role="presentation">
                <div className="g" role="row">
                  <span role="cell">{dayLabel(d.day)}</span>
                  <span className="gn">{t("v3.count.day", { n: d.n })}</span>
                </div>
                {d.items.map((it) => (
                  <HistoryRow key={it.id} item={it} t={t} roleT={roleT} f={f} onOpen={onOpen} />
                ))}
                {d.routine > 0 && routineShown && (
                  <div className="routine" role="row">
                    <Repeat className="ic" aria-hidden />
                    <span role="cell">{t("feed.routine", { n: d.routine })}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        {hasMore && (
          <div className="more">
            <button type="button" className="btn2" onClick={() => feed.setSize(feed.size + 1)} disabled={feed.isValidating}>
              {feed.isValidating ? t("common.loading") : t("feed.more")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function HistoryRow({ item, t, roleT, f, onOpen }: { item: FeedItem; t: Tr; roleT: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const line = describeFeed(item, t, f);
  // An explicit event (sign-in, export) has no before → after to open.
  const empty = item.ref?.startsWith("audit:") && !item.params?.fields;
  const clickable = (!!item.ref && !empty) || item.count > 1;
  const area = rowArea(item);
  const sev = item.severity;
  const person = item.family === "team" || (!!item.actor_name && item.family === "sec");
  const detector = item.kind.startsWith("issue.");
  const p = item.params ?? {};
  const series = item.count > 1 && !line.title.includes(f.num(item.count)) && !line.title.includes(String(item.count));
  const what = (
    <span className="oc-t">
      <span className="nm lt">
        <span>{line.title}</span>
        {series && <span className="ser">×{item.count}</span>}
      </span>
      {line.sub && <span className="l2">{line.sub}</span>}
    </span>
  );
  return (
    <div role="row" data-row className={`row t-hist ${clickable ? "click" : ""}`}>
      <span role="cell" className="time">
        {f.time(item.at)}
      </span>
      <span role="cell" className="who">
        {person ? (
          <>
            <Avatar name={item.actor_name} seed={item.actor_id} unknown={!item.actor_id && !item.actor_name} />
            <span>
              <b>{item.actor_name ?? t("who.unknown")}</b>
              {item.actor_role && <small>{roleT.has(item.actor_role) ? roleT(item.actor_role) : item.actor_role}</small>}
            </span>
          </>
        ) : (
          <>
            <FamilyIcon family={area} small />
            <span>
              <b>{item.family === "ext" && !detector ? String(p.carrier ?? p.shop ?? p.system ?? t("v3.who.service")) : t("who.system")}</b>
              <small>{detector ? t("v3.who.detector") : item.family === "auto" ? t("v3.who.auto") : item.family === "ext" ? t("v3.who.external") : t("v3.who.server")}</small>
            </span>
          </>
        )}
      </span>
      <div role="cell" className="min-w-0">
        {clickable ? (
          <button type="button" className="rowbtn" onClick={() => onOpen({ type: "item", item })}>
            {what}
          </button>
        ) : (
          what
        )}
      </div>
      <span role="cell">
        <AreaPill family={area} />
      </span>
      <span role="cell">
        {sev === "fail" ? (
          <Pill sev="fail">{t("common.failed")}</Pill>
        ) : sev === "warn" ? (
          <Pill sev="warn">{t("common.toCheck")}</Pill>
        ) : (
          <span className="st none">—</span>
        )}
      </span>
      {clickable ? <Chevron /> : <span aria-hidden />}
    </div>
  );
}

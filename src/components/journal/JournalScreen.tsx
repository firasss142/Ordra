"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Search, XCircle } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import { groupSeries } from "@/lib/journal/series";
import type { FeedItem, FeedPage, Family, Issue, Overview, SystemTile, TileFamily } from "@/lib/journal/types";
import { describeFeed, describeIssue, describeTile, type Tr } from "./describe";
import { makeFmt, type Fmt } from "./format";
import { Avatar, Chevron, FamilyIcon, Flag, StateLine, type Sev } from "./parts";
import { JournalPanel, type PanelState } from "./Panels";

/**
 * Système › Journaux — prototypes/journaux-v2.html, approved 2026-10-03.
 * Two questions, two tabs: « Aperçu » (does everything work?) and
 * « Historique » (what happened?). Success carries no colour; routine is
 * counted, not listed; the detail lives in the panels.
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
    <div className="mx-auto max-w-[940px] px-[16px] pb-[64px] pt-[30px] md:px-[32px]">
      <div className="flex flex-wrap items-center gap-[16px]">
        <h1 className="m-0 text-[24px] font-[650] tracking-[-0.015em] text-ink-primary">{t("title")}</h1>
        <button
          type="button"
          onClick={() => setPanel({ type: "trace" })}
          className="flex h-[40px] w-full items-center gap-[9px] rounded-[10px] border border-[#D2D5D9] bg-white px-[12px] text-start text-ink-muted hover:border-[#B9BEC4] sm:ms-auto sm:w-[340px]"
        >
          <Search className="h-[16px] w-[16px] text-ink-secondary" aria-hidden />
          <span className="flex-1 text-[14px]">{t("find.placeholder")}</span>
          <kbd className="rounded-[5px] border border-line bg-surface-sunken px-[6px] font-sans text-[11.5px] text-ink-secondary">/</kbd>
        </button>
      </div>

      <div role="tablist" className="mb-[26px] mt-[18px] flex gap-[26px] border-b border-line">
        {(["overview", "history"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => selectTab(k)}
            className={`relative inline-flex items-center gap-[8px] pb-[12px] pt-[10px] text-[15px] ${
              tab === k
                ? "font-semibold text-ink-primary after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:rounded-[2px] after:bg-brand"
                : "font-medium text-ink-secondary"
            }`}
          >
            {t(`tabs.${k}`)}
            {k === "overview" && open.length > 0 && (
              <span className="inline-grid h-[20px] min-w-[20px] place-items-center rounded-full bg-[var(--jx-fail-bg)] px-[6px] text-[12px] font-bold text-[var(--jx-fail-ink)]">
                {open.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <OverviewTab data={overview.data} failed={!!overview.error} t={t} f={f} onOpen={setPanel} />
      ) : (
        <HistoryTab t={t} f={f} onOpen={setPanel} />
      )}

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
  if (failed && !data) return <p className="text-[14px] text-ink-secondary">{t("verdict.error")}</p>;
  if (!data) return <OverviewSkeleton />;

  const open = data.issues.filter((i) => i.status === "open");
  const muted = data.issues.filter((i) => i.status === "muted");
  const healthy = data.systems.filter((s) => s.state === "ok" || s.state === "mute" || s.state === "off").length;
  const ok = open.length === 0;

  return (
    <>
      <div className="mb-[28px] flex items-center gap-[16px]">
        <span
          className={`grid h-[48px] w-[48px] flex-none place-items-center rounded-full ${
            ok ? "bg-[var(--jx-ok-bg)] text-[var(--jx-ok)]" : "bg-[var(--jx-fail-bg)] text-[var(--jx-fail)]"
          }`}
          aria-hidden
        >
          {ok ? <CheckCircle2 className="h-[24px] w-[24px]" strokeWidth={2} /> : <XCircle className="h-[24px] w-[24px]" strokeWidth={2} />}
        </span>
        <div>
          <h2 className="m-0 text-[21px] font-[650] tracking-[-0.01em] text-ink-primary">
            {ok ? t("verdict.ok") : t("verdict.issues", { n: open.length })}
          </h2>
          <p className="m-0 mt-[2px] text-[14.5px] text-ink-secondary">
            {ok ? t("verdict.okSub", { total: data.systems.length }) : t("verdict.issuesSub", { ok: healthy, total: data.systems.length })}
          </p>
        </div>
      </div>

      {open.length > 0 && (
        <section aria-labelledby="jx-tofix" className="mb-[32px]">
          <h3 id="jx-tofix" className="mb-[10px] mt-0 text-[13px] font-semibold text-ink-secondary">
            {t("sections.toFix")}
          </h3>
          {open.map((i) => (
            <ProblemCard key={i.id} issue={i} t={t} f={f} onClick={() => onOpen({ type: "issue", id: i.id })} />
          ))}
        </section>
      )}

      <section aria-labelledby="jx-systems" className="mb-[32px]">
        <h3 id="jx-systems" className="mb-[10px] mt-0 text-[13px] font-semibold text-ink-secondary">
          {t("sections.systems")}
        </h3>
        <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2 lg:grid-cols-3">
          {data.systems.map((s) => (
            <SystemCard
              key={s.id}
              tile={s}
              t={t}
              f={f}
              onClick={() => onOpen(s.id === "jobs" ? { type: "jobs" } : s.id === "app" ? { type: "app" } : { type: "tile", id: s.id })}
            />
          ))}
        </div>
      </section>

      {muted.length > 0 && (
        <section aria-labelledby="jx-muted" className="mb-[32px]">
          <h3 id="jx-muted" className="mb-[10px] mt-0 text-[13px] font-semibold text-ink-secondary">
            {t("sections.muted")}
          </h3>
          {muted.map((i) => (
            <ProblemCard key={i.id} issue={i} t={t} f={f} onClick={() => onOpen({ type: "issue", id: i.id })} />
          ))}
        </section>
      )}
    </>
  );
}

function ProblemCard({ issue, t, f, onClick }: { issue: Issue; t: Tr; f: Fmt; onClick: () => void }) {
  const d = describeIssue(issue, t, f);
  const sev = issue.status === "muted" ? "mute" : issue.severity === "critical" ? "fail" : "warn";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-[8px] grid w-full grid-cols-[10px_minmax(0,1fr)_18px] items-center gap-x-[16px] gap-y-[6px] rounded-[12px] sm:grid-cols-[10px_minmax(0,1fr)_auto_18px] border border-line-subtle bg-white px-[18px] py-[16px] text-start hover:border-line hover:bg-[#F7F7F8] ${
        sev === "mute" ? "opacity-70" : ""
      }`}
    >
      <span
        aria-hidden
        className={`h-[10px] w-[10px] rounded-full ${sev === "fail" ? "bg-[var(--jx-fail)]" : sev === "warn" ? "bg-[var(--jx-warn)]" : "bg-[var(--jx-mute)]"}`}
      />
      <span className="min-w-0">
        <h4 className="m-0 text-[15px] font-semibold leading-[1.35] text-ink-primary">{d.title}</h4>
        <p className="m-0 mt-[3px] text-[13.5px] text-ink-secondary">
          {issue.status === "muted" && issue.muted_until ? t("common.mutedUntil", { date: f.date(issue.muted_until) }) : d.line}
        </p>
      </span>
      {/* under the text on a phone, beside it from sm up */}
      <span className="col-start-2 row-start-2 whitespace-nowrap text-start sm:col-start-auto sm:row-start-auto sm:text-end">
        <b className={`inline text-[17px] sm:block font-[650] tabular-nums ${sev === "fail" ? "text-[var(--jx-fail-ink)]" : "text-ink-primary"}`}>{d.impact[0]}</b>
        <span className="ms-[6px] text-[12.5px] text-ink-secondary sm:ms-0">{d.impact[1]}</span>
      </span>
      <span className="col-start-3 row-span-2 row-start-1 sm:col-start-auto sm:row-span-1 sm:row-start-auto">
        <Chevron />
      </span>
    </button>
  );
}

function SystemCard({ tile, t, f, onClick }: { tile: SystemTile; t: Tr; f: Fmt; onClick: () => void }) {
  const d = describeTile(tile, t, f);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-[12px] rounded-[12px] border bg-white px-[16px] py-[14px] text-start hover:bg-[#F7F7F8] ${
        tile.state === "fail" ? "border-[var(--jx-fail-line)]" : tile.state === "warn" ? "border-[var(--jx-warn-line)]" : "border-line-subtle hover:border-line"
      }`}
    >
      <FamilyIcon family={tile.family} />
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14px] font-semibold text-ink-primary">{d.name}</b>
        <small className="mt-[1px] block text-[12.5px] text-ink-secondary">{d.where}</small>
        <StateLine sev={tile.state as Sev}>{d.state}</StateLine>
        <small className="mt-[1px] block text-[12.5px] text-ink-secondary">{d.last}</small>
      </span>
    </button>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
      <div className="mb-[28px] flex items-center gap-[16px]">
        <span className="h-[48px] w-[48px] rounded-full bg-[var(--jx-mute-bg)]" />
        <span className="h-[22px] w-[240px] rounded-[6px] bg-[var(--jx-mute-bg)]" />
      </div>
      <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="h-[96px] rounded-[12px] bg-white" />
        ))}
      </div>
    </div>
  );
}

/* ═════════ Historique ═════════ */

const CHIPS: ("all" | Family)[] = ["all", "ext", "team", "auto", "sec"];
const PAGE = 150;

function HistoryTab({ t, f, onOpen }: { t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const [family, setFamily] = useState<"all" | Family>("all");
  const [onlyIssues, setOnlyIssues] = useState(false);

  const keyOf = useCallback(
    (index: number, prev: FeedPage | null) => {
      if (prev && !prev.next) return null;
      const q = new URLSearchParams({ limit: String(PAGE), tz: f.tz });
      if (family !== "all") q.set("family", family);
      if (onlyIssues) q.set("only_issues", "1");
      if (index > 0 && prev?.next) {
        q.set("before", prev.next.before);
        q.set("before_id", prev.next.beforeId);
      }
      return `/api/admin/journal/feed?${q.toString()}`;
    },
    [family, onlyIssues, f.tz],
  );
  const feed = useSWRInfinite<FeedPage>(keyOf, fetcher, { refreshInterval: 60_000, revalidateFirstPage: true });
  const pages = feed.data ?? [];
  const last = pages[pages.length - 1];

  const days = useMemo(() => {
    const rows = pages.flatMap((p) => p.rows);
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
  }, [pages, f]);

  const today = f.dayKey(f.now.toISOString());
  const yesterday = f.dayKey(new Date(f.now.getTime() - 86_400_000).toISOString());
  const dayLabel = (d: string) =>
    d === today ? t("feed.today") : d === yesterday ? t("feed.yesterday", { date: f.date(d) }) : f.date(d);

  return (
    <>
      <div className="mb-[18px] flex flex-wrap items-center gap-[8px]">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={family === c}
            onClick={() => setFamily(c)}
            className={`h-[34px] rounded-full border px-[14px] text-[13.5px] font-medium ${
              family === c ? "border-ink-primary bg-ink-primary text-white" : "border-[#D2D5D9] bg-white text-ink-secondary"
            }`}
          >
            {t(`feed.chips.${c}`)}
          </button>
        ))}
        <button
          type="button"
          role="switch"
          aria-checked={onlyIssues}
          onClick={() => setOnlyIssues((v) => !v)}
          className="ms-auto inline-flex items-center gap-[8px] text-[13.5px] text-ink-secondary"
        >
          <i
            aria-hidden
            className={`relative inline-block h-[19px] w-[32px] rounded-full after:absolute after:start-[2px] after:top-[2px] after:h-[15px] after:w-[15px] after:rounded-full after:bg-white after:transition-transform ${
              onlyIssues ? "bg-brand after:translate-x-[13px] rtl:after:-translate-x-[13px]" : "bg-[#C9CDD2]"
            }`}
          />
          {t("feed.onlyIssues")}
        </button>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-line-subtle bg-white">
        {feed.error && !pages.length ? (
          <p className="m-0 px-[20px] py-[48px] text-center text-[14px] text-ink-secondary">{t("feed.error")}</p>
        ) : !feed.data ? (
          <p className="m-0 px-[20px] py-[48px] text-center text-[14px] text-ink-secondary">{t("common.loading")}</p>
        ) : days.length === 0 ? (
          <p className="m-0 px-[20px] py-[48px] text-center text-[14px] text-ink-secondary">{t("feed.empty")}</p>
        ) : (
          days.map((d) => (
            <div key={d.day}>
              <div className="px-[20px] pb-[6px] pt-[14px] text-[13px] font-semibold text-ink-secondary">{dayLabel(d.day)}</div>
              {d.items.map((it, i) => (
                <FeedLine key={it.id} item={it} first={i === 0} t={t} f={f} onOpen={onOpen} />
              ))}
              {d.routine > 0 && !onlyIssues && (
                <div className="border-t border-line-subtle pb-[12px] pe-[20px] ps-[20px] pt-[9px] text-[13px] text-ink-muted md:ps-[114px]">
                  {t("feed.routine", { n: d.routine })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {last?.next && (
        <div className="mt-[14px] text-center">
          <button
            type="button"
            onClick={() => feed.setSize(feed.size + 1)}
            disabled={feed.isValidating}
            className="h-[38px] rounded-[8px] border border-[#D2D5D9] bg-white px-[14px] text-[14px] font-medium hover:bg-surface-hover disabled:opacity-60"
          >
            {feed.isValidating ? t("common.loading") : t("feed.more")}
          </button>
        </div>
      )}
    </>
  );
}

function rowFamily(it: FeedItem): TileFamily {
  const [domain] = it.kind.split(".");
  if (it.family === "sec") return "app";
  if (it.family === "auto") return "auto";
  if (domain === "intake") return "intake";
  if (domain === "sync" && it.params?.system === "Meta") return "ads";
  if (domain === "issue") {
    const rule = String(it.params?.rule ?? "");
    if (rule === "job_failing") return "auto";
    if (["import_rows", "ads_no_orders"].includes(rule)) return "intake";
    if (rule === "whatsapp_down") return "msg";
    if (["server_error", "login_failures", "large_export"].includes(rule)) return "app";
  }
  return "carrier";
}

function FeedLine({ item, first, t, f, onOpen }: { item: FeedItem; first: boolean; t: Tr; f: Fmt; onOpen: (p: PanelState) => void }) {
  const line = describeFeed(item, t, f);
  // An explicit event (sign-in, export) has no before → after to open.
  const empty = item.ref?.startsWith("audit:") && !item.params?.fields;
  const clickable = (!!item.ref && !empty) || item.count > 1;
  const sev = item.severity;
  const open = () => onOpen({ type: "item", item });
  return (
    <div
      data-row
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? open : undefined}
      onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open()) : undefined}
      className={`grid grid-cols-[48px_32px_minmax(0,1fr)_18px] items-center gap-[14px] px-[20px] py-[11px] ${first ? "" : "border-t border-line-subtle"} ${
        sev === "fail" ? "bg-[var(--jx-fail-bg)]" : sev === "warn" ? "bg-[var(--jx-warn-bg)]" : ""
      } ${clickable ? (sev === "fail" ? "cursor-pointer hover:bg-[var(--jx-fail-hover)]" : "cursor-pointer hover:bg-[#F7F7F8]") : ""}`}
    >
      <span className="text-[13px] tabular-nums text-ink-muted">{f.time(item.at)}</span>
      {item.family === "team" ? (
        <Avatar name={item.actor_name} admin={item.actor_role === "super_admin"} unknown={!item.actor_id && !item.actor_name} />
      ) : (
        <FamilyIcon family={rowFamily(item)} size={32} gear={item.family === "auto"} />
      )}
      <div className="min-w-0 text-[14.5px] leading-[1.4] text-ink-primary">
        <span>{line.title}</span>
        {sev === "fail" && <Flag sev="fail">{t("common.failed")}</Flag>}
        {sev === "warn" && <Flag sev="warn">{t("common.toCheck")}</Flag>}
        {line.sub && <small className="mt-[1px] block text-[13px] text-ink-secondary">{line.sub}</small>}
      </div>
      {clickable ? <Chevron /> : <span />}
    </div>
  );
}

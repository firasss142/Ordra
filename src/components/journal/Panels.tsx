"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import useSWR from "swr";
import { useLocale } from "next-intl";
import { ExternalLink, Search } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import { useToast } from "@/components/ui/Toast";
import type { FeedItem, Issue, Overview, Trace, OrderMatch } from "@/lib/journal/types";
import {
  areaOf,
  causeLabel,
  describeFeed,
  describeIssue,
  describeTile,
  describeTraceEvent,
  fieldLabel,
  issueFromFeed,
  jobLabel,
  marketName,
  scheduleLabel,
  settingLabel,
  verbOf,
  type Tr,
} from "./describe";
import type { Fmt } from "./format";
import { Btn, Callout, Code, Figures, H4, HourBars, MiniTable, P, Panel, Pill, Steps, Tech, type Sev } from "./parts";

export type PanelState =
  | { type: "issue"; id: string; fallback?: Issue }
  | { type: "tile"; id: string }
  | { type: "jobs" }
  | { type: "app" }
  | { type: "item"; item: FeedItem }
  | { type: "trace"; orderId?: string };

interface Props {
  state: PanelState;
  overview: Overview | undefined;
  onClose: () => void;
  onOpen: (p: PanelState) => void;
  onChanged: () => void;
  t: Tr;
  f: Fmt;
}

export function JournalPanel(props: Props) {
  const { state } = props;
  switch (state.type) {
    case "issue":
      return <IssuePanel {...props} id={state.id} fallback={state.fallback} />;
    case "tile":
      return <TilePanel {...props} id={state.id} />;
    case "jobs":
      return <JobsPanel {...props} />;
    case "app":
      return <AppPanel {...props} />;
    case "trace":
      return <TracePanel {...props} orderId={state.orderId} />;
    case "item":
      return <ItemPanel {...props} item={state.item} />;
  }
}

/** Rules whose own steps already say the problem closes by itself. */
const SAYS_IT_CLOSES = new Set(["job_failing", "connection_silent", "carrier_stuck", "server_error"]);

const sevOf = (i: Pick<Issue, "severity" | "status">): Sev => (i.status === "muted" ? "mute" : i.severity === "critical" ? "fail" : "warn");

/* ── a problem: « Ce qui se passe · Combien · Que faire » ── */

function IssuePanel({ id, fallback, overview, onClose, onOpen, onChanged, t, f }: Props & { id: string; fallback?: Issue }) {
  const locale = useLocale();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const issue = overview?.issues.find((i) => i.id === id) ?? fallback;
  if (!issue) {
    return (
      <Panel open onClose={onClose} title={t("common.notFound")}>
        <P small>{t("common.selfHeal")}</P>
      </Panel>
    );
  }
  const d = describeIssue(issue, t, f);
  const p = issue.params ?? {};
  const k = `rules.${issue.rule}`;
  const str = (v: unknown) => (v == null ? "" : String(v));
  const todo = ["todo1", "todo2", "todo3"].filter((s) => t.has(`${k}.${s}`)).map((s) => t(`${k}.${s}`));

  const what = t.has(`${k}.what`)
    ? t(`${k}.what`, {
        since: f.date(issue.first_seen),
        last: f.relative(str(p.last) || issue.last_seen),
        hours: d.title.match(/\d+(?= h)/)?.[0] ?? "12",
        status: str(p.status) || "other",
        reason: str(p.reason) || t("common.unknown"),
      })
    : d.line;

  const figures: { value: string; label: string; fail?: boolean }[] = [{ value: d.impact[0], label: d.impact[1], fail: issue.severity === "critical" }];
  if (issue.rule === "carrier_inactive") {
    if (issue.amount != null) figures.push({ value: f.money(issue.amount, issue.currency), label: t(`${k}.value`) });
    if (Number(p.no_news) > 0) figures.push({ value: f.num(p.no_news), label: t(`${k}.noNews`), fail: true });
  }
  if (issue.rule === "carrier_stuck" && issue.amount != null) figures.push({ value: f.num(issue.affected), label: t(`${k}.impactCount`) });

  const mute = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/journal/issues/${issue.id}/mute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 7 }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      toast.show({ tone: "info", message: t("common.muteDone") });
      onChanged();
      onClose();
    } else {
      toast.show({ tone: "critical", message: t("common.muteFailed") });
    }
  };

  const tech: ReactNode[] = [];
  if (issue.rule === "job_failing" && p.message) tech.push(<Code key="m">{str(p.message).trim()}</Code>);
  if (issue.rule === "server_error")
    tech.push(<Code key="s">{`${str(p.method)} ${str(p.route)}  →  ${str(p.status)}${p.code ? `\n${str(p.code)} ${str(p.message)}` : p.message ? `\n${str(p.message)}` : ""}`}</Code>);
  if (issue.rule === "upload_failing") tech.push(<Code key="u">{`${str(p.code)}\n${str(p.message)}`}</Code>);
  if (issue.rule === "whatsapp_down" && p.reason) tech.push(<Code key="w">{str(p.reason)}</Code>);

  const settingsLink = ["carrier", "shop", "meta", "whatsapp"].some((s) => issue.system.startsWith(s));
  return (
    <Panel
      open
      onClose={onClose}
      title={d.title}
      sub={
        <>
          <Pill sev={sevOf(issue)}>
            {issue.status === "muted" && issue.muted_until
              ? t("common.mutedUntil", { date: f.date(issue.muted_until) })
              : issue.severity === "critical"
                ? t("common.toFix")
                : t("common.toCheck")}
          </Pill>
          <span>{[issue.market ? marketName(issue.market, f) : null, t("common.since", { date: f.date(issue.first_seen) })].filter(Boolean).join(" · ")}</span>
        </>
      }
      footer={
        <>
          {issue.status === "open" && (
            <Btn quiet onClick={mute} disabled={busy}>
              {t("common.mute")}
            </Btn>
          )}
          <span className="flex-1" />
          {settingsLink && (
            <Btn href={`/${locale}/system/settings`}>
              <ExternalLink aria-hidden />
              {t("common.openSettings")}
            </Btn>
          )}
          {issue.system.startsWith("carrier:") && (
            <Btn onClick={() => onOpen({ type: "tile", id: issue.system })}>{describeTileName(issue.system, overview, t, f)}</Btn>
          )}
        </>
      }
    >
      <H4>{t("common.what")}</H4>
      <P>{what}</P>
      <H4>{t("common.howMuch")}</H4>
      <Figures items={figures} />
      {issue.rule === "carrier_stuck" && Array.isArray(p.causes) && (p.causes as unknown[]).length > 0 && (
        <>
          <H4>{t(`${k}.causes`)}</H4>
          <MiniTable
            rows={(p.causes as { reason: string; parcels: number; amount: number | null }[]).map((c) => [
              causeLabel(c.reason, t, f),
              t(`${k}.parcels`, { n: Number(c.parcels) }),
              c.amount != null ? f.money(c.amount, issue.currency) : "—",
            ])}
          />
        </>
      )}
      {todo.length > 0 && (
        <>
          <H4>{t("common.todo")}</H4>
          <Steps items={todo} />
          {!SAYS_IT_CLOSES.has(issue.rule) && <P small>{t("common.selfHeal")}</P>}
        </>
      )}
      {tech.length > 0 && <Tech>{tech}</Tech>}
    </Panel>
  );
}

function describeTileName(id: string, overview: Overview | undefined, t: Tr, f: Fmt): string {
  const tile = overview?.systems.find((s) => s.id === id);
  return tile ? describeTile(tile, t, f).name : id;
}

/* ── a system ── */

function TilePanel({ id, overview, onClose, onOpen, t, f }: Props & { id: string }) {
  const locale = useLocale();
  const tile = overview?.systems.find((s) => s.id === id);
  if (!tile) {
    return (
      <Panel open onClose={onClose} title={t("common.notFound")}>
        <span />
      </Panel>
    );
  }
  const d = describeTile(tile, t, f);
  const linked = (overview?.issues ?? []).filter((i) => tile.issue_ids.includes(i.id));
  return (
    <Panel
      open
      onClose={onClose}
      title={d.name}
      sub={
        <>
          <Pill sev={tile.state as Sev}>{d.state}</Pill>
          <span>{d.where}</span>
        </>
      }
      footer={
        tile.id !== "shops" ? (
          <>
            <span className="flex-1" />
            <Btn href={`/${locale}/system/settings`}>
              <ExternalLink aria-hidden />
              {t("common.openSettings")}
            </Btn>
          </>
        ) : undefined
      }
    >
      {tile.bars && (
        <>
          <H4>{t("bars.title")}</H4>
          <HourBars bars={tile.bars} />
        </>
      )}
      <H4>{t("common.lastActivity")}</H4>
      <P>{d.last}</P>
      {linked.map((i) => (
        <p key={i.id} className="mt-[18px]">
          <Btn onClick={() => onOpen({ type: "issue", id: i.id })}>{describeIssue(i, t, f).title}</Btn>
        </p>
      ))}
    </Panel>
  );
}

/* ── the scheduled jobs ── */

function JobsPanel({ overview, onClose, onOpen, t, f }: Props) {
  const jobs = overview?.jobs ?? [];
  const failing = jobs.filter((j) => j.state === "fail").length;
  return (
    <Panel
      open
      onClose={onClose}
      title={t("tiles.names.jobs")}
      sub={
        failing > 0 ? (
          <>
            <Pill sev="fail">{t("tiles.state.jobsFail", { n: failing })}</Pill>
            <span>{t("tiles.last.jobs", { ok: jobs.length - failing, total: jobs.length })}</span>
          </>
        ) : (
          <Pill sev="ok">{t("tiles.state.jobsOk")}</Pill>
        )
      }
    >
      <P small>{t("jobs.intro")}</P>
      <div>
        {jobs.map((j) => {
          const changed = j.result && j.result.changed != null ? Number(j.result.changed) : null;
          const pill =
            j.state === "fail" ? (
              <Pill sev="fail">{t("jobs.result.fail")}</Pill>
            ) : j.state === "warn" ? (
              <Pill sev="warn">{t("jobs.result.warn")}</Pill>
            ) : j.state === "mute" ? (
              <Pill sev="mute">{t("jobs.result.never")}</Pill>
            ) : changed === 0 ? (
              <Pill sev="mute">{t("jobs.result.changed", { n: 0 })}</Pill>
            ) : (
              <Pill sev="ok">{changed != null ? t("jobs.result.changed", { n: changed }) : t("jobs.result.ok")}</Pill>
            );
          const body = (
            <>
              <span className="min-w-0 text-start">
                <b className="block text-[14px] font-semibold text-ink-primary">{jobLabel(j.job, t)}</b>
                <small className="text-[12.5px] text-ink-secondary">
                  {[scheduleLabel(j.schedule, t, f), j.last_at ? f.relative(j.last_at) : null].filter(Boolean).join(" · ")}
                </small>
              </span>
              {pill}
            </>
          );
          return j.issue_id ? (
            <button
              key={j.job}
              type="button"
              onClick={() => onOpen({ type: "issue", id: j.issue_id! })}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-[12px] border-b border-line-subtle py-[11px] last:border-b-0 hover:bg-[#F7F7F8]"
            >
              {body}
            </button>
          ) : (
            <div key={j.job} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[12px] border-b border-line-subtle py-[11px] last:border-b-0">
              {body}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ── Ordra itself ── */

function AppPanel({ overview, onClose, onOpen, t, f }: Props) {
  const tile = overview?.systems.find((s) => s.id === "app");
  const sec = overview?.security;
  const repeated = (overview?.issues ?? []).filter((i) => i.rule === "server_error" && i.status === "open");
  const d = tile ? describeTile(tile, t, f) : null;
  return (
    <Panel open onClose={onClose} title={t("app.title")} sub={d && tile ? <Pill sev={tile.state as Sev}>{d.state}</Pill> : undefined}>
      <H4>{t("app.repeated")}</H4>
      {repeated.length === 0 ? (
        <P small>{t("app.none")}</P>
      ) : (
        <MiniTable
          rows={repeated.map((i) => [
            `${areaOf(i.params.route, t)} : ${verbOf(i.params.method, t)}`,
            <span key="n" className="font-semibold text-[var(--jx-fail-ink)]">
              {t("common.times", { n: Number(i.affected ?? 0) })}
            </span>,
            <Btn key="b" onClick={() => onOpen({ type: "issue", id: i.id })}>
              {t("app.see")}
            </Btn>,
          ])}
        />
      )}
      <H4>{t("app.security")}</H4>
      <MiniTable
        rows={[
          [t("app.logins"), f.num(sec?.logins ?? 0)],
          [t("app.failures"), f.num(sec?.login_failures ?? 0)],
          [t("app.exports"), f.num(sec?.exports ?? 0)],
          [t("app.roles"), f.num(sec?.role_changes ?? 0)],
          [t("app.errors"), f.num(sec?.errors ?? 0)],
        ]}
      />
    </Panel>
  );
}

/* ── one feed line ── */

interface Detail {
  type: "audit" | "error" | "call" | "webhook" | "settings";
  row?: Record<string, unknown>;
  rows?: { key: string; old_value: unknown; new_value: unknown }[];
}

function ItemPanel({ item, overview, onClose, onOpen, t, f }: Props & { item: FeedItem }) {
  const locale = useLocale();
  const ref = item.ref ?? "";
  const kind = ref.split(":")[0];

  // Refs that are another panel.
  useEffect(() => {
    if (item.count > 1 && kind === "order") return;
    if (kind === "order") onOpen({ type: "trace", orderId: ref.slice(6) });
    else if (kind === "issue") onOpen({ type: "issue", id: ref.slice(6), fallback: issueFromFeed(item) });
    else if (ref === "jobs") onOpen({ type: "jobs" });
    else if (["carrier", "shop", "meta"].includes(kind) && overview?.systems.some((s) => s.id === ref)) onOpen({ type: "tile", id: ref });
  }, [item, kind, ref, overview, onOpen]);

  const fetchable = ["audit", "settings", "error", "call", "webhook"].includes(kind) && item.count === 1;
  const detail = useSWR<Detail>(fetchable ? `/api/admin/journal/detail?ref=${encodeURIComponent(ref)}` : null, fetcher);
  const line = describeFeed(item, t, f);
  const sub = <span>{[f.dateTime(item.at), item.order_ref].filter(Boolean).join(" · ")}</span>;
  const orderFooter = item.order_id ? (
    <>
      <span className="flex-1" />
      <Btn onClick={() => onOpen({ type: "trace", orderId: item.order_id! })}>{t("common.seeOrder")}</Btn>
      <Btn primary href={`/${locale}/orders/${item.order_id}`}>
        {t("common.openOrder")}
      </Btn>
    </>
  ) : undefined;

  // A series: list its lines, each one opening its own story.
  if (item.count > 1) {
    return (
      <Panel open onClose={onClose} title={line.title} sub={<span>{line.sub ?? f.dateTime(item.at)}</span>}>
        <H4>{t("detail.members")}</H4>
        <div>
          {item.members.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={!m.order_id}
              onClick={() => m.order_id && onOpen({ type: "trace", orderId: m.order_id })}
              className="grid w-full grid-cols-[56px_minmax(0,1fr)] items-center gap-[8px] border-b border-line-subtle py-[9px] text-start text-[14px] last:border-b-0 enabled:hover:bg-[#F7F7F8]"
            >
              <span className="tabular-nums text-ink-muted">{f.time(m.at)}</span>
              <span>{describeFeed({ ...m, count: 1, since: m.at, members: [m] }, t, f).title}</span>
            </button>
          ))}
        </div>
      </Panel>
    );
  }

  if (!fetchable) {
    return (
      <Panel open onClose={onClose} title={line.title} sub={sub} footer={orderFooter}>
        <P small>{line.sub ?? t("detail.nothing")}</P>
      </Panel>
    );
  }

  const row = detail.data?.row ?? {};
  const s = (v: unknown) => (v == null ? "" : String(v));
  let body: ReactNode = <P small>{detail.error ? t("common.notFound") : t("common.loading")}</P>;
  let title: string = line.title;
  let pill: ReactNode = null;

  if (detail.data?.type === "audit") {
    const changes = (row.changes as Record<string, [unknown, unknown]> | undefined) ?? {};
    body = (
      <>
        <H4>{t("detail.changes")}</H4>
        <ChangeTable
          head={t("detail.field")}
          rows={Object.entries(changes).map(([k, [b, a]]) => ({ label: fieldLabel(k, t), before: b, after: a }))}
          t={t}
          f={f}
        />
        {!Object.keys(changes).length && <P small>{t("detail.nothing")}</P>}
      </>
    );
  } else if (detail.data?.type === "settings") {
    body = (
      <>
        <H4>{t("detail.changes")}</H4>
        <ChangeTable
          head={t("detail.setting")}
          rows={(detail.data.rows ?? []).map((r) => ({ label: settingLabel(r.key, t), before: r.old_value, after: r.new_value }))}
          t={t}
          f={f}
        />
        {linkedIssue(item, overview) && (
          <Callout>
            {t("detail.linked")}{" "}
            <button type="button" className="font-semibold underline" onClick={() => onOpen({ type: "issue", id: linkedIssue(item, overview)!.id })}>
              {t("common.seeProblem")}
            </button>
          </Callout>
        )}
      </>
    );
  } else if (detail.data?.type === "call") {
    title = describeFeed(item, t, f).title;
    pill = <Pill sev="fail">{t("common.failed")}</Pill>;
    body = (
      <>
        <H4>{t("common.whatHappened")}</H4>
        <P>{t("detail.uploadWhat")}</P>
        <H4>{t("detail.reason")}</H4>
        <P>{s(row.message) || "—"}</P>
        <H4>{t("common.todo")}</H4>
        <Steps items={[t("detail.uploadTodo")]} />
        <Tech>
          <MiniTable
            rows={[
              [t("detail.code"), <span key="c" className="font-mono" dir="ltr">{s(row.error_code) || "—"}</span>],
              [t("detail.duration"), row.duration_ms != null ? `${f.num(Number(row.duration_ms) / 1000)} s` : "—"],
              [t("detail.attempt"), s(row.attempt) || "1"],
            ]}
          />
        </Tech>
      </>
    );
  } else if (detail.data?.type === "error") {
    pill = <Pill sev="fail">{t("common.failed")}</Pill>;
    body = (
      <>
        <H4>{t("common.whatHappened")}</H4>
        <P>{t("detail.errorWhat")}</P>
        <Tech>
          <Code>{`${s(row.method)} ${s(row.route)}  →  ${s(row.status)}${row.error_code ? `\n${s(row.error_code)}` : ""}${row.message ? `\n${s(row.message)}` : ""}`}</Code>
        </Tech>
      </>
    );
  } else if (detail.data?.type === "webhook") {
    pill = <Pill sev="fail">{t("common.failed")}</Pill>;
    body = (
      <>
        <H4>{t("common.whatHappened")}</H4>
        <P>{t("detail.webhookWhat")}</P>
        <H4>{t("detail.message")}</H4>
        <P>{s(row.error_message) || "—"}</P>
        {row.status === "error" && <ReplayButton id={s(row.id)} t={t} onDone={onClose} />}
      </>
    );
  }

  return (
    <Panel
      open
      onClose={onClose}
      title={title}
      sub={
        <>
          {pill}
          {sub}
        </>
      }
      footer={orderFooter ?? (s(row.order_id) ? undefined : undefined)}
    >
      {body}
      {detail.data?.type === "call" && s(row.order_id) && !item.order_id && (
        <p className="mt-[18px]">
          <Btn primary href={`/${locale}/orders/${s(row.order_id)}`}>
            {t("common.openOrder")}
          </Btn>
        </p>
      )}
    </Panel>
  );
}

/** « Relancer le traitement » — the existing webhook replay (failed deliveries only). */
function ReplayButton({ id, t, onDone }: { id: string; t: Tr; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const replay = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/webhook-logs/${id}/replay`, { method: "POST" }).catch(() => null);
    setBusy(false);
    toast.show(res?.ok ? { tone: "info", message: t("detail.replayDone") } : { tone: "critical", message: t("detail.replayFailed") });
    if (res?.ok) onDone();
  };
  return (
    <p className="mt-[18px]">
      <Btn primary onClick={replay} disabled={busy}>
        {t("detail.replay")}
      </Btn>
    </p>
  );
}

/** A settings batch that touched the key an open archiving problem reads. */
function linkedIssue(item: FeedItem, overview: Overview | undefined): Issue | undefined {
  const keys = (item.params?.keys as string[] | undefined) ?? [];
  if (!keys.includes("auto_archive_after_days")) return undefined;
  return overview?.issues.find((i) => i.rule === "job_failing" && i.params.job === "auto-archive-finished-orders");
}

function ChangeTable({
  head,
  rows,
  t,
  f,
}: {
  head: string;
  rows: { label: string; before: unknown; after: unknown }[];
  t: Tr;
  f: Fmt;
}) {
  const show = (v: unknown) => {
    if (v == null) return t("detail.empty");
    if (v === "••••") return t("detail.secret");
    if (typeof v === "number") return f.num(v);
    if (typeof v === "boolean") return v ? "✓" : "✕";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  if (!rows.length) return null;
  return (
    <table className="w-full border-collapse text-[13.5px]">
      <thead>
        <tr>
          <th className="pb-[6px] text-start text-[12px] font-semibold text-ink-secondary">{head}</th>
          <th className="pb-[6px] ps-[14px] text-start text-[12px] font-semibold text-ink-secondary">{t("detail.before")}</th>
          <th className="pb-[6px] ps-[14px] text-start text-[12px] font-semibold text-ink-secondary">{t("detail.after")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="border-t border-line-subtle py-[9px] align-top">{r.label}</td>
            <td className="border-t border-line-subtle py-[9px] ps-[14px] align-top text-ink-secondary line-through decoration-[#C5CBD3]">
              <span className="break-all">{show(r.before)}</span>
            </td>
            <td className="border-t border-line-subtle py-[9px] ps-[14px] align-top font-semibold">
              <span className="break-all">{show(r.after)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── « Retrouver une commande » ── */

function TracePanel({ orderId, onClose, t, f }: Props & { orderId?: string }) {
  const locale = useLocale();
  const [q, setQ] = useState("");
  const [key, setKey] = useState<string | null>(orderId ? `/api/admin/journal/trace?order_id=${orderId}` : null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!orderId) input.current?.focus();
  }, [orderId]);
  useEffect(() => {
    if (orderId) setKey(`/api/admin/journal/trace?order_id=${orderId}`);
  }, [orderId]);

  const res = useSWR<{ matches: OrderMatch[]; trace: Trace | null }>(key, fetcher);
  const trace = res.data?.trace ?? null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (v.length >= 3) setKey(`/api/admin/journal/trace?q=${encodeURIComponent(v)}`);
  };

  const o = trace?.order;
  return (
    <Panel
      open
      onClose={onClose}
      wide
      title={o ? t("trace.order", { ref: o.ref ?? "—" }) : t("trace.title")}
      sub={
        o ? (
          <>
            <Pill sev={o.status === "delivered" ? "ok" : ["rejected", "cancelled", "returned", "deleted"].includes(o.status) ? "mute" : "warn"}>{f.status(o.status)}</Pill>
            <span>{[marketName(o.market, f), o.shop, o.amount != null ? f.money(o.amount, o.currency) : null, o.city].filter(Boolean).join(" · ")}</span>
          </>
        ) : undefined
      }
      footer={
        o ? (
          <>
            <span className="flex-1" />
            <Btn primary href={`/${locale}/orders/${o.id}`}>
              {t("common.openOrder")}
            </Btn>
          </>
        ) : undefined
      }
    >
      {!orderId && (
        <form role="search" onSubmit={submit} className="mt-[4px] flex gap-[8px]">
          <label className="flex h-[40px] flex-1 items-center gap-[9px] rounded-[10px] border border-[#D2D5D9] bg-white px-[12px] focus-within:border-brand">
            <Search className="h-[16px] w-[16px] text-ink-secondary" aria-hidden />
            <input
              ref={input}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("trace.placeholder")}
              aria-label={t("trace.placeholder")}
              className="h-full flex-1 bg-transparent text-[14px]"
              style={{ outline: "none" }}
            />
          </label>
          <Btn primary onClick={() => q.trim().length >= 3 && setKey(`/api/admin/journal/trace?q=${encodeURIComponent(q.trim())}`)}>
            {t("trace.search")}
          </Btn>
        </form>
      )}

      {key && !res.data && !res.error && <P small>{t("common.loading")}</P>}
      {res.data && !trace && res.data.matches.length === 0 && <p className="mt-[18px] text-[14px] text-ink-secondary">{t("trace.none")}</p>}
      {res.data && !trace && res.data.matches.length > 1 && (
        <>
          <H4>{t("trace.several")}</H4>
          {res.data.matches.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setKey(`/api/admin/journal/trace?order_id=${m.id}`)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-[12px] border-b border-line-subtle py-[10px] text-start last:border-b-0 hover:bg-[#F7F7F8]"
            >
              <span className="font-semibold">{t("trace.order", { ref: m.ref ?? "—" })}</span>
              <span className="text-[13px] text-ink-secondary">{[marketName(m.market, f), f.status(m.status), f.date(m.created_at)].join(" · ")}</span>
            </button>
          ))}
        </>
      )}

      {trace && (
        <>
          <ul className="m-0 mt-[16px] list-none p-0">
            {[
              { at: trace.order.created_at, seq: 0, kind: "order.received", actor: null, actor_type: "system", params: {} },
              ...trace.events.filter((e) => e.kind !== "order.received"),
            ]
              .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.seq - b.seq)
              .map((ev, i, all) => {
              const line = describeTraceEvent(ev, trace.order, t, f);
              const good = /delivered|confirmed|uploaded|scanned|received/.test(String(ev.params?.to ?? "")) || ev.kind === "order.received";
              return (
                <li key={i} className="relative grid grid-cols-[112px_18px_minmax(0,1fr)] gap-[12px] pb-[18px]">
                  {i < all.length - 1 && <span aria-hidden className="absolute bottom-0 top-[16px] w-[2px] bg-line-subtle ltr:left-[132px] rtl:right-[132px]" />}
                  <span className="pt-[1px] text-end text-[13px] tabular-nums text-ink-secondary">{f.dateTime(ev.at)}</span>
                  <span
                    aria-hidden
                    className={`relative z-[1] ms-[2px] mt-[3px] h-[14px] w-[14px] rounded-full border-2 ${good ? "border-[var(--jx-ok)] bg-[var(--jx-ok)]" : "border-[#B6BBC1] bg-white"}`}
                  />
                  <div className="text-[14.5px] leading-[1.45]">
                    {line.title}
                    {line.sub && <small className="mt-[1px] block text-[13px] text-ink-secondary">{line.sub}</small>}
                  </div>
                </li>
              );
            })}
          </ul>
          <Tech>
            <P small>{t("trace.sources")}</P>
          </Tech>
        </>
      )}
    </Panel>
  );
}

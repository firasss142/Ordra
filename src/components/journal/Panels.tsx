"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import useSWR from "swr";
import { useLocale } from "next-intl";
import { ExternalLink, Search } from "lucide-react";
import { issueArea, rowArea } from "@/lib/journal/areas";
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
  whyOf,
  type Tr,
} from "./describe";
import type { Fmt } from "./format";
import { Avatar, Block, Btn, Callout, Code, FamilyIcon, Figures, HourBars, MiniTable, P, Panel, Pill, Steps, Tech, type Sev } from "./parts";

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
const SAYS_IT_CLOSES = new Set(["job_failing", "connection_silent", "carrier_stuck", "server_error", "external_failing", "browser_error", "job_hanging"]);

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
        <Block>
          <P>{t("common.selfHeal")}</P>
        </Block>
      </Panel>
    );
  }
  const d = describeIssue(issue, t, f);
  const p = issue.params ?? {};
  const k = `rules.${issue.rule}`;
  const str = (v: unknown) => (v == null ? "" : String(v));
  // Rules explained by a recorded cause (server, outside service, browser):
  // « Pourquoi » comes from the cause, and its fix is the first thing to do.
  const why = whyOf(issue, t);
  const todo = [
    ...(why ? [why.fix] : []),
    ...["todo1", "todo2", "todo3"].filter((s) => t.has(`${k}.${s}`)).map((s) => t(`${k}.${s}`)),
  ];

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
  if ((issue.rule === "server_error" || issue.rule === "browser_error") && p.cause_kind)
    tech.push(
      <Code key="c">{[`${str(p.cause_kind)} · ${str(p.cause_code)}${p.cause_target ? ` · ${str(p.cause_target)}` : ""}`, str(p.cause_detail)].filter(Boolean).join("\n")}</Code>,
    );
  if (issue.rule === "browser_error") tech.push(<Code key="b">{`${str(p.page)}\n${str(p.message)}`}</Code>);
  if (issue.rule === "external_failing")
    tech.push(<Code key="x">{`${str(p.system)} · ${str(p.operation)} → ${str(p.http_status ?? p.code)}\n${str(p.message)}`}</Code>);
  if (issue.rule === "upload_failing") tech.push(<Code key="u">{`${str(p.code)}\n${str(p.message)}`}</Code>);
  if (issue.rule === "whatsapp_down" && p.reason) tech.push(<Code key="w">{str(p.reason)}</Code>);

  const settingsLink = ["carrier", "shop", "meta", "whatsapp"].some((s) => issue.system.startsWith(s));
  const area = issueArea(issue, overview?.systems ?? []);
  return (
    <Panel
      open
      onClose={onClose}
      icon={<FamilyIcon family={area} />}
      eyebrow={
        <>
          <Pill sev={sevOf(issue)}>
            {issue.status === "muted" && issue.muted_until
              ? t("common.mutedUntil", { date: f.date(issue.muted_until) })
              : issue.severity === "critical"
                ? t("v3.state.toFix")
                : t("v3.state.toWatch")}
          </Pill>
          {t(`v3.areas.${area}`)}
        </>
      }
      title={d.title}
      sub={<span>{[issue.market ? marketName(issue.market, f) : null, t("common.since", { date: f.date(issue.first_seen) })].filter(Boolean).join(" · ")}</span>}
      footer={
        <>
          {issue.status === "open" && (
            <Btn quiet onClick={mute} disabled={busy}>
              {t("common.mute")}
            </Btn>
          )}
          <span className="sp" />
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
      <Block title={t("common.what")}>
        <P>{what}</P>
      </Block>
      {why && (
        <Block title={t("explain.why")}>
          <P>{why.why}</P>
        </Block>
      )}
      <Block title={t("common.howMuch")}>
        <Figures items={figures} />
      </Block>
      {issue.rule === "carrier_stuck" && Array.isArray(p.causes) && (p.causes as unknown[]).length > 0 && (
        <Block title={t(`${k}.causes`)}>
          <MiniTable
            rows={(p.causes as { reason: string; parcels: number; amount: number | null }[]).map((c) => [
              causeLabel(c.reason, t, f),
              t(`${k}.parcels`, { n: Number(c.parcels) }),
              c.amount != null ? f.money(c.amount, issue.currency) : "—",
            ])}
          />
        </Block>
      )}
      {todo.length > 0 && (
        <Block title={t("common.todo")}>
          <Steps items={todo} />
          {!SAYS_IT_CLOSES.has(issue.rule) && <p style={{ marginTop: 10 }}>{t("common.selfHeal")}</p>}
        </Block>
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
      icon={<FamilyIcon family={tile.family} />}
      eyebrow={
        <>
          <Pill sev={tile.state as Sev}>{d.state}</Pill>
          {t(`v3.areas.${tile.family}`)}
        </>
      }
      title={d.name}
      sub={<span>{d.where}</span>}
      footer={
        tile.id !== "shops" ? (
          <>
            <span className="sp" />
            <Btn href={`/${locale}/system/settings`}>
              <ExternalLink aria-hidden />
              {t("common.openSettings")}
            </Btn>
          </>
        ) : undefined
      }
    >
      {tile.bars && (
        <Block title={t("bars.title")}>
          <HourBars bars={tile.bars} />
        </Block>
      )}
      <Block title={t("common.lastActivity")}>
        <P strong>{d.last}</P>
      </Block>
      {linked.length > 0 && (
        <Block title={t("common.seeProblem")}>
          <div className="plist">
            {linked.map((i) => (
              <button key={i.id} type="button" onClick={() => onOpen({ type: "issue", id: i.id })}>
                <span>
                  <b>{describeIssue(i, t, f).title}</b>
                  <small>{describeIssue(i, t, f).line}</small>
                </span>
                <Pill sev={sevOf(i)}>{i.severity === "critical" ? t("v3.state.toFix") : t("v3.state.toWatch")}</Pill>
              </button>
            ))}
          </div>
        </Block>
      )}
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
      icon={<FamilyIcon family="auto" />}
      eyebrow={t("v3.areas.auto")}
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
      <Block>
        <P>{t("jobs.intro")}</P>
      </Block>
      <Block>
      <div className="plist">
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
              <span className="min-w-0">
                <b>{jobLabel(j.job, t)}</b>
                <small>
                  {[scheduleLabel(j.schedule, t, f), j.last_at ? f.relative(j.last_at) : null].filter(Boolean).join(" · ")}
                </small>
              </span>
              {pill}
            </>
          );
          return j.issue_id ? (
            <button key={j.job} type="button" onClick={() => onOpen({ type: "issue", id: j.issue_id! })}>
              {body}
            </button>
          ) : (
            <div key={j.job}>{body}</div>
          );
        })}
      </div>
      </Block>
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
    <Panel
      open
      onClose={onClose}
      icon={<FamilyIcon family="app" />}
      eyebrow={
        <>
          {d && tile ? <Pill sev={tile.state as Sev}>{d.state}</Pill> : null}
          {t("v3.areas.app")}
        </>
      }
      title={t("app.title")}
    >
      <Block title={t("app.repeated")}>
      {repeated.length === 0 ? (
        <P>{t("app.none")}</P>
      ) : (
        <MiniTable
          rows={repeated.map((i) => [
            `${areaOf(i.params.route, t)} : ${verbOf(i.params.method, t)}`,
            <span key="n" style={{ color: "var(--bad)", fontWeight: 700 }}>
              {t("common.times", { n: Number(i.affected ?? 0) })}
            </span>,
            <Btn key="b" onClick={() => onOpen({ type: "issue", id: i.id })}>
              {t("app.see")}
            </Btn>,
          ])}
        />
      )}
      </Block>
      <Block title={t("app.security")}>
      <MiniTable
        rows={[
          [t("app.logins"), f.num(sec?.logins ?? 0)],
          [t("app.failures"), f.num(sec?.login_failures ?? 0)],
          [t("app.exports"), f.num(sec?.exports ?? 0)],
          [t("app.roles"), f.num(sec?.role_changes ?? 0)],
          [t("app.errors"), f.num(sec?.errors ?? 0)],
        ]}
      />
      </Block>
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
  const area = rowArea(item);
  const person = item.family === "team" || (!!item.actor_name && item.family === "sec");
  const head = {
    icon: person ? <Avatar name={item.actor_name} seed={item.actor_id} unknown={!item.actor_id && !item.actor_name} large /> : <FamilyIcon family={area} />,
    eyebrow: <>{t(`v3.areas.${area}`)}</>,
  };
  const orderFooter = item.order_id ? (
    <>
      <span className="sp" />
      <Btn onClick={() => onOpen({ type: "trace", orderId: item.order_id! })}>{t("common.seeOrder")}</Btn>
      <Btn primary href={`/${locale}/orders/${item.order_id}`}>
        {t("common.openOrder")}
      </Btn>
    </>
  ) : undefined;

  // A series: list its lines, each one opening its own story.
  if (item.count > 1) {
    return (
      <Panel open onClose={onClose} {...head} title={line.title} sub={<span>{line.sub ?? f.dateTime(item.at)}</span>}>
        <Block title={t("detail.members")}>
          <div className="plist">
            {item.members.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={!m.order_id}
                onClick={() => m.order_id && onOpen({ type: "trace", orderId: m.order_id })}
                style={{ gridTemplateColumns: "56px minmax(0,1fr)" }}
              >
                <span className="time">{f.time(m.at)}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{describeFeed({ ...m, count: 1, since: m.at, members: [m] }, t, f).title}</span>
              </button>
            ))}
          </div>
        </Block>
      </Panel>
    );
  }

  if (!fetchable) {
    return (
      <Panel open onClose={onClose} {...head} title={line.title} sub={sub} footer={orderFooter}>
        <Block>
          <P>{line.sub ?? t("detail.nothing")}</P>
        </Block>
      </Panel>
    );
  }

  const row = detail.data?.row ?? {};
  const s = (v: unknown) => (v == null ? "" : String(v));
  let body: ReactNode = (
    <Block>
      <P>{detail.error ? t("common.notFound") : t("common.loading")}</P>
    </Block>
  );
  let title: string = line.title;
  let pill: ReactNode = null;

  if (detail.data?.type === "audit") {
    const changes = (row.changes as Record<string, [unknown, unknown]> | undefined) ?? {};
    body = (
      <Block title={t("detail.changes")}>
        <ChangeTable
          head={t("detail.field")}
          rows={Object.entries(changes).map(([k, [b, a]]) => ({ label: fieldLabel(k, t), before: b, after: a }))}
          t={t}
          f={f}
        />
        {!Object.keys(changes).length && <P>{t("detail.nothing")}</P>}
      </Block>
    );
  } else if (detail.data?.type === "settings") {
    body = (
      <>
        <Block title={t("detail.changes")}>
        <ChangeTable
          head={t("detail.setting")}
          rows={(detail.data.rows ?? []).map((r) => ({ label: settingLabel(r.key, t), before: r.old_value, after: r.new_value }))}
          t={t}
          f={f}
        />
        </Block>
        {linkedIssue(item, overview) && (
          <Callout>
            {t("detail.linked")}{" "}
            <button type="button" style={{ fontWeight: 700, textDecoration: "underline" }} onClick={() => onOpen({ type: "issue", id: linkedIssue(item, overview)!.id })}>
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
        <Block title={t("common.whatHappened")}>
          <P>{t("detail.uploadWhat")}</P>
        </Block>
        <Block title={t("detail.reason")}>
          <P strong>{s(row.message) || "—"}</P>
        </Block>
        <Block title={t("common.todo")}>
          <Steps items={[t("detail.uploadTodo")]} />
        </Block>
        <Tech>
          <MiniTable
            rows={[
              [t("detail.code"), <span key="c" style={{ fontFamily: "ui-monospace, Menlo, monospace" }} dir="ltr">{s(row.error_code) || "—"}</span>],
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
        <Block title={t("common.whatHappened")}>
          <P>{t("detail.errorWhat")}</P>
        </Block>
        <Tech>
          <Code>{`${s(row.method)} ${s(row.route)}  →  ${s(row.status)}${row.error_code ? `\n${s(row.error_code)}` : ""}${row.message ? `\n${s(row.message)}` : ""}`}</Code>
        </Tech>
      </>
    );
  } else if (detail.data?.type === "webhook") {
    pill = <Pill sev="fail">{t("common.failed")}</Pill>;
    body = (
      <>
        <Block title={t("common.whatHappened")}>
          <P>{t("detail.webhookWhat")}</P>
        </Block>
        <Block title={t("detail.message")}>
          <P strong>{s(row.error_message) || "—"}</P>
          {row.status === "error" && <ReplayButton id={s(row.id)} t={t} onDone={onClose} />}
        </Block>
      </>
    );
  }

  return (
    <Panel
      open
      onClose={onClose}
      icon={head.icon}
      eyebrow={
        <>
          {pill}
          {head.eyebrow}
        </>
      }
      title={title}
      sub={sub}
      footer={
        orderFooter ??
        (detail.data?.type === "call" && s(row.order_id) ? (
          <>
            <span className="sp" />
            <Btn primary href={`/${locale}/orders/${s(row.order_id)}`}>
              {t("common.openOrder")}
            </Btn>
          </>
        ) : undefined)
      }
    >
      {body}
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
    <p style={{ marginTop: 12 }}>
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
    <table className="mt ct">
      <thead>
        <tr>
          <th>{head}</th>
          <th>{t("detail.before")}</th>
          <th>{t("detail.after")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.label}</td>
            <td className="bf">{show(r.before)}</td>
            <td className="af">{show(r.after)}</td>
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
  const tone = (ev: { kind: string; params?: Record<string, unknown> | null }) => {
    const to = String(ev.params?.to ?? "");
    if (ev.kind === "order.received" || /delivered|confirmed|scanned/.test(to)) return "h-green";
    if (/rejected|cancelled|returned|deleted|failed|refused/.test(to) || /failed|refused/.test(ev.kind)) return "h-red";
    if (/uploaded|in_transit|out_for_delivery|at_carrier|dispatched|deposit/.test(to) || ev.kind.startsWith("carrier")) return "h-blue";
    if (/attempt|callback|pending/.test(to)) return "h-amber";
    if (ev.kind.startsWith("stock") || ev.kind.startsWith("label")) return "h-violet";
    return "h-neutral";
  };
  return (
    <Panel
      open
      onClose={onClose}
      wide
      icon={
        <span aria-hidden className="thumb h-neutral">
          <Search className="ic" />
        </span>
      }
      eyebrow={
        o ? (
          <>
            <Pill sev={o.status === "delivered" ? "ok" : ["rejected", "cancelled", "returned", "deleted"].includes(o.status) ? "mute" : "warn"}>{f.status(o.status)}</Pill>
            {t("trace.title")}
          </>
        ) : (
          t("trace.title")
        )
      }
      title={o ? t("trace.order", { ref: o.ref ?? "—" }) : t("v3.traceTitle")}
      sub={
        o ? (
          <span>{[marketName(o.market, f), o.shop, o.amount != null ? f.money(o.amount, o.currency) : null, o.city].filter(Boolean).join(" · ")}</span>
        ) : (
          <span>{t("trace.placeholder")}</span>
        )
      }
      footer={
        o ? (
          <>
            <span className="sp" />
            <Btn primary href={`/${locale}/orders/${o.id}`}>
              {t("common.openOrder")}
            </Btn>
          </>
        ) : undefined
      }
    >
      {!orderId && (
        <form role="search" onSubmit={submit} className="dsrch">
          <Search className="ic" aria-hidden />
          <input
            ref={input}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("trace.placeholder")}
            aria-label={t("trace.placeholder")}
          />
          <button type="submit" className="btn">
            {t("trace.search")}
          </button>
        </form>
      )}

      {key && !res.data && !res.error && (
        <Block>
          <P>{t("common.loading")}</P>
        </Block>
      )}
      {res.data && !trace && res.data.matches.length === 0 && (
        <Block>
          <P>{t("trace.none")}</P>
        </Block>
      )}
      {res.data && !trace && res.data.matches.length > 1 && (
        <Block title={t("trace.several")}>
          <div className="plist">
            {res.data.matches.map((m) => (
              <button key={m.id} type="button" onClick={() => setKey(`/api/admin/journal/trace?order_id=${m.id}`)}>
                <b>{t("trace.order", { ref: m.ref ?? "—" })}</b>
                <small>{[marketName(m.market, f), f.status(m.status), f.date(m.created_at)].join(" · ")}</small>
              </button>
            ))}
          </div>
        </Block>
      )}

      {trace && (
        <>
          <Block>
            <ol className="tl">
              {[
                { at: trace.order.created_at, seq: 0, kind: "order.received", actor: null, actor_type: "system", params: {} },
                ...trace.events.filter((e) => e.kind !== "order.received"),
              ]
                .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.seq - b.seq)
                .map((ev, i) => {
                  const line = describeTraceEvent(ev, trace.order, t, f);
                  return (
                    <li key={i} className={tone(ev)}>
                      <time>{f.dateTime(ev.at)}</time>
                      <span>{line.title}</span>
                      {line.sub && <small>{line.sub}</small>}
                    </li>
                  );
                })}
            </ol>
          </Block>
          <Tech>
            <P>{t("trace.sources")}</P>
          </Tech>
        </>
      )}
    </Panel>
  );
}

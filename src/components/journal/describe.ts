import type { FeedItem, Issue, SystemTile, TraceEvent, Trace } from "@/lib/journal/types";
import type { Fmt } from "./format";
import { explainIssue, systemName } from "@/lib/journal/explain";

/**
 * Turns journal rows (keys + params) into sentences, through the `journaux`
 * catalog. Pure: the components pass `t` and `fmt`, the tests pass a real
 * translator over fr.json.
 */
export interface Tr {
  (key: string, values?: Record<string, string | number | Date>): string;
  has(key: string): boolean;
}

export interface Line {
  title: string;
  sub?: string;
}

type P = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

/** A carrier known only by its code (no account linked) is still named. */
const CARRIER_CODES: Record<string, string> = {
  darb_assabil: "Darb Assabil",
  navex: "Navex",
  dexpress: "Dexpress",
  cosmos: "Cosmos",
  meta: "Meta",
  whatsapp: "WhatsApp",
  google_sheets: "Google Sheets",
};
export function carrierName(v: unknown): string {
  const c = s(v);
  return CARRIER_CODES[c] ?? c;
}

function pick(t: Tr, key: string, fallback: string, values: Record<string, string | number | Date>): string {
  return t(t.has(key) ? key : fallback, values);
}

function actorOf(item: { actor_name: string | null; actor_id: string | null; params: P }, t: Tr): string {
  if (item.actor_name) return item.actor_name;
  if (item.params?.kind === "service") return t("who.service");
  return item.actor_id ? t("who.unknown") : t("who.system");
}

export function fieldLabel(key: string, t: Tr): string {
  if (t.has(`fields.${key}`)) return t(`fields.${key}`);
  if (t.has(`keys.${key}`)) return t(`keys.${key}`);
  return t("fields.other");
}

export function settingLabel(key: string, t: Tr): string {
  return t.has(`keys.${key}`) ? t(`keys.${key}`) : key;
}

export function jobLabel(job: unknown, t: Tr): string {
  const k = s(job);
  return t.has(`jobs.names.${k}`) ? t(`jobs.names.${k}`) : k;
}

/** /api/agents/[id] → « Accès » ; the area of Ordra a route belongs to. */
export function areaOf(route: unknown, t: Tr): string {
  const seg = s(route).split("/").filter(Boolean)[1] ?? "other";
  return t.has(`areas.${seg}`) ? t(`areas.${seg}`) : t("areas.other");
}
export function verbOf(method: unknown, t: Tr): string {
  const m = s(method).toUpperCase();
  return t.has(`verbs.${m}`) ? t(`verbs.${m}`) : t("verbs.other");
}

/** A carrier event the journal refused, in status words. */
export function causeLabel(reason: string, t: Tr, f: Fmt): string {
  const unknown = reason.match(/^unknown_[a-z_]+:(.+)$/i);
  if (unknown) return t("rules.carrier_stuck.unknown", { raw: unknown[1].trim() });
  const tr = reason.match(/invalid transition from (\w+) to (\w+)/i);
  if (tr) return t("rules.carrier_stuck.refused", { from: f.status(tr[1]), to: f.status(tr[2]) });
  return reason;
}

function show(v: unknown, f: Fmt): string {
  if (v == null) return "—";
  if (typeof v === "number") return f.num(v);
  if (typeof v === "boolean") return v ? "✓" : "✕";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function sumOf(item: FeedItem, key: string): number {
  return item.members.reduce((acc, m) => acc + (Number((m.params ?? {})[key]) || 0), 0);
}

function auditLine(item: FeedItem, t: Tr, f: Fmt, actor: string): Line {
  const p = item.params ?? {};
  const [table, verb] = item.kind.split(".");
  const label = s(p.label) || "—";
  const entity = pick(t, `kinds.entities.${table}`, "kinds.entities.other", { label });
  const fields = (p.fields as string[] | undefined) ?? [];
  const changes = (p.changes as Record<string, [unknown, unknown]> | undefined) ?? {};
  const sub = fields.length ? fields.slice(0, 4).map((k) => fieldLabel(k, t)).join(" · ") : undefined;

  if (item.count > 1) {
    const type = pick(t, `kinds.types.${table}`, "kinds.types.other", {});
    return { title: t("kinds.audit.count", { actor, count: item.count, type }), sub };
  }
  if (verb === "updated") {
    const active = changes.is_active;
    if (active && fields.length <= 2) {
      return { title: t(active[1] === false ? "kinds.audit.deactivated" : "kinds.audit.activated", { actor, entity }), sub };
    }
    const price = changes.default_price ?? changes.display_price;
    if (price && fields.length === 1) {
      return { title: t("kinds.audit.price", { actor, label, before: show(price[0], f), after: show(price[1], f) }) };
    }
    if (table === "users" && fields.includes("role")) return { title: t("kinds.audit.role", { actor, label }), sub };
    if (table === "users" && fields.includes("market_id")) return { title: t("kinds.audit.market", { actor, label }), sub };
    if (table === "users" && fields.includes("warehouse_id")) return { title: t("kinds.audit.warehouse", { actor, label }), sub };
  }
  return { title: pick(t, `kinds.audit.${verb}`, "kinds.audit.updated", { actor, entity }), sub };
}

export function describeFeed(item: FeedItem, t: Tr, f: Fmt): Line {
  const p = item.params ?? {};
  const actor = actorOf(item, t);
  const count = item.count;
  const ref = item.order_ref ?? "—";
  const [domain, rest] = [item.kind.split(".")[0], item.kind.split(".").slice(1).join(".")];
  const series = count > 1 && item.since !== item.at ? t("feed.series", { from: f.time(item.since), to: f.time(item.at) }) : undefined;

  switch (domain) {
    case "order": {
      if (rest === "status") {
        const to = s(p.to);
        const key = /^attempt_/.test(to) ? "attempt" : to === "uploaded" && !p.carrier ? "uploadedNoCarrier" : to;
        const title = t.has(`kinds.order.${key}`)
          ? t(`kinds.order.${key}`, { actor, count, ref, carrier: carrierName(p.carrier) || "—" })
          : t("kinds.order.other", { actor, count, ref, status: f.status(to) });
        return { title, sub: series ?? (count === 1 && p.amount != null ? f.money(p.amount, p.currency) : undefined) };
      }
      if (rest === "auto") return { title: t("kinds.order.auto", { count, ref, status: f.status(p.to) }), sub: series };
      if (rest === "edited") {
        const fields = (p.fields as string[] | undefined) ?? [];
        return { title: t("kinds.order.edited", { actor, count, ref }), sub: series ?? (fields.map((k) => fieldLabel(k, t)).join(" · ") || undefined) };
      }
      return { title: pick(t, `kinds.order.${rest}`, "kinds.order.other", { actor, count, ref, carrier: s(p.carrier) || "—", status: f.status(p.to) }), sub: series };
    }
    case "carrier": {
      if (rest === "status") {
        const to = s(p.to);
        const title = t.has(`kinds.carrier.${to}`) ? t(`kinds.carrier.${to}`, { count, ref }) : t("kinds.carrier.other", { count, ref, status: f.status(to) });
        const where = [s(p.carrier), count === 1 && p.amount != null ? f.money(p.amount, p.currency) : ""].filter(Boolean).join(" · ");
        return { title, sub: series ? [s(p.carrier), series].filter(Boolean).join(" · ") : where || undefined };
      }
      const carrier = carrierName(p.carrier) || "—";
      return {
        title: pick(t, `kinds.carrier.${rest}`, "kinds.carrier.call_failed", { carrier }),
        sub: [item.actor_name, item.order_ref, s(p.message)].filter(Boolean).join(" · ") || undefined,
      };
    }
    case "delivery":
      return { title: pick(t, `kinds.delivery.${rest}`, "kinds.delivery.other", { actor, count }), sub: series ?? t("kinds.delivery.sub") };
    case "stock": {
      const change = Number(p.change ?? 0);
      const signed = `${change > 0 ? "+" : ""}${f.num(change)}`;
      const title = pick(t, `kinds.stock.${rest}`, "kinds.stock.other", { actor, count, product: s(p.product) || "—" });
      const parts = [s(p.site), p.balance != null ? t("kinds.stock.sub", { change: signed, balance: f.num(p.balance) }) : signed];
      return { title, sub: series ?? (parts.filter(Boolean).join(" · ") || undefined) };
    }
    case "lead":
      return { title: t("kinds.lead.status", { actor, count }), sub: series ?? t("kinds.lead.sub", { status: s(p.to) || "—" }) };
    case "feedback":
      return {
        title: rest === "created" || rest === "deleted" ? t(`kinds.feedback.${rest}`, { actor, count }) : t("kinds.feedback.other", { actor, count }),
        sub: series ?? t("kinds.feedback.sub"),
      };
    case "settings": {
      const keys = (p.keys as string[] | undefined) ?? [];
      return {
        title: t("kinds.settings.changed", { actor, n: Number(p.count ?? 1), market: s(p.market) || "other" }),
        sub: keys.slice(0, 3).map((k) => settingLabel(k, t)).join(" · ") || undefined,
      };
    }
    case "user":
      return { title: pick(t, `kinds.user.${rest}`, "kinds.user.other", { actor, target: s(p.target) || "—" }), sub: t("kinds.user.sub") };
    case "auth":
      return { title: pick(t, `kinds.auth.${rest}`, "kinds.auth.login", { actor, count, label: s(p.label) || "—" }), sub: series };
    case "export": {
      const ctx = (p.context as P | undefined) ?? {};
      return { title: pick(t, `kinds.export.${rest}`, "kinds.export.orders", { actor, rows: f.num(ctx.rows ?? 0) }) };
    }
    case "whatsapp": {
      const ctx = (p.context as P | undefined) ?? {};
      return { title: t("kinds.whatsapp.campaign_sent", { actor, n: f.num(ctx.recipients ?? 0) }), sub: s(p.label) || undefined };
    }
    case "agent": {
      const self = p.self !== false;
      const title = self
        ? t(rest === "available" ? "kinds.agent.available" : "kinds.agent.unavailable", { actor })
        : t(rest === "available" ? "kinds.agent.madeAvailable" : "kinds.agent.madeUnavailable", { actor, agent: s(p.agent) || "—" });
      return { title, sub: p.released ? t("kinds.agent.released", { n: Number(p.released) }) : series };
    }
    case "commission": {
      const amount = f.money(count > 1 ? sumOf(item, "amount") : p.amount, p.currency);
      return { title: pick(t, `kinds.commission.${rest}`, "kinds.commission.accrual", { count, amount, agent: s(p.agent) || "—" }), sub: series ?? t("kinds.commission.sub") };
    }
    case "investor":
      return {
        title: t("kinds.investor.statement", { count }),
        sub: p.from && p.to ? t("kinds.investor.sub", { from: f.date(s(p.from)), to: f.date(s(p.to)) }) : undefined,
      };
    case "intake": {
      const shop = s(p.shop) || "—";
      if (rest === "imported") {
        const errored = count > 1 ? sumOf(item, "errored") : Number(p.errored ?? 0);
        return {
          title: t("kinds.intake.imported", { shop, n: count > 1 ? sumOf(item, "imported") : Number(p.imported ?? 0) }),
          sub: errored ? t("kinds.intake.errored", { n: errored }) : series,
        };
      }
      if (rest === "webhooks") return { title: t("kinds.intake.webhooks", { shop, n: count > 1 ? sumOf(item, "count") : Number(p.count ?? 0) }) };
      return { title: pick(t, `kinds.intake.${rest}`, "kinds.intake.failed", { shop }), sub: s(p.message) || undefined };
    }
    case "sync":
      return { title: t("kinds.sync.failed", { system: s(p.system) || "—" }), sub: series ?? (s(p.message) || undefined) };
    case "darb":
      return { title: t("kinds.darb.rates"), sub: p.count != null ? t("kinds.darb.ratesSub", { n: f.num(p.count) }) : undefined };
    case "job":
      return { title: t("kinds.job.failed", { job: jobLabel(p.job, t) }), sub: series ?? (s(p.message) || undefined) };
    case "app": {
      const why = p.cause_kind ? whyOf({ rule: p.source === "browser" ? "browser_error" : "server_error", params: p }, t)?.why : undefined;
      if (p.source === "browser") return { title: t("kinds.app.browser", { page: s(p.route) || "/" }), sub: why };
      return {
        title: t("kinds.app.error", { area: areaOf(p.route, t), verb: verbOf(p.method, t) }),
        sub: why ?? t("kinds.app.sub", { n: count, status: s(p.status) }),
      };
    }
    case "issue": {
      const title = describeIssue(issueFromFeed(item), t, f).title;
      return { title: t(rest === "resolved" ? "kinds.issue.resolved" : "kinds.issue.opened", { title }) };
    }
    default:
      // audit_events from the row trigger: `<table>.created|updated|deleted`
      if (["created", "updated", "deleted"].includes(rest)) return auditLine(item, t, f, actor);
      return { title: t("kinds.unknown", { kind: item.kind }) };
  }
}

/** issue.opened / issue.resolved rows carry the issue's rule and params. */
export function issueFromFeed(item: FeedItem): Issue {
  const p = item.params ?? {};
  return {
    id: s(item.ref).replace(/^issue:/, ""),
    rule: s(p.rule) as Issue["rule"],
    severity: item.severity === "warn" ? "warning" : "critical",
    system: "",
    params: (p.p as P) ?? {},
    first_seen: item.at,
    last_seen: item.at,
    affected: (p.affected as number | null) ?? null,
    amount: (p.amount as number | null) ?? null,
    currency: (p.currency as string | null) ?? null,
    status: "open",
    muted_until: null,
    market: null,
  };
}

export interface IssueText {
  title: string;
  line: string;
  /** [figure, label] — the one number on the card. */
  impact: [string, string];
}

/** « Pourquoi », in one sentence, for the rules explained by a recorded cause (explain.ts). */
export function whyOf(i: Pick<Issue, "rule" | "params">, t: Tr): { why: string; fix: string } | null {
  const e = explainIssue(i.rule, i.params ?? {});
  if (!e) return null;
  return { why: t(`explain.${e.why.key}`, e.why.params), fix: t(`explain.${e.fix.key}`, e.fix.params) };
}

export function describeIssue(i: Issue, t: Tr, f: Fmt): IssueText {
  const p = i.params ?? {};
  const n = Number(i.affected ?? 0);
  const k = `rules.${i.rule}`;
  const money = i.amount != null && i.currency ? f.money(i.amount, i.currency) : null;
  switch (i.rule) {
    case "job_failing":
      return {
        title: t(`${k}.title`, { job: jobLabel(p.job, t), n: Number(p.failures ?? n) }),
        line: t(`${k}.line`, { message: firstLine(p.message) }),
        impact: [f.num(p.failures ?? n), t(`${k}.impact`)],
      };
    case "connection_silent":
      return { title: t(`${k}.title`, { name: s(p.name) }), line: t(`${k}.line`, { last: f.relative(s(p.last) || null) }), impact: [f.relative(s(p.last) || null), t(`${k}.impact`)] };
    case "carrier_inactive":
      return {
        title: t(`${k}.title`, { name: s(p.name), n }),
        line: p.off_at ? t(`${k}.line`, { when: f.dateTime(s(p.off_at)) }) : t(`${k}.lineUnknown`),
        impact: [f.num(n), t(`${k}.impact`)],
      };
    case "carrier_stuck":
      return {
        title: t(`${k}.title`, { name: s(p.name) || s(p.carrier), n }),
        line: t(`${k}.line`),
        impact: money ? [money, t(`${k}.impact`)] : [f.num(n), t(`${k}.impactCount`)],
      };
    case "import_rows":
      return {
        title: t(`${k}.title`, { name: s(p.name), n }),
        line: t(`${k}.line`, { message: firstLine(p.message), since: f.date(i.first_seen) }),
        impact: [f.num(n), t(`${k}.impact`)],
      };
    case "upload_failing":
      return { title: t(`${k}.title`, { system: s(p.system) }), line: t(`${k}.line`, { n, message: firstLine(p.message) }), impact: [f.num(n), t(`${k}.impact`)] };
    case "whatsapp_down":
      return { title: t(`${k}.title`, { status: s(p.status) || "other" }), line: t(`${k}.line`), impact: [s(p.phone) || "—", t(`${k}.impact`)] };
    case "ads_no_orders": {
      const hours = p.last_order ? Math.max(12, Math.round((f.now.getTime() - Date.parse(s(p.last_order))) / 3_600_000)) : 12;
      return {
        title: t(`${k}.title`, { market: s(p.market).toUpperCase(), hours }),
        line: t(`${k}.line`),
        impact: [money ?? "—", t(`${k}.impact`)],
      };
    }
    case "server_error":
      return {
        title: t(`${k}.title`, { area: areaOf(p.route, t), verb: verbOf(p.method, t) }),
        // the cause, not « Internal server error » (journal v2, 2026-10-06)
        line: whyOf(i, t)?.why ?? t(`${k}.line`, { n, last: f.relative(s(p.last) || i.last_seen) }),
        impact: [f.num(n), t(`${k}.impact`)],
      };
    case "external_failing":
      return {
        title: t(`${k}.title`, { name: systemName(p.system), n }),
        line: whyOf(i, t)?.why ?? firstLine(p.message),
        impact: [f.num(n), t(`${k}.impact`)],
      };
    case "browser_error":
      return {
        title: t(`${k}.title`, { page: s(p.page) || "/" }),
        line: whyOf(i, t)?.why ?? firstLine(p.message),
        impact: [f.num(n), t(`${k}.impact`)],
      };
    case "job_hanging":
      return {
        title: t(`${k}.title`, { job: jobLabel(p.job, t) }),
        line: t(`${k}.line`, { n: Number(p.n ?? n) }),
        impact: [f.num(p.n ?? n), t(`${k}.impact`)],
      };
    case "login_failures":
      return { title: t(`${k}.title`, { n, account: s(p.account) }), line: t(`${k}.line`), impact: [f.num(n), t(`${k}.impact`)] };
    case "large_export":
      return {
        title: t(`${k}.title`, { rows: f.num(p.rows ?? n), actor: s(p.actor) || t("who.unknown") }),
        line: t(`${k}.line`),
        impact: [f.num(p.rows ?? n), t(`${k}.impact`)],
      };
    default:
      return { title: s(i.rule), line: "", impact: [f.num(n), ""] };
  }
}

function firstLine(v: unknown): string {
  const text = s(v).split("\n")[0].replace(/^ERROR:\s*/, "").trim();
  return text.length > 140 ? `${text.slice(0, 139)}…` : text || "—";
}

export interface TileText {
  name: string;
  where: string;
  state: string;
  last: string;
}

const MARKET: Record<string, string> = { ly: "Libye", tn: "Tunisie" };
const MARKET_AR: Record<string, string> = { ly: "ليبيا", tn: "تونس" };
export function marketName(code: unknown, f: Fmt): string {
  const c = s(code);
  return (f.locale === "ar" ? MARKET_AR : MARKET)[c] ?? c.toUpperCase();
}

export function describeTile(tile: SystemTile, t: Tr, f: Fmt): TileText {
  const d = tile.detail ?? {};
  const market = marketName(tile.market, f);
  const name = tile.name ?? (t.has(`tiles.names.${tile.id}`) ? t(`tiles.names.${tile.id}`) : tile.id);
  const ago = tile.last_at ? t("tiles.last.ago", { when: f.relative(tile.last_at) }) : t("tiles.last.never");
  const issueState = tile.state === "fail" ? t("tiles.state.fail") : t("tiles.state.warn");

  switch (tile.family) {
    case "carrier":
      return {
        name,
        where: t("tiles.where.carrier", { market }),
        state: tile.reason === "issue" ? issueState : t(`tiles.state.${tile.reason === "disabled" ? "disabled" : "in_service"}`),
        last: tile.reason === "disabled" || (tile.reason === "issue" && Number(d.parcels) > 0 && tile.state === "warn")
          ? t("tiles.last.parcels", { n: Number(d.parcels ?? 0) })
          : ago,
      };
    case "intake": {
      if (tile.id === "shops") {
        return {
          name: t("tiles.names.shops"),
          where: t("tiles.where.shops", { n: Number(d.count ?? 0) }),
          state: tile.reason === "issue" ? issueState : t(`tiles.state.${tile.reason === "receiving" ? "receiving" : "calm"}`),
          last: Number(d.orders_24h) > 0 ? t("tiles.last.orders24", { n: Number(d.orders_24h) }) : tile.last_at ? t("tiles.last.lastOrder", { when: f.relative(tile.last_at) }) : t("tiles.last.noOrder"),
        };
      }
      const last =
        tile.reason === "receiving"
          ? t("tiles.last.orders24", { n: Number(d.orders_24h ?? 0) })
          : tile.reason === "ads_stopped"
            ? d.ads_until
              ? t("tiles.last.adsStopped", { date: f.date(s(d.ads_until)) })
              : t("tiles.last.adsStoppedNever")
            : tile.last_at
              ? t("tiles.last.lastOrder", { when: f.relative(tile.last_at) })
              : t("tiles.last.noOrder");
      return {
        name,
        where: t("tiles.where.shop", { market }),
        state: tile.reason === "issue" ? issueState : pick(t, `tiles.state.${tile.reason}`, "tiles.state.calm", {}),
        last,
      };
    }
    case "ads":
      return {
        name,
        where: tile.market ? t("tiles.where.meta", { market }) : t("tiles.where.metaAll"),
        state: tile.reason === "issue" ? issueState : pick(t, `tiles.state.${tile.reason}`, "tiles.state.in_service", {}),
        last: ago,
      };
    case "msg":
      return {
        name,
        where: t("tiles.where.whatsapp"),
        state: tile.state === "off" ? t("tiles.state.not_connected") : tile.reason === "issue" ? issueState : t("tiles.state.in_service"),
        last: tile.state === "off" ? t("tiles.last.noNumber") : ago,
      };
    case "auto": {
      const total = Number(d.total ?? 0);
      const failing = Number(d.failing ?? 0);
      return {
        name: t("tiles.names.jobs"),
        where: t("tiles.where.jobs", { n: total }),
        state: failing > 0 ? t("tiles.state.jobsFail", { n: failing }) : t("tiles.state.jobsOk"),
        last: t("tiles.last.jobs", { ok: total - failing, total }),
      };
    }
    case "app":
    default:
      return {
        name: t("tiles.names.app"),
        where: t("tiles.where.app"),
        state: tile.state === "fail" ? t("tiles.state.appFail") : tile.state === "warn" ? t("tiles.state.appWarn") : t("tiles.state.appOk"),
        last: t("tiles.last.app", { n: Number(d.errors ?? 0) }),
      };
  }
}

/** pg_cron schedule (UTC) → words, in the reader's zone. */
export function scheduleLabel(cron: string, t: Tr, f: Fmt): string {
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/);
  if ([dom, mon, dow].some((x) => x !== "*")) return t("jobs.every.other");
  if (min === "*" && hour === "*") return t("jobs.every.minute");
  const step = min.match(/^(?:\*|\d+-\d+)\/(\d+)$/);
  if (step && hour === "*") return t("jobs.every.minutes", { n: Number(step[1]) });
  if (/^\d+$/.test(min) && hour === "*") return t("jobs.every.hour");
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    const d = new Date(Date.UTC(2026, 0, 15, Number(hour), Number(min)));
    return t("jobs.every.day", { time: f.time(d.toISOString()) });
  }
  return t("jobs.every.other");
}

export function describeTraceEvent(ev: TraceEvent, order: Trace["order"], t: Tr, f: Fmt): Line {
  const p = ev.params ?? {};
  const actor = ev.actor ?? (ev.actor_type === "system" ? t("who.system") : t("who.unknown"));
  const item: FeedItem = {
    at: ev.at,
    id: `tr:${ev.seq}`,
    family: "team",
    kind: ev.kind,
    severity: null,
    actor_id: ev.actor ? "x" : null,
    actor_name: ev.actor,
    actor_role: null,
    market_id: null,
    order_id: order.id,
    order_ref: order.ref,
    params: { ...p, carrier: order.carrier ?? undefined },
    ref: null,
    count: 1,
    since: ev.at,
    members: [],
  };
  switch (ev.kind) {
    case "order.received":
      return { title: t("trace.received", { shop: order.shop ?? "—" }), sub: s(p.note) || undefined };
    case "carrier.timeline":
      return { title: t("trace.carrierSaid", { carrier: order.carrier ?? "—", text: s(p.text) || s(p.type) }), sub: s(p.remarks) || undefined };
    case "carrier.event":
      return {
        title: t("trace.carrierRefused", { raw: s(p.raw) || s(p.reason) }),
        sub: [s(p.reason) ? causeLabel(s(p.reason), t, f) : "", p.repeats ? t("trace.repeats", { n: Number(p.repeats) }) : ""].filter(Boolean).join(" · ") || undefined,
      };
    case "carrier.upload":
      return { title: t("trace.uploadOk"), sub: actor };
    case "label.printed":
      return { title: t(p.reprint ? "trace.labelReprint" : "trace.label"), sub: actor };
    case "whatsapp.outbound":
      return { title: t("trace.whatsappOut"), sub: [actor, s(p.status)].filter(Boolean).join(" · ") };
    case "whatsapp.inbound":
      return { title: t("trace.whatsappIn") };
    default: {
      if (ev.kind === "order.status" && ev.actor_type === "system") item.kind = "order.auto";
      const line = describeFeed(item, t, f);
      return { title: line.title, sub: s(p.note) || line.sub };
    }
  }
}

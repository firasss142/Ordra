"use client";

/**
 * The manager's right panel of « Suivi livraison »: the market cockpit, shown
 * until a parcel is opened. Three tabs — the team, the couriers holding the
 * parcels, the carriers.
 *
 * The team tab is the one the owner shaped: with no agent selected it is a
 * summary of the whole market, grouped by verdict and never ranked; with an
 * agent selected it becomes that agent's page — one verdict, three frames
 * (now / today / this week), a 7-day strip and the three parcels that block.
 *
 * Design: prototypes/suivi-livraison-manager-v1.html (v3, the Équipe tab).
 * Arithmetic: src/lib/delivery/board.ts.
 */
import { useTranslations } from "next-intl";
import { AlertCircle, ChevronLeft, ChevronRight, Gauge, Moon, Phone, Truck, User, Users, CheckCircle2, RotateCcw } from "lucide-react";
import type { AgentBoard, CourierRow, CarrierRow, LoadSegment, MarketSummary, Verdict } from "@/lib/delivery/board";
import { BUCKET_TONE, formatPhone, moveFor, situationOf } from "@/lib/delivery/presentation";
import type { WorklistRow } from "@/lib/delivery/types";
import { Ltr, OUTLINE_BTN, TONE, useDuration, useSituationLabel } from "./ui";

export type CockpitTab = "team" | "couriers" | "carriers";

/** The dot beside a verdict group, and the tint of an agent's initial. */
const VERDICT_TONE: Record<Verdict, { dot: string; avatar: string; block: string; icon: typeof AlertCircle }> = {
  late: { dot: "bg-[#F59E0B]", avatar: "bg-[#FEF3C7] text-[#92400E]", block: "bg-[#FEF3C7] text-[#92400E]", icon: AlertCircle },
  idle: { dot: "bg-[#9CA3AF]", avatar: "bg-[#F3F4F6] text-[#6B7280]", block: "bg-[#F3F4F6] text-[#374151]", icon: Moon },
  ok: { dot: "bg-[#22C55E]", avatar: "bg-[#DCFCE7] text-[#15803D]", block: "bg-[#DCFCE7] text-[#15803D]", icon: CheckCircle2 },
};

const LOAD_FILL: Record<LoadSegment["bucket"], string> = {
  returning: "bg-[#EF4444]", act_now: "bg-[#F59E0B]", waiting_customer: "bg-[#3B82F6]", waiting_carrier: "bg-[#9CA3AF]",
};

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/** How an agent's live parcels split, as one thin bar. */
function LoadBar({ load, className = "" }: { load: LoadSegment[]; className?: string }) {
  const t = useTranslations("delivery");
  if (load.length === 0) return null;
  return (
    <span className={`flex h-1.5 overflow-hidden rounded-full bg-[#F3F4F6] ${className}`} aria-hidden>
      {load.map((s) => (
        <i key={s.bucket} className={`block h-full ${LOAD_FILL[s.bucket]}`} style={{ width: `${s.share}%` }}
          title={`${s.count} ${t(`board.legend.${s.bucket}`)}`} />
      ))}
    </span>
  );
}

/** The one-sentence reason under an agent's name, in their verdict's words. */
function useWhy() {
  const t = useTranslations("delivery");
  const duration = useDuration();
  return (a: AgentBoard) => {
    if (a.verdict === "late") {
      return t.rich("board.whyLate", {
        n: a.lateCount, hours: duration(a.oldestHours),
        b: (c) => <b className="font-semibold text-[#B45309]">{c}</b>,
      });
    }
    if (a.verdict === "idle") {
      return t.rich("board.whyIdle", { n: a.toTreat, b: (c) => <b className="font-semibold text-[#B45309]">{c}</b> });
    }
    return a.toTreat > 0 ? t("board.whyOk", { n: a.toTreat }) : t("board.noneLive");
  };
}

/** The all-agents summary: one line of verdicts, the market's totals, then the groups. */
function MarketView({ summary, onPickAgent }: { summary: MarketSummary; onPickAgent: (id: string) => void }) {
  const t = useTranslations("delivery");
  const why = useWhy();
  const groups: [Verdict, AgentBoard[]][] = [["late", summary.late], ["idle", summary.idle], ["ok", summary.ok]];
  const parts = [
    summary.late.length > 0 ? { k: "late", text: t("board.nLate", { n: summary.late.length }), cls: "text-[#B45309]" } : null,
    summary.idle.length > 0 ? { k: "idle", text: t("board.nIdle", { n: summary.idle.length }), cls: "text-[#6B7280]" } : null,
    summary.ok.length > 0 ? { k: "ok", text: t("board.nOk", { n: summary.ok.length }), cls: "text-[#15803D]" } : null,
  ].filter(Boolean) as { k: string; text: string; cls: string }[];

  return (
    <div>
      <p className="text-[17px] font-bold leading-snug tracking-[-0.01em] text-[#111827]">
        {parts.length === 0 ? t("board.noAgents") : parts.map((p, i) => (
          <span key={p.k}>
            {i > 0 && <span className="text-[#9CA3AF]"> · </span>}
            <b className={p.cls}>{p.text}</b>
          </span>
        ))}
      </p>
      <p className="mt-0.5 text-[13px] text-[#6B7280]">
        {t("board.marketLine", {
          toTreat: summary.toTreat, late: summary.lateParcels, saved: summary.savedWeek, lost: summary.lostWeek,
        })}
      </p>

      {groups.map(([verdict, agents]) => agents.length === 0 ? null : (
        <div key={verdict} className="mt-3">
          <div className="mb-1.5 flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
            <span aria-hidden className={`h-2 w-2 rounded-full ${VERDICT_TONE[verdict].dot}`} />
            {t(`board.groups.${verdict}`)}
            <span className="font-medium normal-case tracking-normal text-[#9CA3AF]">{agents.length}</span>
          </div>
          {agents.map((a) => (
            <button key={a.id} type="button" onClick={() => onPickAgent(a.id)}
              className="mb-1.5 grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-start hover:border-[#C9CCCF] hover:bg-[#F9FAFB]">
              <span className={`grid h-[34px] w-[34px] place-items-center rounded-full text-[13.5px] font-bold ${VERDICT_TONE[a.verdict].avatar}`} aria-hidden>
                {initial(a.name)}
              </span>
              <span className="min-w-0">
                <span className="block text-[14.5px] font-bold text-[#111827] [unicode-bidi:plaintext]">{a.name}</span>
                <span className="mt-px block text-[13px] leading-snug text-[#374151]">
                  {why(a)}
                  {a.savedWeek > 0 && <> · <b className="font-semibold text-[#15803D]">{t("board.nSaved", { n: a.savedWeek })}</b></>}
                </span>
              </span>
              <ChevronRight size={16} aria-hidden className="text-[#9CA3AF] rtl:-scale-x-100" />
              <LoadBar load={a.load} className="col-span-2 col-start-2" />
            </button>
          ))}
        </div>
      ))}

      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[#6B7280]">
        {(["returning", "act_now", "waiting_customer", "waiting_carrier"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`h-2 w-2 rounded-full ${TONE[BUCKET_TONE[k]].dot}`} />{t(`board.legend.${k}`)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One agent's page: the verdict, three frames, the week, and what blocks. */
function AgentView({
  agent, locale, now, onBack, onOpenParcel, onAbsent,
}: {
  agent: AgentBoard; locale: string; now: number;
  onBack: () => void; onOpenParcel: (row: WorklistRow) => void; onAbsent: (agent: AgentBoard) => void;
}) {
  const t = useTranslations("delivery");
  const duration = useDuration();
  const label = useSituationLabel();
  const why = useWhy();
  const Back = locale === "ar" ? ChevronRight : ChevronLeft;
  const V = VERDICT_TONE[agent.verdict];
  const Icon = V.icon;
  const maxWeek = Math.max(1, ...agent.week);
  // The strip is labelled from the current weekday backwards, so "today" is
  // always the last column whatever day the manager opens it.
  const weekday = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-FR", { weekday: "narrow" });
  const dayLabel = (i: number) => weekday.format(new Date(now - (6 - i) * 86_400_000));

  const frame = "rounded-[10px] border border-[#E5E7EB] px-3 py-2.5";
  const frameLabel = "text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#6B7280]";
  const frameValue = "mt-1 text-[24px] font-bold leading-tight tracking-[-0.02em] tabular-nums";

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#374151] hover:text-[#111827]">
        <Back size={15} aria-hidden />{t("board.allAgents")}
      </button>

      <div className="flex items-center gap-3">
        <span className={`grid h-11 w-11 place-items-center rounded-full text-[17px] font-bold ${V.avatar}`} aria-hidden>{initial(agent.name)}</span>
        <div className="min-w-0">
          <h3 className="text-[20px] font-bold text-[#111827] [unicode-bidi:plaintext]">{agent.name}</h3>
          <p className="text-[13px] text-[#6B7280]">{t("board.inFlight", { n: agent.inFlight })}</p>
        </div>
        <LoadBar load={agent.load} className="ms-auto w-[90px] shrink-0" />
      </div>

      <div className={`mt-2.5 flex items-start gap-2.5 rounded-xl px-3.5 py-3 ${V.block}`}>
        <Icon size={18} aria-hidden className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <b className="block text-[15.5px] font-bold">{t(`board.verdict.${agent.verdict}`)}</b>
          <span className="mt-px block text-[13.5px] leading-snug">{why(agent)}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className={frame}>
          <div className={frameLabel}>{t("board.now")}</div>
          <div className={`${frameValue} ${agent.lateCount > 0 ? "text-[#B45309]" : agent.toTreat > 0 ? "text-[#111827]" : "text-[#9CA3AF]"}`}>{agent.toTreat}</div>
          <div className="mt-0.5 text-[12.5px] leading-tight text-[#6B7280]">
            {agent.toTreat === 0 ? t("board.noneLive")
              : agent.lateCount > 0
                ? t.rich("board.nowLate", { n: agent.lateCount, hours: duration(agent.oldestHours), b: (c) => <b className="font-semibold text-[#374151]">{c}</b> })
                : t("board.nowOk")}
          </div>
        </div>
        <div className={frame}>
          <div className={frameLabel}>{t("board.today")}</div>
          <div className={`${frameValue} ${agent.actionsToday > 0 ? "text-[#111827]" : "text-[#9CA3AF]"}`}>
            {agent.actionsToday}<small className="ms-1 text-[12px] font-medium tracking-normal text-[#6B7280]">{t("board.actions", { n: agent.actionsToday })}</small>
          </div>
          <div className="mt-0.5 text-[12.5px] leading-tight text-[#6B7280]">
            {t.rich("board.todayReached", { n: agent.reachedToday, wa: agent.whatsappToday, b: (c) => <b className="font-semibold text-[#374151]">{c}</b> })}
          </div>
        </div>
        <div className={frame}>
          <div className={frameLabel}>{t("board.week")}</div>
          <div className={`${frameValue} ${agent.savedWeek > 0 ? "text-[#15803D]" : agent.lostWeek > 0 ? "text-[#B91C1C]" : "text-[#9CA3AF]"}`}>
            {agent.savedWeek}<small className="ms-1 text-[12px] font-medium tracking-normal text-[#6B7280]">{t("board.saved", { n: agent.savedWeek })}</small>
          </div>
          <div className="mt-0.5 text-[12.5px] leading-tight text-[#6B7280]">
            {agent.lostWeek > 0
              ? t.rich("board.weekLost", { n: agent.lostWeek, b: (c) => <b className="font-semibold text-[#B91C1C]">{c}</b> })
              : t("board.weekNoLoss")}
          </div>
        </div>
      </div>

      {/* A week with no action must still read as a week: empty days keep a
          visible baseline, or the strip vanishes and looks like a render bug. */}
      <div className="mt-2.5 flex h-[34px] items-end gap-1.5 border-b border-[#E5E7EB]" role="img" aria-label={t("board.weekStrip")}>
        {agent.week.map((n, i) => (
          <span key={i} title={`${dayLabel(i)} · ${n}`}
            className={`flex-1 rounded-t-[3px] ${n === 0 ? "bg-[#E5E7EB]" : i === 6 ? "bg-[#111827]" : "bg-[#15803D]/85"}`}
            style={{ height: n === 0 ? "4px" : `${Math.max(18, (n / maxWeek) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 text-[10.5px] text-[#9CA3AF]">
        {agent.week.map((_, i) => <span key={i} className="flex-1 text-center">{dayLabel(i)}</span>)}
      </div>

      <div className="mt-3.5">
        <div className="flex items-center gap-2 text-[14.5px] font-semibold text-[#111827]">
          <AlertCircle size={16} aria-hidden className="text-[#6B7280]" />{t("board.blocking")}
          {agent.toTreat > 3 && <span className="ms-auto text-[12.5px] font-medium text-[#6B7280]">{t("board.threeOf", { n: agent.toTreat })}</span>}
        </div>
        {agent.worst.length === 0 ? (
          <p className="mt-1.5 text-[12.5px] leading-snug text-[#6B7280]">{t("board.nothingBlocks")}</p>
        ) : agent.worst.map((row) => {
          const s = situationOf(row, now);
          const m = moveFor(row, now);
          const hours = row.hours_on_status ?? 0;
          return (
            <button key={row.order_id} type="button" onClick={() => onOpenParcel(row)}
              className="grid w-full grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-2.5 overflow-hidden border-t border-[#E5E7EB] py-2 pe-2.5 text-start first-of-type:border-t-0 hover:bg-[#F9FAFB]">
              <i aria-hidden className={`block h-9 rounded-sm ${TONE[s.tone].dot}`} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-[#111827]">
                  <span className="[unicode-bidi:plaintext]">{row.customer_name}</span>{" "}
                  <Ltr className="font-normal text-[#6B7280]">#{row.tracking_number ?? row.external_id ?? ""}</Ltr>
                </span>
                <span className="block truncate text-[12.5px] text-[#6B7280] [unicode-bidi:plaintext]">{label(s)} · {t(`moves.${m.kind}`)}</span>
              </span>
              <span className={`shrink-0 whitespace-nowrap text-[13px] font-semibold ${hours > 24 ? "text-[#B91C1C]" : "text-[#B45309]"}`}>
                {t("board.waits", { d: duration(hours) })}
              </span>
            </button>
          );
        })}
      </div>

      {agent.inFlight > 0 && (
        <button type="button" onClick={() => onAbsent(agent)}
          className={`mt-3.5 h-10 w-full text-[13.5px] ${OUTLINE_BTN} border-dashed border-[#D1D5DB] !font-medium text-[#374151]`}>
          <RotateCcw size={15} aria-hidden />{t("board.absent", { name: agent.name, n: agent.inFlight })}
        </button>
      )}
    </div>
  );
}

/** Who is holding the market's parcels right now, from the Darb mirror. */
function CouriersView({ couriers, onCall }: { couriers: CourierRow[]; onCall: (phone: string) => void }) {
  const t = useTranslations("delivery");
  if (couriers.length === 0) {
    return (
      <div>
        <h3 className="mb-1.5 flex items-center gap-2 text-[17px] font-bold text-[#111827]"><User size={18} aria-hidden className="text-[#6B7280]" />{t("board.couriers.title")}</h3>
        <p className="text-[12.5px] leading-snug text-[#6B7280]">{t("board.couriers.none")}</p>
      </div>
    );
  }
  const num = "px-1 text-end";
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[17px] font-bold text-[#111827]"><User size={18} aria-hidden className="text-[#6B7280]" />{t("board.couriers.title")}</h3>
      <p className="mb-2.5 mt-1 text-[12.5px] leading-snug text-[#6B7280]">{t("board.couriers.sub")}</p>
      <table className="w-full table-fixed border-collapse text-[13.5px]">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#6B7280]">
            <th className="w-[40%] px-1.5 pb-2 text-start">{t("board.couriers.courier")}</th>
            <th className={`${num} pb-2 leading-tight`}>{t("board.couriers.held")}</th>
            <th className={`${num} pb-2 leading-tight`}>{t("board.couriers.noAnswer")}</th>
            <th className={`${num} pb-2 leading-tight`}>{t("board.couriers.returning")}</th>
            <th className="w-[88px] pb-2" />
          </tr>
        </thead>
        <tbody>
          {couriers.map((c) => (
            <tr key={c.name} className="border-t border-[#E5E7EB]">
              <td className="overflow-hidden px-1.5 py-2">
                <span className="block truncate font-semibold text-[#111827] [unicode-bidi:plaintext]">{c.name}</span>
                {c.phone && <Ltr className="block truncate text-[12px] font-normal text-[#6B7280]">{formatPhone(c.phone)}</Ltr>}
              </td>
              <td className={`${num} py-2`}><Count n={c.held} /></td>
              <td className={`${num} py-2`}><Count n={c.noAnswer} tone="amber" /></td>
              <td className={`${num} py-2`}><Count n={c.returning} tone="red" /></td>
              <td className="py-2 text-end">
                {c.phone && (
                  <button type="button" onClick={() => onCall(c.phone as string)} className={`h-8 !px-2 text-[13px] ${OUTLINE_BTN} border-[#D1D5DB]`}>
                    <Phone size={14} aria-hidden />{t("board.couriers.call")}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Count({ n, tone }: { n: number; tone?: "amber" | "red" }) {
  const cls = n === 0 ? "bg-transparent font-medium text-[#9CA3AF]"
    : tone === "amber" ? "bg-[#FEF3C7] text-[#92400E]"
    : tone === "red" ? "bg-[#FEE2E2] text-[#B91C1C]"
    : "bg-[#F3F4F6] text-[#374151]";
  return <span className={`inline-grid h-6 min-w-[26px] place-items-center rounded-full px-1.5 text-[12.5px] font-bold tabular-nums ${cls}`}>{n}</span>;
}

/** What each carrier is carrying right now. */
function CarriersView({ carriers }: { carriers: CarrierRow[] }) {
  const t = useTranslations("delivery");
  return (
    <div>
      <h3 className="mb-1 flex items-center gap-2 text-[17px] font-bold text-[#111827]"><Truck size={18} aria-hidden className="text-[#6B7280]" />{t("board.carriers.title")}</h3>
      {carriers.length === 0 ? (
        <p className="text-[12.5px] text-[#6B7280]">{t("board.carriers.none")}</p>
      ) : carriers.map((c) => (
        <div key={c.id} className="mt-2.5 rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-3">
          <div className="flex items-center gap-2 text-[14.5px] font-semibold text-[#111827]">
            <Truck size={16} aria-hidden className="text-[#6B7280]" /><span className="truncate">{c.name}</span>
          </div>
          <div className="mt-1.5 text-[26px] font-bold tracking-[-0.02em] tabular-nums text-[#111827]">
            {c.inFlight}<small className="ms-1.5 text-[13px] font-medium tracking-normal text-[#6B7280]">{t("board.carriers.inFlight")}</small>
          </div>
          <div className="mt-0.5 text-[13px] text-[#6B7280]">
            {t("board.carriers.split", { toTreat: c.toTreat, returning: c.returning })}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface DeliveryCockpitProps {
  tab: CockpitTab;
  onTab: (tab: CockpitTab) => void;
  summary: MarketSummary;
  /** The agent whose page is open, or null for the market summary. */
  agent: AgentBoard | null;
  couriers: CourierRow[];
  carriers: CarrierRow[];
  marketLabel: string;
  locale: string;
  now: number;
  onPickAgent: (id: string | null) => void;
  onOpenParcel: (row: WorklistRow) => void;
  onAbsent: (agent: AgentBoard) => void;
  onCall: (phone: string) => void;
}

const TABS: CockpitTab[] = ["team", "couriers", "carriers"];

export function DeliveryCockpit(props: DeliveryCockpitProps) {
  const { tab, onTab, summary, agent, couriers, carriers, marketLabel, locale, now, onPickAgent, onOpenParcel, onAbsent, onCall } = props;
  const t = useTranslations("delivery");

  return (
    <div className="h-full overflow-y-auto rounded-xl border border-[#E5E7EB] bg-white px-4 py-4 [scrollbar-width:thin]">
      <div className="mb-3 flex items-center gap-2.5">
        <h2 className="flex items-center gap-2 text-[17px] font-bold text-[#111827]">
          <Gauge size={18} aria-hidden className="text-[#6B7280]" />{t("board.title")}
        </h2>
        <span className="ms-auto truncate text-[12.5px] text-[#6B7280]">{marketLabel}</span>
      </div>

      <div role="tablist" aria-label={t("board.title")} className="mb-3.5 grid grid-cols-3 overflow-hidden rounded-lg border border-[#E5E7EB]">
        {TABS.map((k, i) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => onTab(k)}
            className={`h-9 text-center text-[13.5px] ${i > 0 ? "border-s border-[#E5E7EB]" : ""} ${tab === k ? "bg-[#F3F4F6] font-semibold text-[#111827]" : "font-medium text-[#374151] hover:bg-[#F9FAFB]"}`}>
            {t(`board.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === "team" ? (
        agent
          ? <AgentView agent={agent} locale={locale} now={now} onBack={() => onPickAgent(null)} onOpenParcel={onOpenParcel} onAbsent={onAbsent} />
          : <MarketView summary={summary} onPickAgent={onPickAgent} />
      ) : tab === "couriers" ? (
        <CouriersView couriers={couriers} onCall={onCall} />
      ) : (
        <CarriersView carriers={carriers} />
      )}
    </div>
  );
}

/** The agents strip under the buckets: everyone, with what they are carrying. */
export function DeliveryAgentsStrip({
  boards, selected, totalToTreat, onPick,
}: { boards: AgentBoard[]; selected: string | null; totalToTreat: number; onPick: (id: string | null) => void }) {
  const t = useTranslations("delivery");
  const pill = "inline-flex h-[38px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full border ps-1.5 pe-3 text-[13.5px]";
  const count = "grid h-[22px] min-w-[22px] place-items-center rounded-full px-1.5 text-[12px] font-bold tabular-nums";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="me-1 shrink-0 text-[12.5px] font-medium text-[#6B7280]">{t("board.agentLabel")}</span>
      <button type="button" aria-pressed={selected === null} onClick={() => onPick(null)}
        className={`${pill} ${selected === null ? "border-[1.5px] border-[#15803D] bg-[#F0FDF4] font-semibold text-[#111827]" : "border-[#E5E7EB] bg-white font-medium text-[#374151]"}`}>
        <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-[#F3F4F6] text-[#374151]" aria-hidden><Users size={14} /></span>
        {t("board.allAgents")}
        <span className={`${count} ${totalToTreat > 0 ? "bg-[#FEF3C7] text-[#92400E]" : "bg-[#F3F4F6] text-[#6B7280]"}`}>{totalToTreat}</span>
      </button>
      {boards.map((a) => (
        <button key={a.id} type="button" aria-pressed={selected === a.id} onClick={() => onPick(a.id)}
          className={`${pill} ${selected === a.id ? "border-[1.5px] border-[#15803D] bg-[#F0FDF4] font-semibold text-[#111827]" : "border-[#E5E7EB] bg-white font-medium text-[#374151]"}`}>
          <span className={`grid h-[26px] w-[26px] place-items-center rounded-full text-[11.5px] font-bold ${VERDICT_TONE[a.verdict].avatar} ${a.verdict === "late" ? "ring-2 ring-[#F59E0B]" : ""}`} aria-hidden>
            {initial(a.name)}
          </span>
          <span className="[unicode-bidi:plaintext]">{a.name}</span>
          <span className={`${count} ${a.returning > 0 ? "bg-[#FEE2E2] text-[#B91C1C]" : a.toTreat > 0 ? "bg-[#FEF3C7] text-[#92400E]" : "bg-[#F3F4F6] text-[#6B7280]"}`}>
            {a.returning > 0 ? `${a.returning} · ${a.toTreat}` : a.toTreat}
          </span>
        </button>
      ))}
    </div>
  );
}

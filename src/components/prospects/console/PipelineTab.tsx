"use client";

/**
 * « Prospects » — the table, the bulk bar, and the panel on the right.
 *
 * The filters run on the server (see /api/prospects/worklist): Tunisia holds
 * ~1 700 working prospects and this table shows a page of them. What arrives
 * here is already the slice the manager asked for.
 *
 * Design: prototypes/prospects-manager-v1.html (pipelineBody + panelHTML).
 */
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Search, X } from "lucide-react";
import { BUCKET_TONE, formatPhone, situationOf } from "@/lib/prospects/presentation";
import type { Bucket, ProspectRow } from "@/lib/prospects/types";
import type { CampaignResult } from "@/lib/prospects/console";
import { Chip, Ltr, Money, SIT_ICON, useDuration, useSituationLabel } from "../ui";
import { Avatar, CARD, DARK, Empty, FilterChip, fmt, INPUT, OUTLINE } from "./ui";
import { ProspectPanel } from "./ProspectPanel";

/** The strip's filters. `unassigned` and `lost` are not buckets — see below. */
export type PipelineFilter = "all" | "unassigned" | Bucket | "lost";

const FILTERS: PipelineFilter[] = [
  "all", "unassigned", "hot", "callback", "retry", "campaign", "winback", "converted", "lost",
];

/** `unassigned` asks about ownership and `lost` about status; the rest are buckets. */
const TONE_OF: Partial<Record<PipelineFilter, "red" | Parameters<typeof Chip>[0]["tone"]>> = {
  unassigned: "red", hot: "amber", callback: "blue", retry: "grey",
  campaign: "violet", winback: "red", converted: "green", lost: "grey",
};

export interface PipelineTabProps {
  rows: ProspectRow[] | null;
  total: number;
  truncated: boolean;
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;

  filter: PipelineFilter;
  onFilter: (f: PipelineFilter) => void;
  counts: Partial<Record<PipelineFilter, number>>;

  agents: { id: string; name: string }[];
  agentId: string | null;
  onAgent: (id: string | null) => void;

  campaigns: CampaignResult[];
  campaignId: string | null;
  onCampaign: (id: string | null) => void;

  query: string;
  onQuery: (q: string) => void;

  selection: Set<string>;
  onToggle: (id: string) => void;
  onClearSelection: () => void;

  openId: string | null;
  onOpen: (id: string | null) => void;

  onAssign: (ids: string[]) => void;
  onDistribute: (ids: string[]) => void;
  onClose: (ids: string[]) => void;
  onReopen: (id: string) => void;
  onSave: (id: string, patch: Partial<ProspectRow>) => Promise<void>;

  marketCode: "ly" | "tn";
  tz: string;
  locale: string;
  now: number;
}

export function PipelineTab(props: PipelineTabProps) {
  const {
    rows, total, truncated, isLoading, error, onRetry,
    filter, onFilter, counts, agents, agentId, onAgent,
    campaigns, campaignId, onCampaign, query, onQuery,
    selection, onToggle, onClearSelection, openId, onOpen,
    onAssign, onDistribute, onClose, onReopen, onSave,
    marketCode, tz, locale, now,
  } = props;

  const t = useTranslations("prospects.console");
  const tp = useTranslations("prospects");
  const duration = useDuration();
  const situationLabel = useSituationLabel(tz, locale);

  const shown = rows ?? [];
  const open = useMemo(() => shown.find((r) => r.id === openId) ?? null, [shown, openId]);
  const allChecked = shown.length > 0 && shown.every((r) => selection.has(r.id));

  return (
    <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_440px]">
      <section className={`flex min-w-0 flex-col overflow-hidden xl:max-h-[calc(100vh-190px)] ${CARD}`}>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[#E5E7EB] px-3.5 py-2.5">
          {FILTERS.map((f) => (
            <FilterChip
              key={f}
              label={f === "all" ? tp("buckets.all")
                : f === "unassigned" ? t("filters.unassigned")
                : f === "lost" ? t("k.lost")
                : tp(`buckets.${f}`)}
              count={counts[f]}
              active={filter === f}
              tone={TONE_OF[f] as never}
              onClick={() => onFilter(f)}
              locale={locale}
            />
          ))}

          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <label className="flex h-[30px] items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-[#6B7280] focus-within:border-[#15803D]">
              <Search size={14} aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder={t("search")}
                aria-label={t("search")}
                className="min-w-0 w-[180px] bg-transparent text-[13px] text-[#111827] outline-none placeholder:text-[#9CA3AF]"
              />
            </label>

            <select
              aria-label={t("f.agent")}
              value={agentId ?? ""}
              onChange={(e) => onAgent(e.target.value || null)}
              className="h-[30px] rounded-lg border border-[#E5E7EB] bg-white px-2 text-[13px] text-[#111827] outline-none focus:border-[#15803D]"
            >
              <option value="">{t("f.agent")}</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>

            <select
              aria-label={t("f.camp")}
              value={campaignId ?? ""}
              onChange={(e) => onCampaign(e.target.value || null)}
              className="h-[30px] max-w-[190px] rounded-lg border border-[#E5E7EB] bg-white px-2 text-[13px] text-[#111827] outline-none focus:border-[#15803D]"
            >
              <option value="">{t("f.camp")}</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <span className="text-[13px] text-[#6B7280]">
              {t("f.count", { shown: fmt(shown.length, locale), total: fmt(total, locale) })}
            </span>
          </div>
        </div>

        {/* Bulk bar */}
        {selection.size > 0 ? (
          <div role="status" className="flex flex-wrap items-center gap-2 bg-[#111111] px-3.5 py-2.5 text-[13.5px] text-white">
            <b className="font-semibold">{t("sel.n", { n: selection.size })}</b>
            <button type="button" onClick={() => onAssign([...selection])}
              className="h-8 rounded-lg bg-white px-3 text-[13px] font-semibold text-[#111827] hover:bg-[#F3F4F6]">
              {t("sel.assign")}
            </button>
            <button type="button" onClick={() => onDistribute([...selection])}
              className="h-8 rounded-lg border border-white/35 px-3 text-[13px] font-semibold text-white hover:bg-white/10">
              {t("sel.dist")}
            </button>
            <button type="button" onClick={() => onClose([...selection])}
              className="h-8 rounded-lg border border-white/35 px-3 text-[13px] font-semibold text-white hover:bg-white/10">
              {t("sel.close")}
            </button>
            <button type="button" onClick={onClearSelection} aria-label={t("sel.clear")}
              className="ms-auto grid h-8 w-8 place-items-center rounded-lg text-[#9CA3AF] hover:bg-white/10">
              <X size={18} aria-hidden />
            </button>
          </div>
        ) : null}

        {truncated ? (
          <p className="m-0 border-b border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5 text-[13.5px] text-[#92400E]">
            {t("f.more", { n: fmt(Math.max(0, total - shown.length), locale) })}
          </p>
        ) : null}

        {error ? (
          <div className="px-5 py-10 text-center">
            <AlertTriangle size={34} aria-hidden className="mx-auto text-[#D1D5DB]" />
            <p className="mb-3 mt-3 text-[15px] text-[#374151]">{tp("loadError")}</p>
            <button type="button" onClick={onRetry} className={`h-10 px-4 text-[14px] ${OUTLINE}`}>
              {tp("retry")}
            </button>
          </div>
        ) : shown.length === 0 && !isLoading ? (
          <Empty>{t("empty.pipeline")}</Empty>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table aria-label={t("pipeline")} aria-busy={isLoading} className="w-full border-collapse text-[13.5px]">
              {/* The header stays put while 290 rows scroll under it. */}
              <thead className="sticky top-0 z-10 bg-white">
                <tr>
                  <th scope="col" className="w-9 border-b border-[#E5E7EB] px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      aria-label={t("sel.assign")}
                      onChange={() => {
                        if (allChecked) onClearSelection();
                        else shown.forEach((r) => { if (!selection.has(r.id)) onToggle(r.id); });
                      }}
                      className="h-4 w-4 accent-[#15803D]"
                    />
                  </th>
                  {(["who", "source", "agent", "situation", "since", "value"] as const).map((k) => (
                    <th key={k} scope="col"
                      className={`whitespace-nowrap border-b border-[#E5E7EB] px-3.5 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#6B7280] ${
                        k === "value" ? "text-end" : "text-start"
                      }`}>
                      {t(`th.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const sit = situationOf(r, now);
                  const SitIcon = SIT_ICON[sit.key];
                  const picked = selection.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      data-open={r.id === openId ? "true" : undefined}
                      aria-selected={picked}
                      onClick={() => onOpen(r.id)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r.id); }
                      }}
                      className={`cursor-pointer border-b border-[#F3F4F6] transition-colors last:border-b-0 hover:bg-[#F9FAFB] focus-visible:bg-[#F0FDF4] focus-visible:outline-none ${
                        r.id === openId ? "bg-[#F1FAF4] shadow-[inset_3px_0_0_#15803D]" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={() => onToggle(r.id)}
                          aria-label={r.customer_name}
                          className="h-4 w-4 accent-[#15803D]"
                        />
                      </td>
                      <td className="px-3.5 py-2.5 align-middle">
                        <div className="font-semibold text-[#111827] [unicode-bidi:plaintext]">{r.customer_name}</div>
                        <div className="mt-0.5 max-w-[240px] truncate text-[12.5px] text-[#6B7280]">
                          <Ltr>{formatPhone(r.customer_phone)}</Ltr>
                          {r.customer_city ? <span className="[unicode-bidi:plaintext]"> · {r.customer_city}</span> : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 align-middle text-[#374151]">
                        <div>{tp(`sources.${r.source}`)}</div>
                        {r.campaign_name ? (
                          <div className="mt-0.5 max-w-[160px] truncate text-[12px] text-[#6B7280] [unicode-bidi:plaintext]">
                            {r.campaign_name}
                          </div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 align-middle">
                        {r.assigned_name ? (
                          <span className="inline-flex items-center gap-2 text-[#111827]">
                            <Avatar name={r.assigned_name} size="sm" />
                            <span className="[unicode-bidi:plaintext]">{r.assigned_name}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[#B91C1C]">
                            <AlertTriangle size={14} aria-hidden />
                            {t("unassigned")}
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle">
                        <Chip tone={BUCKET_TONE[r.bucket]} icon={SitIcon}>{situationLabel(sit)}</Chip>
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 align-middle text-[#6B7280]">
                        {duration(Math.max(0, (now - Date.parse(r.created_at)) / 60_000))}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-end align-middle font-semibold">
                        {r.product_price !== null
                          ? <Money amount={r.product_price} market={marketCode} locale={locale} />
                          : <span aria-hidden className="text-[#D1D5DB]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ProspectPanel
        row={open}
        onClose={() => onOpen(null)}
        onAssign={(id) => onAssign([id])}
        onCloseLead={(id) => onClose([id])}
        onReopen={onReopen}
        onSave={onSave}
        marketCode={marketCode}
        tz={tz}
        locale={locale}
        now={now}
      />
    </div>
  );
}

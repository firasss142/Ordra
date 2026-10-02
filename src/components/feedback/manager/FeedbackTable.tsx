"use client";

import { useEffect, useId } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check, ExternalLink, X } from "lucide-react";
import { isLateComplaint, type ComplaintStatus } from "@/lib/feedback/taxonomy";
import { COURIER_AGENT } from "@/lib/feedback/overview";
import type { FeedbackSheetRow, FeedbackTopic } from "@/types/feedback";
import { CategoryTag, ProductThumb, useTopicLabel } from "../atoms";
import { Avatar, agentColor } from "./OverviewBlocks";

const DAY_MS = 86_400_000;
const STATUS_DOT: Record<ComplaintStatus, string> = { open: "#D72C0D", in_progress: "#F59E0B", resolved: "#008060" };

function useFdate() {
  const locale = useLocale();
  const intl = locale.startsWith("ar") ? "ar-LY" : "fr-FR";
  return (iso: string, year = false) =>
    new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) }).format(new Date(iso));
}

function StatusDot({ row, now }: { row: FeedbackSheetRow; now: number }) {
  const t = useTranslations("feedback");
  if (!row.status) return null;
  const late = isLateComplaint(row, now);
  const days = Math.floor((now - new Date(row.created_at).getTime()) / DAY_MS);
  return (
    <span className={`inline-flex items-center gap-[5px] whitespace-nowrap text-[12px] ${late ? "font-semibold text-[#D72C0D]" : ""}`}>
      <span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: STATUS_DOT[row.status] }} />
      {t(`status.${row.status}`)}
      {late && <> · <span dir="ltr" className="tabular-nums">{t("manager.daysShort", { n: days })}</span></>}
    </span>
  );
}

export interface Chip { label: string; clear: () => void }

export function FilterChips({ chips, onClear }: { chips: Chip[]; onClear: () => void }) {
  const t = useTranslations("feedback.manager");
  if (chips.length === 0) return <div className="h-2" />;
  return (
    <div className="mb-2 mt-1 flex min-h-[26px] flex-wrap items-center gap-1.5 text-[13px] text-[#5C6166]">
      {t("filters")}
      {chips.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-full border border-[#E1E3E5] bg-white py-0.5 pe-1.5 ps-2.5 text-[12.5px] text-[#1A1A1A]">
          <span className="[unicode-bidi:plaintext]">{c.label}</span>
          <button type="button" aria-label={t("removeFilter")} onClick={c.clear} className="flex text-[#8A9096]"><X size={13} aria-hidden /></button>
        </span>
      ))}
      <button type="button" onClick={onClear} className="text-[12px] text-[#8A9096]">{t("clear")}</button>
    </div>
  );
}

export function FeedbackTable({ rows, total, review, topics, agents, peek, now, onPeek, onMore, onKeep, onIgnore }: {
  rows: FeedbackSheetRow[] | null; total: number; review: boolean; topics: FeedbackTopic[]; agents: { id: string; name: string }[];
  peek: string | null; now: number;
  onPeek: (id: string) => void; onMore: () => void; onKeep: (id: string) => void; onIgnore: (id: string) => void;
}) {
  const t = useTranslations("feedback.manager");
  const tf = useTranslations("feedback");
  const topicLabel = useTopicLabel();
  const fdate = useFdate();
  const cols = review
    ? (["date", "category", "topic", "says", "product"] as const)
    : (["date", "category", "topic", "says", "product", "agent", "status"] as const);
  const list = rows ?? [];
  const td = "border-b border-[#EDEEF0] px-3 py-2 align-middle";
  return (
    <>
      <div className="overflow-x-auto rounded-[10px] border border-[#E1E3E5] bg-white">
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} className="whitespace-nowrap border-b border-[#E1E3E5] bg-[#F9FAFB] px-3 py-2 text-start text-[12px] font-medium text-[#8A9096]">{t(`cols.${c}`)}</th>
              ))}
              {review && <th className="border-b border-[#E1E3E5] bg-[#F9FAFB] px-3 py-2" aria-hidden />}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={cols.length + (review ? 1 : 0)} className="p-[30px] text-center text-[#8A9096]">{t("none")}</td></tr>
            )}
            {list.map((r) => {
              const courier = r.source === "courier";
              const who = courier ? tf("manager.darb") : r.author?.name ?? "—";
              return (
                <tr key={r.id} aria-label={r.body}
                  onClick={() => { if (!review) onPeek(r.id); }}
                  className={`${review ? "" : "cursor-pointer"} hover:[&>td]:bg-[#F7F8F9] ${peek === r.id ? "[&>td]:bg-[#F1F5F9]" : ""}`}>
                  <td className={`${td} whitespace-nowrap tabular-nums text-[#5C6166]`}>{fdate(r.created_at)}</td>
                  <td className={td}><CategoryTag category={r.category} size="sm" /></td>
                  <td className={`${td} whitespace-nowrap text-[#5C6166]`}>{topicLabel(topics, r.topic_id)}</td>
                  <td className={`${td} max-w-[380px]`}><span className="block truncate [font-family:Cairo,'Noto_Sans_Arabic',system-ui,sans-serif] [unicode-bidi:plaintext]">{r.body}</span></td>
                  <td className={`${td} whitespace-nowrap text-[#5C6166]`}>
                    {r.product ? <span className="inline-flex items-center gap-2"><ProductThumb url={r.product.image_url} size={22} /><span className="[unicode-bidi:plaintext]">{r.product.name}</span></span> : "—"}
                  </td>
                  {review ? (
                    <td className={td}>
                      <span className="flex gap-1.5">
                        <button type="button" onClick={(e) => { e.stopPropagation(); onKeep(r.id); }}
                          className="rounded-md border border-[#15803D] bg-white px-2 py-0.5 text-[12px] text-[#15803D]">{t("keep")}</button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); onIgnore(r.id); }}
                          className="rounded-md border border-[#E1E3E5] bg-white px-2 py-0.5 text-[12px]">{t("ignore")}</button>
                      </span>
                    </td>
                  ) : (
                    <>
                      <td className={`${td} whitespace-nowrap text-[#5C6166]`}>
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar name={who} color={agentColor(agents, courier ? COURIER_AGENT : r.author?.id ?? null)} courier={courier} />
                          {who}
                        </span>
                      </td>
                      <td className={td}><StatusDot row={r} now={now} /></td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total > list.length && (
        <button type="button" onClick={onMore} className="mx-auto mt-2.5 block text-[13px] text-[#5C6166]">
          {t("more", { n: Math.min(20, total - list.length) })}
        </button>
      )}
    </>
  );
}

export function FeedbackDrawer({ row, topics, agents, locale, busy, onClose, onStatus }: {
  row: FeedbackSheetRow; topics: FeedbackTopic[]; agents: { id: string; name: string }[]; locale: string; busy: boolean;
  onClose: () => void; onStatus: (status: ComplaintStatus) => void;
}) {
  const t = useTranslations("feedback.manager");
  const tf = useTranslations("feedback");
  const topicLabel = useTopicLabel();
  const fdate = useFdate();
  const titleId = useId();
  const courier = row.source === "courier";
  const who = courier ? t("darb") : row.author?.name ?? "—";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] disabled:opacity-50";
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/[0.18]" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="fixed bottom-0 end-0 top-0 z-50 w-[440px] max-w-full overflow-auto border-s border-[#E1E3E5] bg-white px-[22px] py-5 text-start">
        <h2 id={titleId} className="m-0 mb-3 flex items-center gap-2 text-[16px]">
          <CategoryTag category={row.category} size="sm" /> {topicLabel(topics, row.topic_id)}
          <button type="button" aria-label={tf("capture.close")} onClick={onClose} className="ms-auto text-[#8A9096]"><X size={16} aria-hidden /></button>
        </h2>
        <p dir="rtl" className="m-0 mb-3.5 rounded-lg border border-[#EDEEF0] bg-[#F9FAFB] px-3.5 py-3 text-right text-[16px] [font-family:Cairo,'Noto_Sans_Arabic',system-ui,sans-serif] [unicode-bidi:plaintext]">{row.body}</p>
        <dl className="mb-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-[#8A9096]">{t("drawer.product")}</dt>
          <dd className="m-0 flex items-center gap-2.5">{row.product ? <><ProductThumb url={row.product.image_url} size={40} /><span className="[unicode-bidi:plaintext]">{row.product.name}</span></> : "—"}</dd>
          <dt className="text-[#8A9096]">{t("drawer.customer")}</dt>
          <dd className="m-0 [unicode-bidi:plaintext]">{row.customer_name ?? "—"}</dd>
          <dt className="text-[#8A9096]">{t("drawer.phone")}</dt>
          <dd className="m-0 tabular-nums" dir="ltr">{row.customer_phone ?? "—"}</dd>
          <dt className="text-[#8A9096]">{t("drawer.order")}</dt>
          <dd className="m-0">
            {row.order_id ? (
              <Link href={`/${locale}/orders?open=${row.order_id}`} className="inline-flex items-center gap-1 tabular-nums hover:underline">
                <span dir="ltr">#{row.order_ref}</span><ExternalLink size={13} aria-hidden />
              </Link>
            ) : "—"}
          </dd>
          <dt className="text-[#8A9096]">{t("drawer.agent")}</dt>
          <dd className="m-0 inline-flex items-center gap-1.5">
            <Avatar name={who} color={agentColor(agents, courier ? COURIER_AGENT : row.author?.id ?? null)} courier={courier} />{who}
          </dd>
          <dt className="text-[#8A9096]">{t("drawer.when")}</dt>
          <dd className="m-0">{fdate(row.created_at, true)}</dd>
          {row.status && (
            <>
              <dt className="text-[#8A9096]">{t("drawer.status")}</dt>
              <dd className="m-0"><StatusDot row={row} now={Date.now()} /></dd>
              <dt className="text-[#8A9096]">{t("drawer.owner")}</dt>
              <dd className="m-0">{row.assignee?.name ?? "—"}</dd>
            </>
          )}
        </dl>
        {row.category === "reclamation" && row.status && (
          <div className="flex flex-wrap gap-2 border-t border-[#EDEEF0] pt-3.5">
            {row.status === "resolved" ? (
              <button type="button" disabled={busy} onClick={() => onStatus("open")} className={`${btn} border-[#E1E3E5] bg-white`}>{t("actions.reopen")}</button>
            ) : (
              <>
                {row.status === "open" && (
                  <button type="button" disabled={busy} onClick={() => onStatus("in_progress")} className={`${btn} border-[#E1E3E5] bg-white`}>{t("actions.take")}</button>
                )}
                <button type="button" disabled={busy} onClick={() => onStatus("resolved")} className={`${btn} border-[#15803D] bg-[#15803D] text-white`}>
                  <Check size={16} aria-hidden /> {t("actions.resolve")}
                </button>
              </>
            )}
          </div>
        )}
      </aside>
    </>
  );
}

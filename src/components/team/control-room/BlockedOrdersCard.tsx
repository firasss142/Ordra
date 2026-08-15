"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { BlockedOrder, BlockedKind } from "@/lib/team/types";
import { fmtAge, fmtNum } from "@/lib/team/format";
import { TeamCard, TeamCardHead } from "./Card";

const PILL: Record<BlockedKind, string> = {
  confirmed_stuck: "bg-hue-violet-bg text-hue-violet-ink border-hue-violet-edge-soft",
  exhausted: "bg-hue-amber-bg text-hue-amber-ink border-hue-amber-edge-soft",
  overdue_callback: "bg-hue-red-bg text-hue-red-ink border-hue-red-edge-soft",
};

const SHOWN = 7;

interface Props {
  blocked: BlockedOrder[];
  locale: string;
  onReassign: (order: BlockedOrder) => void;
}

export function BlockedOrdersCard({ blocked, locale, onReassign }: Props) {
  const t = useTranslations("team.live.blocked");
  const rows = blocked.slice(0, SHOWN);
  const rest = blocked.length - rows.length;
  const ordersHref = `/${locale}/orders?status=confirmed,attempt_3,callback_scheduled`;

  return (
    <TeamCard>
      <TeamCardHead
        title={
          <span className="inline-flex items-center gap-2">
            {t("title")}
            <span className="rounded-pill border border-status-critical bg-surface-card px-2.5 py-[2px] text-[13px] font-semibold text-status-critical tabular-nums">
              {fmtNum(locale, blocked.length)}
            </span>
          </span>
        }
      />
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-[13.5px] text-ink-secondary">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className="px-3.5 py-2.5 text-start text-[12px] font-medium text-ink-secondary">{t("order")}</th>
                <th className="px-3.5 py-2.5 text-start text-[12px] font-medium text-ink-secondary">{t("situation")}</th>
                <th className="px-3.5 py-2.5 text-end text-[12px] font-medium text-ink-secondary">{t("age")}</th>
                <th className="px-3.5 py-2.5 text-center text-[12px] font-medium text-ink-secondary">{t("action")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.order_id} className="border-b border-line-subtle last:border-b-0 hover:bg-surface-hover">
                  <td className="px-3.5 py-2.5">
                    <b className="text-[14px] font-semibold text-ink-primary" dir="auto">{o.customer_name ?? o.external_id ?? "—"}</b>
                    <small className="mt-px block text-[11.5px] text-ink-muted">
                      <span dir="auto">{o.product_name ?? "—"}</span> · {o.agent_name ?? t("unassigned")}
                    </small>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span className={`inline-flex whitespace-nowrap rounded-pill border px-2.5 py-[3px] text-[12.5px] font-medium ${PILL[o.kind]}`}>
                      {t(`kind.${o.kind}`)}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-end">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-status-critical tabular-nums">
                      <AlertTriangle size={15} aria-hidden="true" />
                      {fmtAge(locale, o.age_days)}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-center">
                    {o.kind === "confirmed_stuck" ? (
                      <Link
                        href={`/${locale}/orders?open=${o.order_id}`}
                        className="inline-flex rounded-md bg-brand px-2.5 py-[5px] text-[12.5px] font-medium text-white hover:bg-brand-hover"
                      >
                        {t("upload")}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onReassign(o)}
                        className="inline-flex rounded-md border border-line-strong bg-surface-card px-2.5 py-[5px] text-[12.5px] font-medium text-ink-primary hover:bg-surface-hover"
                      >
                        {t("reassign")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle px-4 py-[11px] text-[13px] text-ink-secondary">
        <span>{rest > 0 ? t("more", { n: rest }) : ""}</span>
        <Link href={ordersHref} className="inline-flex items-center gap-1.5 font-medium text-ink-primary hover:underline">
          {t("openOrders")}
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </footer>
    </TeamCard>
  );
}

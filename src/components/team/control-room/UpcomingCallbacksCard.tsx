"use client";

import { useTranslations } from "next-intl";
import type { UpcomingCallback } from "@/lib/team/types";
import { fmtDateTimeIn } from "@/lib/team/format";
import { TeamCard, TeamCardHead } from "./Card";

interface Props {
  callbacks: UpcomingCallback[];
  locale: string;
  tz: string;
}

export function UpcomingCallbacksCard({ callbacks, locale, tz }: Props) {
  const t = useTranslations("team.live.callbacks");
  const names = new Set(callbacks.map((c) => c.agent_name ?? "?"));
  const chip =
    callbacks.length > 0 && names.size === 1
      ? t("allWith", { n: callbacks.length, name: [...names][0] })
      : callbacks.length > 0
        ? t("count", { n: callbacks.length })
        : null;

  return (
    <TeamCard>
      <TeamCardHead
        title={t("title")}
        right={chip ? <span className="rounded-pill bg-surface-selected px-2.5 py-[3px] text-[12.5px] font-medium text-ink-primary">{chip}</span> : undefined}
      />
      {callbacks.length === 0 ? (
        <p className="px-4 py-6 text-[13.5px] text-ink-secondary">{t("empty")}</p>
      ) : (
        <ul className="list-none">
          {callbacks.map((c) => {
            const dt = fmtDateTimeIn(locale, c.callback_at, tz);
            return (
              <li key={c.order_id} className="flex items-center justify-between gap-2.5 border-b border-line-subtle px-4 py-[13px] last:border-b-0">
                <div>
                  <b className="text-[14px] font-semibold text-ink-primary" dir="auto">{c.customer_name ?? c.external_id ?? "—"}</b>
                  <small className="mt-0.5 block text-[12.5px] text-ink-secondary">
                    <span dir="auto">{c.product_name ?? "—"}</span> · {c.agent_name ?? t("unassigned")}
                  </small>
                </div>
                <div className="whitespace-nowrap text-end tabular-nums">
                  <b className="font-semibold text-ink-primary">{dt.day}</b>{" "}
                  <span className="text-ink-secondary">· {dt.time}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </TeamCard>
  );
}

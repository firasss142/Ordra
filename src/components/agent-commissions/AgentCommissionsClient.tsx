"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAgentCommissions } from "@/hooks/useAgentCommissions";
import { AgentCommissionsView } from "./AgentCommissionsView";

interface Props {
  marketCode: string;
  locale: string;
  tz: string;
}

export function AgentCommissionsClient({ marketCode, locale, tz }: Props) {
  const t = useTranslations("agentCommissions");
  const [days, setDays] = useState(60);
  const { me, error } = useAgentCommissions(days);
  if (error && !me) return <p className="px-5 py-8 text-center text-[13.5px] text-agent-error">{t("loadError")}</p>;
  if (!me) {
    return (
      <div className="mx-auto max-w-[640px] px-5 pt-5" role="status">
        <div className="h-[180px] animate-pulse rounded-xl bg-agent-surface-low" />
        <div className="mt-3.5 h-[260px] animate-pulse rounded-xl bg-agent-surface-low" />
      </div>
    );
  }
  return <AgentCommissionsView me={me} marketCode={marketCode} locale={locale} tz={tz} onMore={() => setDays((d) => Math.min(366, d + 60))} />;
}

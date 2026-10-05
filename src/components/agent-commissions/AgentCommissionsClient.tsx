"use client";

import "@/components/agent/agent.css";
import "@/components/agent/agent-app.css";
import "@/components/agent/commissions/commissions.css";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAgentCommissions } from "@/hooks/useAgentCommissions";
import { AgentCommissionsView } from "./AgentCommissionsView";

interface Props {
  marketCode: string;
  locale: string;
  tz: string;
}

/** « Mes commissions » — the children of the agent shell's `.page`. */
export function AgentCommissionsClient({ marketCode, locale, tz }: Props) {
  const t = useTranslations("agentCommissions");
  const [days, setDays] = useState(90);
  const { me, error } = useAgentCommissions(days);
  if (error && !me) {
    return (
      <section className="list">
        <div className="empty" role="alert">{t("loadError")}</div>
      </section>
    );
  }
  if (!me) {
    return (
      <div className="com-root" role="status" aria-busy="true">
        <div className="com-skel" />
        <div className="twoc"><div className="com-skel sm" /><div className="com-skel sm" /></div>
      </div>
    );
  }
  return <AgentCommissionsView me={me} marketCode={marketCode} locale={locale} tz={tz} onMore={() => setDays((d) => Math.min(366, d + 90))} />;
}

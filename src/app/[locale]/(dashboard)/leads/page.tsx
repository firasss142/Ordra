"use client";

import { useAuth } from "@/context/auth";
import { useTranslations } from "next-intl";
import { LeadList } from "@/components/crm/LeadList";
import { CrmKpiCards } from "@/components/crm/CrmKpiCards";

export default function LeadsPage() {
  const { user } = useAuth();
  const t = useTranslations("crm.leads");
  if (!user) return null;

  // Agents render via AgentTabsContainer in the dashboard layout — skip to avoid double-mount.
  if (user.role === "agent") {
    return null;
  }

  return (
    <div style={{ padding: 24, backgroundColor: "#F6F6F7", minHeight: "100vh" }}>
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "#1A1A1A",
            margin: "0 0 4px 0",
          }}
        >
          {t("title")}
        </h1>
        <div style={{ fontSize: 13, color: "#6D7175" }}>{t("subtitle")}</div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <CrmKpiCards
          marketId={user.market_id}
          isSuperAdmin={user.role === "super_admin"}
        />
      </div>

      <LeadList
        role={user.role}
        marketId={user.market_id}
        locale={user.locale}
      />
    </div>
  );
}

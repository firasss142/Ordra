"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import type { AuthUser } from "@/types";
import { useInDeliverySummary } from "@/hooks/useInDeliverySummary";
import { useMarketScope } from "@/context/market-scope";
import { CarrierSplitCards } from "@/components/in-delivery/CarrierSplitCards";
import { StuckAlertsList } from "@/components/in-delivery/StuckAlertsList";
import { InFlightTable } from "@/components/in-delivery/InFlightTable";

export function InDeliveryClient({ user }: { user: AuthUser }) {
  const t = useTranslations("inDelivery");
  const { marketId } = useMarketScope();
  const { summary, isLoading, error, mutate } = useInDeliverySummary({
    marketId: marketId ?? undefined,
  });

  const unassigned = summary?.unassigned_carrier_count ?? 0;

  return (
    <div style={{ backgroundColor: "#F6F6F7", minHeight: "100vh", padding: "32px 32px 64px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>{t("subtitle")}</p>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            backgroundColor: "#FFF4F4",
            color: "#D72C0D",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {t("loadError")}
        </div>
      )}

      {unassigned > 0 && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            backgroundColor: "#FFF8E6",
            color: "#B98900",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" />
          {t("unassignedWarning", { count: unassigned })}
        </div>
      )}

      <Section title={t("carriers.sectionTitle")} subtitle={t("carriers.sectionSubtitle")}>
        {!summary && isLoading ? (
          <Skeleton />
        ) : (
          <CarrierSplitCards carriers={summary?.carriers ?? []} />
        )}
      </Section>

      <Section title={t("stuck.sectionTitle")} subtitle={t("stuck.sectionSubtitle")}>
        {!summary && isLoading ? (
          <Skeleton />
        ) : (
          <StuckAlertsList
            stuckOrders={summary?.stuck_orders ?? []}
            locale={user.locale}
            onEscalated={() => mutate()}
          />
        )}
      </Section>

      <Section title={t("inFlight.sectionTitle")} subtitle={t("inFlight.sectionSubtitle")}>
        {!summary && isLoading ? (
          <Skeleton />
        ) : (
          <InFlightTable orders={summary?.in_flight ?? []} locale={user.locale} />
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBlockEnd: 32 }}>
      <div style={{ marginBlockEnd: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {title}
        </h2>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "2px 0 0" }}>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 6,
        padding: 24,
        color: "#6D7175",
        fontSize: 13,
      }}
    >
      …
    </div>
  );
}

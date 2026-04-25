"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  useConfirmationFlowOverview,
  type OverviewResponse,
} from "@/hooks/useConfirmationFlowOverview";
import { useCallbacksDueSoon } from "@/hooks/useCallbacksDueSoon";
import { useConfirmationFlowRealtime } from "@/hooks/useConfirmationFlowRealtime";
import { TeamPeriodSelector, type TeamPeriodPreset } from "@/components/team/TeamPeriodSelector";
import { FunnelChart } from "./FunnelChart";
import { AgentStrugglingTable } from "./AgentStrugglingTable";
import { CallbacksDueSoon } from "./CallbacksDueSoon";
import { TtfcDistribution } from "./TtfcDistribution";
import { NewEventsBanner } from "./NewEventsBanner";
import type { Period } from "@/components/dashboard/FilterBar";
import type { Role } from "@/types";

function sevenDaysAgoISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ConfirmationFlowWorkspaceProps {
  role: Role;
  marketId: string | null;
}

export function ConfirmationFlowWorkspace({ role, marketId }: ConfirmationFlowWorkspaceProps) {
  const t = useTranslations("confirmationFlow");
  const [period, setPeriod] = useState<Period>({
    from_date: sevenDaysAgoISO(),
    to_date: todayISO(),
  });
  const [preset, setPreset] = useState<TeamPeriodPreset>("7d");

  const {
    data: overview,
    isLoading,
    mutate: mutateOverview,
  } = useConfirmationFlowOverview({
    marketId,
    from: period.from_date,
    to: period.to_date,
  });

  const {
    rows: callbackRows,
    isLoading: callbacksLoading,
    mutate: mutateCallbacks,
  } = useCallbacksDueSoon(marketId, 30);

  const { updateCount, flush } = useConfirmationFlowRealtime({
    marketId,
    mutateOverview,
    mutateCallbacks,
  });

  const empty: OverviewResponse = {
    funnel: [],
    stage_transitions: [],
    agents: [],
    ttfc_distribution: { bucket_minutes: [], counts_total: [], counts_by_agent: {} },
    window: { from: period.from_date, to: period.to_date },
    computed_at: "",
  };
  const data = overview ?? empty;

  return (
    <div style={{ padding: "24px 28px", background: "#F6F6F7", minHeight: "100vh" }}>
      <NewEventsBanner count={updateCount} onFlush={flush} />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "#1A1A1A",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {t("title")}
          </h1>
          <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
            {t("subtitle")}
          </p>
        </div>
        <TeamPeriodSelector
          period={period}
          activePreset={preset}
          onChange={(p, pr) => {
            setPeriod(p);
            setPreset(pr);
          }}
        />
      </div>

      {isLoading && (
        <div style={{ color: "#6D7175", fontSize: 13, marginBottom: 16 }}>
          {t("loading")}
        </div>
      )}

      {/* Top row: funnel + callbacks */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        {data.funnel.length > 0 && (
          <FunnelChart funnel={data.funnel} marketId={marketId ?? ""} />
        )}
        <CallbacksDueSoon rows={callbackRows} isLoading={callbacksLoading} />
      </div>

      {/* Agent struggling table */}
      {data.agents.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <AgentStrugglingTable
            agents={data.agents}
            marketId={marketId}
            onReassignDone={() => {
              void mutateOverview();
              void mutateCallbacks();
            }}
          />
        </div>
      )}

      {/* TTFC distribution */}
      {data.agents.length > 0 && (
        <TtfcDistribution
          distribution={data.ttfc_distribution}
          agents={data.agents}
        />
      )}

      {!isLoading && data.computed_at && (
        <div
          style={{
            marginTop: 16,
            fontSize: 11,
            color: "#9CA3AF",
            textAlign: "end",
          }}
        >
          {t("computedAt")} {new Date(data.computed_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

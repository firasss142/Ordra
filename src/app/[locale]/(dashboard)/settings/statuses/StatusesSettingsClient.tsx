"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { StatusEditor } from "@/components/settings/statuses/StatusEditor";
import type { AuthUser } from "@/types";
import type { StatusScope } from "@/types/status-config";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface Props {
  user: AuthUser;
  initialMarkets: Market[];
  initialMarketId: string;
}

export function StatusesSettingsClient({
  user,
  initialMarkets,
  initialMarketId,
}: Props) {
  const t = useTranslations("settings.statuses");
  const [selectedMarketId, setSelectedMarketId] = useState(initialMarketId);
  const [scope, setScope] = useState<StatusScope>("prospect");
  const isSuperAdmin = user.role === "super_admin";

  return (
    <div
      style={{
        padding: 24,
        backgroundColor: "#F6F6F7",
        minHeight: "100vh",
        direction: user.direction === "rtl" ? "rtl" : "ltr",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1A1A1A", margin: "0 0 4px 0" }}>
          {t("title")}
        </h1>
        <div style={{ fontSize: 13, color: "#6D7175" }}>{t("subtitle")}</div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        {isSuperAdmin && initialMarkets.length > 0 && (
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#6D7175" }}>{t("market")}</span>
            <select
              value={selectedMarketId}
              onChange={(e) => setSelectedMarketId(e.target.value)}
              style={{
                height: 32,
                padding: "0 8px",
                border: "1px solid #E1E3E5",
                borderRadius: 6,
                fontSize: 13,
                backgroundColor: "#FFFFFF",
              }}
            >
              {initialMarkets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div
          role="tablist"
          style={{
            display: "inline-flex",
            borderRadius: 6,
            border: "1px solid #E1E3E5",
            backgroundColor: "#FFFFFF",
            overflow: "hidden",
          }}
        >
          {(["prospect", "follow_up"] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={scope === s}
              onClick={() => setScope(s)}
              style={{
                padding: "8px 16px",
                border: "none",
                backgroundColor: scope === s ? "#1A1A1A" : "transparent",
                color: scope === s ? "#FFFFFF" : "#1A1A1A",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                transition: "background-color 120ms",
              }}
            >
              {t(`scope.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {selectedMarketId ? (
        <StatusEditor
          marketId={selectedMarketId}
          scope={scope}
          locale={user.locale}
        />
      ) : (
        <div style={{ padding: 24, color: "#6D7175", fontSize: 13 }}>
          {t("pickMarket")}
        </div>
      )}
    </div>
  );
}

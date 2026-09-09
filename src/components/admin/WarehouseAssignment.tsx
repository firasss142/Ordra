"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useWarehouseSites } from "@/hooks/useWarehouseSites";

/**
 * Which building a warehouse agent works out of.
 *
 * Libya prepares and hands over from two buildings, Tripoli and Benghazi, one
 * per Darb Assabil account. They are not interchangeable: a parcel booked on the
 * Benghazi account and handed to Darb Tripoli does not exist in Darb's system,
 * so it cannot be tracked, paid, or returned. The building therefore decides
 * which parcels an agent may touch at all — it is a safety control, not a
 * preference.
 *
 * `users.warehouse_id` has existed since 20260922000010, but nothing could write
 * it, so agents sat unassigned; an unassigned agent used to be shown BOTH
 * buildings' parcels, with the scan guard inert. This control is the fix, and
 * the warning below is what makes the remaining unassigned agents visible.
 */

interface Props {
  /** The agent's market — a building from another market is never offered. */
  marketId: string | null;
  warehouseId: string | null;
  /** null un-assigns. Rejects on failure so the caller can show it. */
  onChange: (warehouseId: string | null) => Promise<void>;
  disabled?: boolean;
}

export function WarehouseAssignment({ marketId, warehouseId, onChange, disabled }: Props) {
  const t = useTranslations("users");
  const { sites, isLoading } = useWarehouseSites(marketId);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handle(next: string) {
    setFailed(false);
    setSaving(true);
    try {
      // An empty option means "no building", which is null — never "".
      await onChange(next === "" ? null : next);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <label
        style={{ fontSize: 12, color: "#6D7175" }}
        htmlFor={`warehouse-${marketId ?? "none"}`}
      >
        {t("warehouse")}
      </label>

      <select
        id={`warehouse-${marketId ?? "none"}`}
        aria-label={t("warehouse")}
        value={warehouseId ?? ""}
        disabled={disabled || saving || isLoading}
        onChange={(e) => void handle(e.target.value)}
        style={{
          fontSize: 13,
          padding: "4px 8px",
          borderRadius: 4,
          border: "1px solid #E1E3E5",
          background: "white",
          color: "#1A1A1A",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        <option value="">{t("warehousePlaceholder")}</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      {/*
        The loud empty state. An unassigned agent's bench is deliberately empty,
        so without this the manager sees no reason for an agent reporting no work.
      */}
      {!warehouseId && !saving && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: "2px 7px",
            borderRadius: 4,
            background: "#FEF2F2",
            color: "#B91C1C",
          }}
        >
          {t("warehouseNone")}
        </span>
      )}

      {saving && <span style={{ fontSize: 12, color: "#6D7175" }}>{t("warehouseSaving")}</span>}
      {failed && <span style={{ fontSize: 12, color: "#B91C1C" }}>{t("warehouseError")}</span>}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { MarketSettings, ShiftConfig, AssignmentAlgorithm } from "@/types/settings";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_SHIFT_CONFIG } from "@/types/settings";
import type { Role } from "@/types";
import { canEditCosts } from "@/lib/role-permissions";
import { ChangeHistoryPopover } from "./ChangeHistoryPopover";
import { PreviewBanner } from "./PreviewBanner";
import { ShiftConfigEditor } from "./ShiftConfigEditor";
import { StatusLabelWysiwyg } from "./StatusLabelWysiwyg";

type Group = "operations" | "finance" | "team" | "labels";

const GROUPS: { key: Group; label: string; description: string }[] = [
  { key: "operations", label: "Opérations", description: "Tentatives, rappels, inactivité" },
  { key: "finance", label: "Finance", description: "Frais et coûts par commande" },
  { key: "team", label: "Équipe", description: "Affectation et heures ouvrées" },
  { key: "labels", label: "Libellés", description: "Noms des statuts dans chaque langue" },
];

const ALGORITHM_OPTIONS: { value: AssignmentAlgorithm; label: string; available: boolean }[] = [
  { value: "manual", label: "Manuel", available: true },
  { value: "round_robin", label: "Round Robin", available: true },
  { value: "workload", label: "Charge de travail", available: true },
  { value: "product_based", label: "Par produit — bientôt disponible", available: false },
  { value: "region_based", label: "Par région — bientôt disponible", available: false },
];

interface Props {
  initialValues: MarketSettings;
  marketId: string;
  role: Role;
}

function SettingField({
  label,
  marketId,
  settingKey,
  children,
  onReset,
}: {
  label: string;
  marketId: string;
  settingKey: string;
  children: React.ReactNode;
  onReset?: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: "#1A1A1A" }}>{label}</label>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              style={{ background: "none", border: "none", fontSize: 12, color: "#2C6ECB", cursor: "pointer", padding: 0 }}
            >
              Réinitialiser
            </button>
          )}
          <ChangeHistoryPopover marketId={marketId} settingKey={settingKey} />
        </div>
      </div>
      {children}
    </div>
  );
}

export function GeneralSettingsGroups({ initialValues, marketId, role }: Props) {
  const showCosts = canEditCosts(role);
  const [group, setGroup] = useState<Group>("operations");
  const [values, setValues] = useState<MarketSettings>({
    ...DEFAULT_MARKET_SETTINGS,
    ...initialValues,
    shift_config: initialValues.shift_config ?? DEFAULT_SHIFT_CONFIG,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState<Group | null>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const set = <K extends keyof MarketSettings>(key: K, value: MarketSettings[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  async function saveGroup(g: Group) {
    setSaving(g);
    setSuccessMsg("");
    setErrorMsg("");

    const payload: Partial<MarketSettings> = {};
    if (g === "operations") {
      payload.max_call_attempts = values.max_call_attempts;
      payload.attempt_retry_times = values.attempt_retry_times ?? [];
      if (values.agent_inactivity_minutes !== undefined) {
        payload.agent_inactivity_minutes = values.agent_inactivity_minutes;
      }
    } else if (g === "finance") {
      payload.delivery_fee = values.delivery_fee;
      payload.return_fee = values.return_fee;
      payload.packing_cost = values.packing_cost;
    } else if (g === "team") {
      payload.assignment_algorithm = values.assignment_algorithm;
      payload.active_agents_only = values.active_agents_only ?? false;
      if (values.shift_config) payload.shift_config = values.shift_config;
    }

    const full: MarketSettings = {
      ...DEFAULT_MARKET_SETTINGS,
      ...values,
      ...payload,
    };

    try {
      const res = await fetch(`/api/settings/${marketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(full),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg((body as { error?: string }).error ?? "Erreur lors de l'enregistrement");
      } else {
        setSuccessMsg("Paramètres enregistrés");
        setTimeout(() => setSuccessMsg(""), 3000);
      }
    } catch {
      setErrorMsg("Erreur réseau — veuillez réessayer");
    } finally {
      setSaving(null);
    }
  }

  function resetGroup(g: Group) {
    setValues((v) => {
      const next = { ...v };
      if (g === "operations") {
        next.max_call_attempts = DEFAULT_MARKET_SETTINGS.max_call_attempts;
        next.attempt_retry_times = [];
        next.agent_inactivity_minutes = undefined;
      } else if (g === "finance") {
        next.delivery_fee = 0;
        next.return_fee = 0;
        next.packing_cost = 0;
      } else if (g === "team") {
        next.assignment_algorithm = "manual";
        next.active_agents_only = false;
        next.shift_config = DEFAULT_SHIFT_CONFIG;
      }
      return next;
    });
  }

  const retryTimes = values.attempt_retry_times ?? [];

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid #E1E3E5",
          marginBottom: 20,
        }}
      >
        {GROUPS.filter((g) => g.key !== "finance" || showCosts).map((g) => {
          const active = group === g.key;
          return (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setGroup(g.key)}
              style={{
                padding: "10px 14px",
                border: "none",
                background: "none",
                color: active ? "#1A1A1A" : "#6D7175",
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                borderBottom: active ? "2px solid #1A1A1A" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {group === "operations" && (
        <section style={sectionStyle}>
          <GroupHeader
            label="Opérations"
            description="Nombre maximal de tentatives d'appel et plages de rappel."
            onReset={() => resetGroup("operations")}
          />
          <SettingField label="Tentatives max" marketId={marketId} settingKey="max_call_attempts">
            <input
              type="number"
              min={1}
              max={10}
              value={values.max_call_attempts}
              onChange={(e) => set("max_call_attempts", Number(e.target.value))}
              style={{ ...inputStyle, width: 120 }}
            />
            <PreviewBanner
              marketId={marketId}
              currentValue={initialValues.max_call_attempts}
              pendingValue={values.max_call_attempts}
            />
          </SettingField>

          <SettingField label="Heures de rappel automatique" marketId={marketId} settingKey="attempt_retry_times">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {retryTimes.map((t, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8 }}>
                  <input
                    type="time"
                    value={t}
                    onChange={(e) => {
                      const next = [...retryTimes];
                      next[idx] = e.target.value;
                      set("attempt_retry_times", next);
                    }}
                    style={{ ...inputStyle, width: 140 }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        "attempt_retry_times",
                        retryTimes.filter((_, i) => i !== idx),
                      )
                    }
                    style={linkBtn}
                  >
                    Retirer
                  </button>
                </div>
              ))}
              {retryTimes.length < 3 && (
                <button
                  type="button"
                  onClick={() => set("attempt_retry_times", [...retryTimes, ""])}
                  style={{
                    alignSelf: "flex-start",
                    background: "none",
                    border: "1px dashed #9CA3AF",
                    borderRadius: 6,
                    color: "#1A1A1A",
                    cursor: "pointer",
                    fontSize: 13,
                    padding: "6px 12px",
                  }}
                >
                  + Ajouter un créneau
                </button>
              )}
            </div>
          </SettingField>

          <AdvancedToggle open={showAdvanced} onToggle={() => setShowAdvanced((v) => !v)} />
          {showAdvanced && (
            <SettingField
              label="Seuil d'inactivité agent (minutes)"
              marketId={marketId}
              settingKey="agent_inactivity_minutes"
            >
              <input
                type="number"
                min={1}
                placeholder="ex: 30"
                value={values.agent_inactivity_minutes ?? ""}
                onChange={(e) =>
                  set("agent_inactivity_minutes", e.target.value === "" ? undefined : Number(e.target.value))
                }
                style={{ ...inputStyle, width: 120 }}
              />
            </SettingField>
          )}

          <SaveBar
            saving={saving === "operations"}
            onSave={() => saveGroup("operations")}
            successMsg={successMsg}
            errorMsg={errorMsg}
          />
        </section>
      )}

      {group === "finance" && showCosts && (
        <section style={sectionStyle}>
          <GroupHeader
            label="Finance"
            description="Frais et coûts utilisés pour le calcul de rentabilité."
            onReset={() => resetGroup("finance")}
          />
          <SettingField label="Frais de livraison (TND)" marketId={marketId} settingKey="delivery_fee">
            <input
              type="number"
              step="0.01"
              value={values.delivery_fee}
              onChange={(e) => set("delivery_fee", Number(e.target.value))}
              style={{ ...inputStyle, width: 160 }}
            />
          </SettingField>
          <SettingField label="Frais de retour (TND)" marketId={marketId} settingKey="return_fee">
            <input
              type="number"
              step="0.01"
              value={values.return_fee}
              onChange={(e) => set("return_fee", Number(e.target.value))}
              style={{ ...inputStyle, width: 160 }}
            />
          </SettingField>
          <SettingField label="Coût d'emballage (TND)" marketId={marketId} settingKey="packing_cost">
            <input
              type="number"
              step="0.01"
              value={values.packing_cost}
              onChange={(e) => set("packing_cost", Number(e.target.value))}
              style={{ ...inputStyle, width: 160 }}
            />
          </SettingField>
          <SaveBar
            saving={saving === "finance"}
            onSave={() => saveGroup("finance")}
            successMsg={successMsg}
            errorMsg={errorMsg}
          />
        </section>
      )}

      {group === "team" && (
        <section style={sectionStyle}>
          <GroupHeader
            label="Équipe"
            description="Comment les commandes sont réparties et quand l'équipe est en poste."
            onReset={() => resetGroup("team")}
          />
          <SettingField
            label="Algorithme d'affectation"
            marketId={marketId}
            settingKey="assignment_algorithm"
          >
            <select
              value={values.assignment_algorithm}
              onChange={(e) => set("assignment_algorithm", e.target.value as AssignmentAlgorithm)}
              style={{ ...inputStyle, width: 280, cursor: "pointer" }}
            >
              {ALGORITHM_OPTIONS.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={!opt.available}
                  style={opt.available ? {} : { color: "#9CA3AF" }}
                >
                  {opt.label}
                </option>
              ))}
            </select>
          </SettingField>

          {values.assignment_algorithm !== "manual" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={values.active_agents_only ?? false}
                onChange={(e) => set("active_agents_only", e.target.checked)}
              />
              <span style={{ fontSize: 13, color: "#1A1A1A" }}>
                Agents actifs uniquement
              </span>
            </label>
          )}

          <SettingField label="Heures ouvrées" marketId={marketId} settingKey="shift_config">
            <ShiftConfigEditor
              value={values.shift_config ?? DEFAULT_SHIFT_CONFIG}
              onChange={(next: ShiftConfig) => set("shift_config", next)}
            />
          </SettingField>

          <SaveBar
            saving={saving === "team"}
            onSave={() => saveGroup("team")}
            successMsg={successMsg}
            errorMsg={errorMsg}
          />
        </section>
      )}

      {group === "labels" && (
        <section style={sectionStyle}>
          <GroupHeader
            label="Libellés des statuts"
            description="Nom affiché pour chaque statut. L'aperçu est identique à ce que verront agents et managers."
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            {(["prospect", "follow_up"] as const).map((s, idx) => (
              <LabelScopePanel key={s} marketId={marketId} scope={s} defaultOpen={idx === 0} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LabelScopePanel({
  marketId,
  scope,
  defaultOpen,
}: {
  marketId: string;
  scope: "prospect" | "follow_up";
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ flex: 1, border: "1px solid #E1E3E5", borderRadius: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          padding: "10px 14px",
          background: "none",
          border: "none",
          textAlign: "start",
          fontSize: 14,
          fontWeight: 500,
          color: "#1A1A1A",
          cursor: "pointer",
          borderBottom: open ? "1px solid #E1E3E5" : "none",
        }}
      >
        {scope === "prospect" ? "Prospection" : "Suivi"} {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ padding: 12 }}>
          <StatusLabelWysiwyg marketId={marketId} scope={scope} />
        </div>
      )}
    </div>
  );
}

function GroupHeader({
  label,
  description,
  onReset,
}: {
  label: string;
  description: string;
  onReset?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        borderBottom: "1px solid #F4F5F6",
        paddingBottom: 12,
        marginBottom: 4,
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>{label}</h2>
        <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#6D7175" }}>{description}</p>
      </div>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          style={{
            background: "none",
            border: "1px solid #E1E3E5",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            color: "#1A1A1A",
            cursor: "pointer",
          }}
        >
          Réinitialiser ce groupe
        </button>
      )}
    </div>
  );
}

function AdvancedToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        alignSelf: "flex-start",
        background: "none",
        border: "none",
        color: "#2C6ECB",
        fontSize: 13,
        cursor: "pointer",
        padding: 0,
      }}
    >
      {open ? "− Masquer les paramètres avancés" : "+ Afficher les paramètres avancés"}
    </button>
  );
}

function SaveBar({
  saving,
  onSave,
  successMsg,
  errorMsg,
}: {
  saving: boolean;
  onSave: () => void;
  successMsg: string;
  errorMsg: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        style={{
          backgroundColor: saving ? "#9CA3AF" : "#1A1A1A",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 6,
          padding: "8px 16px",
          fontSize: 14,
          fontWeight: 500,
          cursor: saving ? "not-allowed" : "pointer",
        }}
      >
        {saving ? "Enregistrement…" : "Enregistrer"}
      </button>
      {successMsg && <span style={{ fontSize: 13, color: "#008060" }}>{successMsg}</span>}
      {errorMsg && <span style={{ fontSize: 13, color: "#D72C0D" }}>{errorMsg}</span>}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const inputStyle: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  fontSize: 14,
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  backgroundColor: "#FFFFFF",
  outline: "none",
  boxSizing: "border-box",
};

const linkBtn: React.CSSProperties = {
  background: "none",
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  padding: "0 12px",
  height: 36,
  fontSize: 13,
  color: "#6B7280",
  cursor: "pointer",
};

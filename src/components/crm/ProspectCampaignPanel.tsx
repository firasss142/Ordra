"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X, Plus, Play } from "lucide-react";
import { useProspectCampaigns, type ProspectCampaign } from "@/hooks/useProspectCampaigns";

interface Props {
  open: boolean;
  onClose: () => void;
  marketId: string | null;
  onSpawn?: (campaignId: string, inserted: number, skipped: number) => void;
}

export function ProspectCampaignPanel({
  open,
  onClose,
  marketId,
  onSpawn,
}: Props) {
  const t = useTranslations("crm.prospectCampaigns");
  const { campaigns, mutate } = useProspectCampaigns({ marketId, enabled: open });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const runCampaign = async (c: ProspectCampaign) => {
    setRunning(c.id);
    setError(null);
    try {
      const res = await fetch(`/api/leads/campaigns/${c.id}/run`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Run failed");
      setBanner(t("runSummary", { inserted: j.data.inserted, skipped: j.data.skipped }));
      onSpawn?.(c.id, j.data.inserted, j.data.skipped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(null);
    }
  };

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.25)",
          zIndex: 900,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          backgroundColor: "#FFFFFF",
          boxShadow: "-8px 0 24px rgba(0,0,0,0.1)",
          display: "flex",
          flexDirection: "column",
          zIndex: 950,
        }}
      >
        <header
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #E1E3E5",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("title")}</h2>
            <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
              {t("subtitle")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#6D7175",
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ padding: "12px 20px" }}>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              border: "1px solid #1A1A1A",
              borderRadius: 6,
              backgroundColor: "#1A1A1A",
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <Plus size={14} />
            {t("new")}
          </button>
        </div>

        {banner && (
          <div
            style={{
              margin: "0 20px 8px",
              padding: "8px 12px",
              backgroundColor: "#F1F8F5",
              border: "1px solid #B3E1CB",
              borderRadius: 6,
              color: "#008060",
              fontSize: 13,
            }}
          >
            {banner}
          </div>
        )}
        {error && (
          <div
            role="alert"
            style={{
              margin: "0 20px 8px",
              padding: "8px 12px",
              backgroundColor: "#FFF5F5",
              border: "1px solid #F0B6B4",
              borderRadius: 6,
              color: "#D72C0D",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
          {campaigns.length === 0 ? (
            <div style={{ padding: 24, color: "#6D7175", fontSize: 13, textAlign: "center" }}>
              {t("empty")}
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {campaigns.map((c) => (
                <li
                  key={c.id}
                  style={{
                    padding: "12px",
                    border: "1px solid #E1E3E5",
                    borderRadius: 6,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "#6D7175", marginTop: 4 }}>
                    {new Date(c.created_at).toLocaleDateString()}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#6D7175",
                      marginTop: 4,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {JSON.stringify(c.filter_json)}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => runCampaign(c)}
                      disabled={running === c.id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "6px 10px",
                        border: "1px solid #E1E3E5",
                        borderRadius: 4,
                        backgroundColor: "#FFFFFF",
                        color: "#1A1A1A",
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: running === c.id ? "wait" : "pointer",
                      }}
                    >
                      <Play size={12} />
                      {running === c.id ? "…" : t("run")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {wizardOpen && (
        <NewProspectCampaignWizard
          marketId={marketId}
          onClose={() => setWizardOpen(false)}
          onCreated={async () => {
            setWizardOpen(false);
            await mutate();
          }}
        />
      )}
    </>
  );
}

function NewProspectCampaignWizard({
  marketId,
  onClose,
  onCreated,
}: {
  marketId: string | null;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const t = useTranslations("crm.prospectCampaigns");
  const [name, setName] = useState("");
  const [orderStatuses, setOrderStatuses] = useState<string[]>(["delivered"]);
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filterJson = () => {
    const f: Record<string, unknown> = { order_statuses: orderStatuses };
    if (dateFrom) f.date_from = new Date(dateFrom).toISOString();
    if (dateTo) f.date_to = new Date(dateTo + "T23:59:59").toISOString();
    return f;
  };

  const runPreview = async () => {
    if (!marketId) return;
    setError(null);
    try {
      const res = await fetch("/api/leads/campaigns/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: marketId, filter_json: filterJson() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Preview failed");
      setPreviewCount(j.data.matched);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    }
  };

  const create = async () => {
    if (!marketId || !name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/leads/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market_id: marketId,
          name: name.trim(),
          filter_json: filterJson(),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Create failed");
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = (s: string) => {
    setOrderStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
    setPreviewCount(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
      }}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 8,
          padding: 20,
          minWidth: 440,
          maxWidth: 520,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t("wizardTitle")}</h2>
        <div style={{ fontSize: 13, color: "#6D7175", marginTop: 4, marginBottom: 16 }}>
          {t("wizardSubtitle")}
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: "8px 12px",
              marginBottom: 12,
              backgroundColor: "#FFF5F5",
              border: "1px solid #F0B6B4",
              borderRadius: 6,
              color: "#D72C0D",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#6D7175" }}>{t("name")}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              style={input}
            />
          </label>

          <div>
            <div style={{ fontSize: 12, color: "#6D7175", marginBottom: 6 }}>
              {t("orderStatuses")}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["delivered", "returned"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  style={{
                    padding: "6px 12px",
                    border: "1px solid #E1E3E5",
                    borderRadius: 999,
                    backgroundColor: orderStatuses.includes(s) ? "#1A1A1A" : "#FFFFFF",
                    color: orderStatuses.includes(s) ? "#FFFFFF" : "#1A1A1A",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
              <span style={{ fontSize: 12, color: "#6D7175" }}>{t("dateFrom")}</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPreviewCount(null);
                }}
                style={input}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
              <span style={{ fontSize: 12, color: "#6D7175" }}>{t("dateTo")}</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPreviewCount(null);
                }}
                style={input}
              />
            </label>
          </div>

          <div
            style={{
              padding: 12,
              backgroundColor: "#FAFBFB",
              border: "1px solid #E1E3E5",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: 13 }}>
              {previewCount === null
                ? t("previewIdle")
                : t("previewResult", { count: previewCount })}
            </div>
            <button
              type="button"
              onClick={runPreview}
              style={secondaryBtn}
              disabled={orderStatuses.length === 0}
            >
              {t("preview")}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 20,
          }}
        >
          <button type="button" onClick={onClose} style={secondaryBtn}>
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={create}
            disabled={!name.trim() || !marketId || submitting}
            style={{
              ...primaryBtn,
              opacity: !name.trim() || !marketId ? 0.5 : 1,
            }}
          >
            {submitting ? "…" : t("create")}
          </button>
        </div>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  fontSize: 13,
  backgroundColor: "#FFFFFF",
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #1A1A1A",
  borderRadius: 6,
  backgroundColor: "#1A1A1A",
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  backgroundColor: "#FFFFFF",
  color: "#1A1A1A",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

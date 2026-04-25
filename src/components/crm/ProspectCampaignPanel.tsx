"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  X,
  Plus,
  Play,
  Megaphone,
  Users,
  Calendar,
  Tag,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { useProspectCampaigns, type ProspectCampaign } from "@/hooks/useProspectCampaigns";

interface Props {
  open: boolean;
  onClose: () => void;
  marketId: string | null;
  onSpawn?: (campaignId: string, inserted: number, skipped: number) => void;
}

const BORDER = "#E1E3E5";
const TEXT = "#1A1A1A";
const MUTED = "#6D7175";
const SUBTLE_BG = "#F6F6F7";
const CARD_BG = "#FFFFFF";

export function ProspectCampaignPanel({
  open,
  onClose,
  marketId,
  onSpawn,
}: Props) {
  const t = useTranslations("crm.prospectCampaigns");
  const { campaigns, mutate } = useProspectCampaigns({ marketId, enabled: open });
  const { campaigns: attributionCampaigns, isLoading: attributionLoading } = useProspectCampaigns({
    marketId,
    enabled: open,
    includeAttribution: true,
  });
  const [activeTab, setActiveTab] = useState<"campaigns" | "attribution">("campaigns");
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
          backgroundColor: "rgba(0,0,0,0.35)",
          zIndex: 900,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          insetInlineEnd: 0,
          bottom: 0,
          width: 460,
          backgroundColor: CARD_BG,
          boxShadow: "-12px 0 32px rgba(0,0,0,0.12)",
          display: "flex",
          flexDirection: "column",
          zIndex: 950,
        }}
      >
        <header
          style={{
            padding: "20px 24px 16px",
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: SUBTLE_BG,
                border: `1px solid ${BORDER}`,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: TEXT,
                flexShrink: 0,
              }}
            >
              <Megaphone size={18} strokeWidth={1.75} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: TEXT }}>
                {t("title")}
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: MUTED, lineHeight: 1.4 }}>
                {t("subtitle")}
              </p>
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
              color: MUTED,
              padding: 4,
              flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </header>

        <div
          style={{
            display: "flex",
            gap: 0,
            borderBottom: `1px solid ${BORDER}`,
            padding: "0 24px",
          }}
        >
          {(["campaigns", "attribution"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "10px 14px",
                border: "none",
                borderBottom: activeTab === tab ? `2px solid ${TEXT}` : "2px solid transparent",
                background: "none",
                fontSize: 13,
                fontWeight: activeTab === tab ? 600 : 500,
                color: activeTab === tab ? TEXT : MUTED,
                cursor: "pointer",
                marginBottom: -1,
                fontFamily: "inherit",
              }}
            >
              {tab === "campaigns" ? t("campaigns") : t("attribution")}
            </button>
          ))}
        </div>

        {activeTab === "attribution" ? (
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
            {attributionLoading ? (
              <div style={{ color: MUTED, fontSize: 13 }}>…</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["campaigns", "leadsCreated", "leadsWon", "conversionRate", "adSpend", "costPerConversion"].map((col) => (
                      <th
                        key={col}
                        style={{
                          padding: "8px",
                          textAlign: col === "campaigns" ? "start" : "end",
                          fontSize: 11,
                          fontWeight: 500,
                          color: MUTED,
                          borderBottom: `1px solid ${BORDER}`,
                          whiteSpace: "nowrap",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {t(col as Parameters<typeof t>[0])}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attributionCampaigns.map((c) => (
                    <tr key={c.id}>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid #F2F2F2", fontWeight: 500 }}>{c.name}</td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid #F2F2F2", textAlign: "end", fontVariantNumeric: "tabular-nums" }}>{c.leads_created ?? "—"}</td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid #F2F2F2", textAlign: "end", fontVariantNumeric: "tabular-nums" }}>{c.leads_won ?? "—"}</td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid #F2F2F2", textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                        {c.conversion_rate != null ? `${(c.conversion_rate * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid #F2F2F2", textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                        {c.total_ad_spend != null ? c.total_ad_spend.toFixed(0) : "—"}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid #F2F2F2", textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                        {c.cost_per_conversion != null ? c.cost_per_conversion.toFixed(1) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <>
            <div style={{ padding: "16px 24px 8px" }}>
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  border: `1px solid ${TEXT}`,
                  borderRadius: 8,
                  backgroundColor: TEXT,
                  color: "#FFFFFF",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <Plus size={14} strokeWidth={2} />
                {t("new")}
              </button>
            </div>

            {banner && (
              <div
                style={{
                  margin: "0 24px 8px",
                  padding: "10px 12px",
                  backgroundColor: "#F1F8F5",
                  border: "1px solid #B3E1CB",
                  borderRadius: 8,
                  color: "#008060",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <CheckCircle2 size={15} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{banner}</span>
              </div>
            )}
            {error && (
              <div
                role="alert"
                style={{
                  margin: "0 24px 8px",
                  padding: "10px 12px",
                  backgroundColor: "#FFF4F4",
                  border: "1px solid #F0B6B4",
                  borderRadius: 8,
                  color: "#D72C0D",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <AlertCircle size={15} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            )}

            <div style={{ flex: 1, overflowY: "auto", padding: "8px 24px 24px" }}>
              {campaigns.length === 0 ? (
                <EmptyCampaignsState
                  title={t("empty")}
                  hint={t("emptyHint")}
                  ctaLabel={t("new")}
                  onCta={() => setWizardOpen(true)}
                />
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {campaigns.map((c) => (
                    <CampaignCard
                      key={c.id}
                      campaign={c}
                      running={running === c.id}
                      onRun={() => runCampaign(c)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
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

function EmptyCampaignsState({
  title,
  hint,
  ctaLabel,
  onCta,
}: {
  title: string;
  hint: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div
      style={{
        padding: "32px 16px",
        background: SUBTLE_BG,
        border: `1px dashed ${BORDER}`,
        borderRadius: 10,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 999,
          background: CARD_BG,
          border: `1px solid ${BORDER}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: MUTED,
        }}
      >
        <Sparkles size={18} strokeWidth={1.75} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{title}</div>
      <div style={{ fontSize: 12, color: MUTED, maxWidth: 280, lineHeight: 1.5 }}>{hint}</div>
      <button
        type="button"
        onClick={onCta}
        style={{
          marginTop: 4,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 12px",
          border: `1px solid ${TEXT}`,
          borderRadius: 8,
          background: TEXT,
          color: "#FFFFFF",
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <Plus size={13} strokeWidth={2} />
        {ctaLabel}
      </button>
    </div>
  );
}

function CampaignCard({
  campaign,
  running,
  onRun,
}: {
  campaign: ProspectCampaign;
  running: boolean;
  onRun: () => void;
}) {
  const t = useTranslations("crm.prospectCampaigns");
  const summary = useFilterSummary(campaign.filter_json);

  const createdLabel = useMemo(() => {
    try {
      const d = new Date(campaign.created_at);
      return t("createdOn", { date: d.toLocaleDateString() });
    } catch {
      return "";
    }
  }, [campaign.created_at, t]);

  return (
    <li
      style={{
        padding: 14,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        background: CARD_BG,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: TEXT, lineHeight: 1.3 }}>
            {campaign.name}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{createdLabel}</div>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 12px",
            border: `1px solid ${TEXT}`,
            borderRadius: 8,
            backgroundColor: running ? SUBTLE_BG : TEXT,
            color: running ? MUTED : "#FFFFFF",
            fontSize: 12,
            fontWeight: 500,
            cursor: running ? "wait" : "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          <Play size={11} strokeWidth={2} />
          {running ? "…" : t("run")}
        </button>
      </div>

      {/* Friendly filter summary chips replace JSON */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <SummaryChip icon={<Users size={11} strokeWidth={1.75} />} label={summary.audienceLabel} />
        <SummaryChip icon={<Calendar size={11} strokeWidth={1.75} />} label={summary.rangeLabel} />
      </div>
    </li>
  );
}

function SummaryChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        background: SUBTLE_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        color: TEXT,
      }}
    >
      <span style={{ color: MUTED, display: "inline-flex" }}>{icon}</span>
      {label}
    </span>
  );
}

// ---- Filter summary ----------------------------------------------------------

interface CampaignFilterShape {
  order_statuses?: string[];
  date_from?: string;
  date_to?: string;
}

function useFilterSummary(filter: unknown) {
  const t = useTranslations("crm.prospectCampaigns.filterSummary");
  return useMemo(() => {
    const f = (filter ?? {}) as CampaignFilterShape;
    const statuses = Array.isArray(f.order_statuses) ? f.order_statuses : [];

    let audienceLabel: string;
    if (statuses.length === 0) audienceLabel = t("none");
    else if (statuses.includes("delivered") && statuses.includes("returned"))
      audienceLabel = t("both");
    else if (statuses.includes("delivered")) audienceLabel = t("delivered");
    else if (statuses.includes("returned")) audienceLabel = t("returned");
    else audienceLabel = statuses.join(", ");

    let rangeLabel = "—";
    if (f.date_from && f.date_to) {
      const from = new Date(f.date_from);
      const to = new Date(f.date_to);
      const days = Math.max(
        1,
        Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)),
      );
      if (days <= 400) {
        rangeLabel = t("rangeDays", { days });
      } else {
        rangeLabel = t("rangeCustom", {
          from: from.toLocaleDateString(),
          to: to.toLocaleDateString(),
        });
      }
    }

    return { audienceLabel, rangeLabel };
  }, [filter, t]);
}

// ---- Wizard -----------------------------------------------------------------

const PRESETS: { key: "last30" | "last90" | "last180" | "last365"; days: number }[] = [
  { key: "last30", days: 30 },
  { key: "last90", days: 90 },
  { key: "last180", days: 180 },
  { key: "last365", days: 365 },
];

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
  const tPresets = useTranslations("crm.prospectCampaigns.datePresets");
  const tAud = useTranslations("crm.prospectCampaigns.audiences");

  const [name, setName] = useState("");
  const [orderStatuses, setOrderStatuses] = useState<string[]>(["delivered"]);
  const [dateFrom, setDateFrom] = useState<string>(() => isoDaysAgo(90));
  const [dateTo, setDateTo] = useState<string>(() => isoToday());
  const [activePreset, setActivePreset] = useState<string | null>("last90");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filterJson = () => {
    const f: Record<string, unknown> = { order_statuses: orderStatuses };
    if (dateFrom) f.date_from = new Date(dateFrom).toISOString();
    if (dateTo) f.date_to = new Date(dateTo + "T23:59:59").toISOString();
    return f;
  };

  const applyPreset = (key: string, days: number) => {
    setActivePreset(key);
    setDateFrom(isoDaysAgo(days));
    setDateTo(isoToday());
    setPreviewCount(null);
  };

  const runPreview = async () => {
    if (!marketId) return;
    setError(null);
    setPreviewing(true);
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
    } finally {
      setPreviewing(false);
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
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
    setPreviewCount(null);
  };

  const audiences: {
    key: "delivered" | "returned";
    icon: React.ReactNode;
  }[] = [
    { key: "delivered", icon: <CheckCircle2 size={16} strokeWidth={1.75} /> },
    { key: "returned", icon: <RotateCcw size={16} strokeWidth={1.75} /> },
  ];

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
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: 16,
      }}
    >
      <div
        style={{
          backgroundColor: CARD_BG,
          borderRadius: 12,
          width: "100%",
          maxWidth: 520,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: SUBTLE_BG,
              border: `1px solid ${BORDER}`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Sparkles size={18} strokeWidth={1.75} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: TEXT }}>
              {t("wizardTitle")}
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: MUTED, lineHeight: 1.4 }}>
              {t("wizardSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: MUTED,
              padding: 4,
              flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {error && (
            <div
              role="alert"
              style={{
                padding: "10px 12px",
                backgroundColor: "#FFF4F4",
                border: "1px solid #F0B6B4",
                borderRadius: 8,
                color: "#D72C0D",
                fontSize: 13,
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <AlertCircle size={15} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <Section index={1} icon={<Tag size={14} strokeWidth={1.75} />} label={t("step1")}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              style={inputStyle}
              autoFocus
            />
          </Section>

          <Section index={2} icon={<Users size={14} strokeWidth={1.75} />} label={t("step2")}>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
              {t("orderStatuses")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {audiences.map((a) => {
                const active = orderStatuses.includes(a.key);
                return (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => toggleStatus(a.key)}
                    aria-pressed={active}
                    style={{
                      textAlign: "start",
                      padding: 12,
                      border: `1px solid ${active ? TEXT : BORDER}`,
                      borderRadius: 10,
                      background: active ? TEXT : CARD_BG,
                      color: active ? "#FFFFFF" : TEXT,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      transition: "all 120ms",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          background: active ? "rgba(255,255,255,0.12)" : SUBTLE_BG,
                          color: active ? "#FFFFFF" : TEXT,
                        }}
                      >
                        {a.icon}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{tAud(a.key)}</span>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: active ? "rgba(255,255,255,0.75)" : MUTED,
                        lineHeight: 1.4,
                      }}
                    >
                      {tAud(`${a.key}Hint` as "deliveredHint" | "returnedHint")}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section index={3} icon={<Calendar size={14} strokeWidth={1.75} />} label={t("step3")}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: MUTED, alignSelf: "center", marginInlineEnd: 4 }}>
                {tPresets("label")}:
              </span>
              {PRESETS.map((p) => {
                const active = activePreset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p.key, p.days)}
                    style={{
                      padding: "5px 10px",
                      border: `1px solid ${active ? TEXT : BORDER}`,
                      background: active ? TEXT : CARD_BG,
                      color: active ? "#FFFFFF" : TEXT,
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {tPresets(p.key)}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                <span style={{ fontSize: 11, color: MUTED }}>{t("dateFrom")}</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setActivePreset(null);
                    setPreviewCount(null);
                  }}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                <span style={{ fontSize: 11, color: MUTED }}>{t("dateTo")}</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setActivePreset(null);
                    setPreviewCount(null);
                  }}
                  style={inputStyle}
                />
              </label>
            </div>
          </Section>

          {/* Preview */}
          <PreviewBanner
            count={previewCount}
            previewing={previewing}
            disabled={orderStatuses.length === 0 || previewing}
            onPreview={runPreview}
            idleLabel={t("previewIdle")}
            previewLabel={t("preview")}
            previewingLabel={t("previewing")}
            countLabel={previewCount !== null && previewCount > 0
              ? t("previewResult", { count: previewCount })
              : null}
            emptyLabel={t("previewEmpty")}
          />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: `1px solid ${BORDER}`,
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            background: SUBTLE_BG,
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: 12,
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
              cursor: !name.trim() || !marketId ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "…" : t("create")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  index,
  icon,
  label,
  children,
}: {
  index: number;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 999,
            background: TEXT,
            color: "#FFFFFF",
            fontSize: 11,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {index}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            color: TEXT,
          }}
        >
          <span style={{ color: MUTED, display: "inline-flex" }}>{icon}</span>
          {label}
        </span>
      </div>
      <div style={{ paddingInlineStart: 30 }}>{children}</div>
    </div>
  );
}

function PreviewBanner({
  count,
  previewing,
  disabled,
  onPreview,
  idleLabel,
  previewLabel,
  previewingLabel,
  countLabel,
  emptyLabel,
}: {
  count: number | null;
  previewing: boolean;
  disabled: boolean;
  onPreview: () => void;
  idleLabel: string;
  previewLabel: string;
  previewingLabel: string;
  countLabel: string | null;
  emptyLabel: string;
}) {
  const hasResult = count !== null;
  const isEmpty = hasResult && count === 0;

  return (
    <div
      style={{
        padding: 14,
        background: hasResult && !isEmpty ? "#F1F8F5" : SUBTLE_BG,
        border: `1px solid ${hasResult && !isEmpty ? "#B3E1CB" : BORDER}`,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            background: hasResult && !isEmpty ? "#FFFFFF" : CARD_BG,
            border: `1px solid ${hasResult && !isEmpty ? "#B3E1CB" : BORDER}`,
            color: hasResult && !isEmpty ? "#008060" : MUTED,
            flexShrink: 0,
          }}
        >
          <Users size={14} strokeWidth={1.75} />
        </span>
        <div style={{ minWidth: 0 }}>
          {!hasResult ? (
            <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.4 }}>{idleLabel}</div>
          ) : isEmpty ? (
            <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.4 }}>{emptyLabel}</div>
          ) : (
            <div style={{ fontSize: 14, color: "#008060", fontWeight: 600, lineHeight: 1.3 }}>
              {countLabel}
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onPreview}
        disabled={disabled}
        style={{
          ...secondaryBtn,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
          flexShrink: 0,
        }}
      >
        {previewing ? previewingLabel : previewLabel}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  fontSize: 13,
  backgroundColor: CARD_BG,
  color: TEXT,
  width: "100%",
  fontFamily: "inherit",
  outline: "none",
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  border: `1px solid ${TEXT}`,
  borderRadius: 8,
  backgroundColor: TEXT,
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 14px",
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  backgroundColor: CARD_BG,
  color: TEXT,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

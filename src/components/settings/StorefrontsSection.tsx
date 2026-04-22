"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import FocusTrap from "focus-trap-react";
import { canManageStorefronts } from "@/lib/settings-permissions";
import type { Role } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Storefront {
  id: string;
  market_id: string;
  platform: string;
  name: string;
  config: Record<string, unknown>;
  webhook_secret: string;
  is_active: boolean;
}

interface StorefrontsSectionProps {
  role: Role;
  marketId: string;
}

const MASK = "••••••••";

const PLATFORMS = [
  { value: "easy_orders", label: "Easy Orders" },
  { value: "shopify", label: "Shopify" },
  { value: "woocommerce", label: "WooCommerce" },
];

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "#374151",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: 36,
  padding: "0 12px",
  fontSize: 14,
  border: "1px solid #E1E3E5",
  borderRadius: "0.5rem",
  background: "white",
  outline: "none",
  boxSizing: "border-box",
};

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  textAlign: "start",
  fontSize: 13,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #E1E3E5",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 14,
  color: "#1A1A1A",
  borderBottom: "1px solid #E1E3E5",
};

function getPlatformLabel(value: string): string {
  return PLATFORMS.find((p) => p.value === value)?.label ?? value;
}

export function StorefrontsSection({ role, marketId }: StorefrontsSectionProps) {
  const { data, mutate } = useSWR<{ data: Storefront[] }>(
    marketId ? `/api/storefronts?market_id=${marketId}` : null,
    fetcher
  );

  const storefronts = data?.data ?? [];

  const [panelOpen, setPanelOpen] = useState(false);
  const [editStorefront, setEditStorefront] = useState<Storefront | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const secretsRef = useRef<HTMLDivElement>(null);

  if (!canManageStorefronts(role)) return null;

  function httpError(status: number): string {
    if (status === 401) return "Session expirée — veuillez vous reconnecter";
    if (status === 403) return "Action non autorisée";
    if (status === 409) return "Conflit — rechargez la page";
    return "Erreur";
  }

  const [form, setForm] = useState({
    name: "",
    platform: "easy_orders",
    webhook_url: "",
    webhook_secret: "",
  });

  function openAdd() {
    setEditStorefront(null);
    setForm({ name: "", platform: "easy_orders", webhook_url: "", webhook_secret: "" });
    setErrorMsg("");
    setPanelOpen(true);
  }

  function openEdit(s: Storefront) {
    setEditStorefront(s);
    setForm({
      name: s.name,
      platform: s.platform,
      webhook_url: (s.config?.webhook_url as string) ?? "",
      webhook_secret: MASK,
    });
    setErrorMsg("");
    setPanelOpen(true);
  }

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setEditStorefront(null);
  }, []);

  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [panelOpen, closePanel]);

  async function handleToggleActive(s: Storefront) {
    await mutate(
      (prev) => ({
        data: (prev?.data ?? []).map((x) =>
          x.id === s.id ? { ...x, is_active: !s.is_active } : x
        ),
      }),
      false
    );
    await fetch(`/api/storefronts/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !s.is_active }),
    });
    mutate();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg("");

    try {
      if (editStorefront) {
        const body: Record<string, unknown> = {
          name: form.name,
          platform: form.platform,
          config: { webhook_url: form.webhook_url },
        };
        if (form.webhook_secret !== MASK) {
          body.webhook_secret = form.webhook_secret;
        }
        const res = await fetch(`/api/storefronts/${editStorefront.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          setErrorMsg((b as { error?: string }).error ?? httpError(res.status));
          return;
        }
      } else {
        const res = await fetch("/api/storefronts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            market_id: marketId,
            platform: form.platform,
            name: form.name,
            config: { webhook_url: form.webhook_url },
            webhook_secret: form.webhook_secret,
          }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          setErrorMsg((b as { error?: string }).error ?? httpError(res.status));
          return;
        }
        const created = await res.json().catch(() => ({}));
        const sf = (created as { data?: { id?: string } }).data;
        if (sf?.id) {
          const webhookUrl = `${window.location.origin}/api/webhooks/${sf.id}`;
          setCreatedWebhookUrl(webhookUrl);
          setCreatedSecret(form.webhook_secret || null);
        }
      }

      mutate();
      closePanel();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          Storefronts
        </h2>
        <button
          onClick={openAdd}
          style={{
            backgroundColor: "#1A1A1A",
            color: "white",
            border: "none",
            borderRadius: "0.5rem",
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Ajouter
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Nom</th>
              <th style={thStyle}>Plateforme</th>
              <th style={thStyle}>Webhook URL</th>
              <th style={thStyle}>Secret</th>
              <th style={thStyle}>Actif</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {storefronts.map((s) => (
              <tr
                key={s.id}
                style={{ background: "white" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "#F7F7F7";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "white";
                }}
              >
                <td style={tdStyle}>{s.name}</td>
                <td style={tdStyle}>
                  <span
                    style={{
                      backgroundColor: "#1A1A1A",
                      color: "white",
                      borderRadius: 9999,
                      padding: "2px 8px",
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {getPlatformLabel(s.platform)}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: "#6D7175", fontFamily: "monospace", fontSize: 13 }}>
                  {(s.config?.webhook_url as string) ?? "—"}
                </td>
                <td style={tdStyle}>
                  <span style={{ fontFamily: "monospace", fontSize: 13, color: "#6D7175", marginRight: 8 }}>
                    {MASK}
                  </span>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/api/webhooks/${s.id}`;
                      navigator.clipboard.writeText(url);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#2C6ECB",
                      fontSize: 12,
                      cursor: "pointer",
                      padding: 0,
                    }}
                    title="Copier l'URL webhook"
                  >
                    Copier l&apos;URL
                  </button>
                </td>
                <td style={tdStyle}>
                  <span style={{ color: s.is_active ? "#008060" : "#6D7175", fontSize: 16 }}>●</span>
                </td>
                <td style={tdStyle}>
                  <button
                    onClick={() => openEdit(s)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#2C6ECB",
                      fontSize: 14,
                      cursor: "pointer",
                      padding: 0,
                      marginRight: 12,
                    }}
                  >
                    Modifier
                  </button>
                  <label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={s.is_active}
                      onChange={() => handleToggleActive(s)}
                      style={{ width: 32, height: 18, cursor: "pointer", accentColor: "#1A1A1A" }}
                    />
                  </label>
                </td>
              </tr>
            ))}
            {storefronts.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, color: "#6D7175", textAlign: "center", padding: 32 }}>
                  Aucun storefront configuré
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Slide-in panel */}
      {panelOpen && (
        <>
          <div
            onClick={closePanel}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(26,26,26,0.4)",
              zIndex: 40,
            }}
          />
          <FocusTrap focusTrapOptions={{ allowOutsideClick: true, fallbackFocus: () => panelRef.current ?? document.body }}>
          <div
            ref={panelRef}
            tabIndex={-1}
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: 420,
              backgroundColor: "white",
              borderLeft: "1px solid #E1E3E5",
              zIndex: 50,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #E1E3E5" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
                {editStorefront ? "Modifier le storefront" : "Ajouter un storefront"}
              </h3>
            </div>

            <form
              onSubmit={handleSubmit}
              style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div>
                <label style={labelStyle}>Nom</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Plateforme</label>
                <select
                  value={form.platform}
                  onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  {PLATFORMS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Webhook URL</label>
                <input
                  type="url"
                  value={form.webhook_url}
                  onChange={(e) => setForm((f) => ({ ...f, webhook_url: e.target.value }))}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Webhook Secret</label>
                <input
                  type="password"
                  value={form.webhook_secret}
                  onChange={(e) => setForm((f) => ({ ...f, webhook_secret: e.target.value }))}
                  style={inputStyle}
                  placeholder={editStorefront ? "Laisser tel quel pour ne pas modifier" : ""}
                />
              </div>

              {errorMsg && (
                <p style={{ fontSize: 13, color: "#D72C0D", margin: 0 }}>{errorMsg}</p>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    backgroundColor: "#1A1A1A",
                    color: "white",
                    border: "none",
                    borderRadius: "0.5rem",
                    padding: "8px 16px",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
                <button
                  type="button"
                  onClick={closePanel}
                  style={{
                    backgroundColor: "white",
                    color: "#1A1A1A",
                    border: "1px solid #E1E3E5",
                    borderRadius: "0.5rem",
                    padding: "8px 16px",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
          </FocusTrap>
        </>
      )}

      {/* Secret-revealed-once modal */}
      {(createdSecret !== null || createdWebhookUrl !== null) && (
        <>
          <FocusTrap focusTrapOptions={{ allowOutsideClick: false, fallbackFocus: () => secretsRef.current ?? document.body }}>
          <div
            ref={secretsRef}
            tabIndex={-1}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(26,26,26,0.6)",
              zIndex: 60,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                backgroundColor: "white",
                borderRadius: "0.5rem",
                padding: 32,
                maxWidth: 480,
                width: "90%",
                border: "1px solid #E1E3E5",
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", marginTop: 0 }}>
                Storefront créé — sauvegardez ces informations
              </h3>
              <p style={{ fontSize: 13, color: "#D72C0D", marginBottom: 20 }}>
                Ces informations ne seront plus affichées. Copiez-les maintenant.
              </p>
              {createdWebhookUrl && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#6D7175", marginBottom: 4, textTransform: "uppercase" }}>
                    URL Webhook
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ flex: 1, fontSize: 12, backgroundColor: "#F6F6F7", padding: "8px 12px", borderRadius: "0.375rem", wordBreak: "break-all", color: "#1A1A1A" }}>
                      {createdWebhookUrl}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(createdWebhookUrl)}
                      style={{ background: "none", border: "none", color: "#2C6ECB", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      Copier
                    </button>
                  </div>
                </div>
              )}
              {createdSecret && (
                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#6D7175", marginBottom: 4, textTransform: "uppercase" }}>
                    Secret Webhook
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ flex: 1, fontSize: 12, backgroundColor: "#FFF3CD", padding: "8px 12px", borderRadius: "0.375rem", wordBreak: "break-all", color: "#1A1A1A" }}>
                      {createdSecret}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(createdSecret)}
                      style={{ background: "none", border: "none", color: "#2C6ECB", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      Copier
                    </button>
                  </div>
                </div>
              )}
              <button
                onClick={() => { setCreatedSecret(null); setCreatedWebhookUrl(null); }}
                style={{
                  backgroundColor: "#1A1A1A",
                  color: "white",
                  border: "none",
                  borderRadius: "0.5rem",
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                J&apos;ai sauvegardé ces informations
              </button>
            </div>
          </div>
          </FocusTrap>
        </>
      )}
    </>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import FocusTrap from "focus-trap-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { canManageStorefronts } from "@/lib/settings-permissions";
import {
  HealthBadge,
  computeHealthState,
  formatRelative,
} from "./storefronts/HealthBadge";
import { ConnectionWizard } from "./storefronts/ConnectionWizard";
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
  last_webhook_received_at: string | null;
  last_webhook_status: "processed" | "ignored" | "error" | null;
  last_webhook_error: string | null;
  webhook_failure_count: number;
}

interface StorefrontsSectionProps {
  role: Role;
  marketId: string;
}

const MASK = "••••••••";

function getPlatformLabel(value: string): string {
  const PLATFORMS: Record<string, string> = {
    easy_orders: "Easy Orders",
    shopify: "Shopify",
    woocommerce: "WooCommerce",
  };
  return PLATFORMS[value] ?? value;
}

interface TestResult {
  success: boolean;
  stage: string;
  message: string;
}

export function StorefrontsSection({ role, marketId }: StorefrontsSectionProps) {
  const params = useParams<{ locale: string }>();
  const { data, mutate } = useSWR<{ data: Storefront[] }>(
    marketId ? `/api/storefronts?market_id=${marketId}` : null,
    fetcher,
    { refreshInterval: 30_000 },
  );

  const storefronts = data?.data ?? [];
  const canManage = canManageStorefronts(role);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<
    { webhookUrl: string; secret: string } | null
  >(null);
  const [editStorefront, setEditStorefront] = useState<Storefront | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const secretsRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    name: "",
    platform: "easy_orders",
    webhook_url: "",
    webhook_secret: "",
  });

  function openEdit(s: Storefront) {
    setEditStorefront(s);
    setForm({
      name: s.name,
      platform: s.platform,
      webhook_url: (s.config?.webhook_url as string) ?? "",
      webhook_secret: MASK,
    });
    setErrorMsg("");
  }

  const closeEdit = useCallback(() => {
    setEditStorefront(null);
  }, []);

  useEffect(() => {
    if (!editStorefront) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeEdit();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editStorefront, closeEdit]);

  async function handleToggleActive(s: Storefront) {
    if (!canManage) return;
    await mutate(
      (prev) => ({
        data: (prev?.data ?? []).map((x) =>
          x.id === s.id ? { ...x, is_active: !s.is_active } : x,
        ),
      }),
      false,
    );
    await fetch(`/api/storefronts/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !s.is_active }),
    });
    mutate();
  }

  async function handleTestWebhook(s: Storefront) {
    setTestingId(s.id);
    setTestResults((prev) => ({ ...prev, [s.id]: { ...prev[s.id] } as TestResult }));
    try {
      const res = await fetch(`/api/storefronts/${s.id}/test`, { method: "POST" });
      const body = (await res.json()) as TestResult;
      setTestResults((prev) => ({ ...prev, [s.id]: body }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [s.id]: {
          success: false,
          stage: "network",
          message: "Erreur réseau",
        },
      }));
    } finally {
      setTestingId(null);
    }
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editStorefront) return;
    setSaving(true);
    setErrorMsg("");
    try {
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
        setErrorMsg((b as { error?: string }).error ?? "Erreur");
        return;
      }
      mutate();
      closeEdit();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "#1A1A1A",
              margin: 0,
            }}
          >
            Storefronts
          </h2>
          <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0 0" }}>
            {canManage
              ? "Connectez vos boutiques et surveillez l'état des webhooks."
              : "Vue lecture seule — supervision des webhooks."}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setWizardOpen(true)}
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
            Connecter un storefront
          </button>
        )}
      </div>

      {/* Storefront cards with health dashboard */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {storefronts.map((s) => {
          const state = computeHealthState({
            is_active: s.is_active,
            last_webhook_received_at: s.last_webhook_received_at,
            last_webhook_status: s.last_webhook_status,
            webhook_failure_count: s.webhook_failure_count,
          });
          const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/${s.id}`;
          const test = testResults[s.id];
          return (
            <div
              key={s.id}
              style={{
                border: "1px solid #E1E3E5",
                borderRadius: "0.5rem",
                background: "white",
                padding: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 600, color: "#1A1A1A" }}>
                      {s.name}
                    </span>
                    <span
                      style={{
                        backgroundColor: "#1A1A1A",
                        color: "white",
                        borderRadius: 9999,
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      {getPlatformLabel(s.platform)}
                    </span>
                    <HealthBadge state={state} />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    <HealthStat
                      label="Dernier webhook"
                      value={formatRelative(s.last_webhook_received_at)}
                    />
                    <HealthStat
                      label="Échecs consécutifs"
                      value={String(s.webhook_failure_count)}
                      valueColor={
                        s.webhook_failure_count > 0 ? "#D72C0D" : "#1A1A1A"
                      }
                    />
                    <HealthStat
                      label="Statut"
                      value={
                        s.last_webhook_status === "error"
                          ? "Erreur"
                          : s.last_webhook_status === "processed"
                            ? "Traité"
                            : s.last_webhook_status === "ignored"
                              ? "Ignoré"
                              : "—"
                      }
                    />
                  </div>

                  {s.last_webhook_error && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: "8px 12px",
                        background: "#FDEDEA",
                        borderRadius: "0.375rem",
                        fontSize: 12,
                        color: "#D72C0D",
                      }}
                    >
                      <strong>Dernière erreur :</strong> {s.last_webhook_error}
                    </div>
                  )}

                  {test && (
                    <div
                      role="status"
                      style={{
                        marginTop: 10,
                        padding: "8px 12px",
                        background: test.success ? "#E3F2E8" : "#FDEDEA",
                        color: test.success ? "#008060" : "#D72C0D",
                        borderRadius: "0.375rem",
                        fontSize: 12,
                      }}
                    >
                      {test.success ? "✓ " : "✗ "}
                      {test.message}
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <code
                      style={{
                        fontSize: 11,
                        color: "#6D7175",
                        fontFamily: "monospace",
                        background: "#F6F6F7",
                        padding: "4px 8px",
                        borderRadius: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 320,
                      }}
                      title={webhookUrl}
                    >
                      {webhookUrl}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(webhookUrl)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#2C6ECB",
                        fontSize: 12,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Copier
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    alignItems: "flex-end",
                  }}
                >
                  {canManage && (
                    <>
                      <button
                        onClick={() => handleTestWebhook(s)}
                        disabled={testingId === s.id}
                        style={{
                          background: "white",
                          border: "1px solid #E1E3E5",
                          borderRadius: "0.375rem",
                          padding: "6px 12px",
                          fontSize: 12,
                          cursor: testingId === s.id ? "not-allowed" : "pointer",
                          color: "#1A1A1A",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {testingId === s.id ? "Test…" : "Tester"}
                      </button>
                      <button
                        onClick={() => openEdit(s)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#2C6ECB",
                          fontSize: 12,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        Modifier
                      </button>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          cursor: "pointer",
                          fontSize: 12,
                          color: "#6D7175",
                        }}
                      >
                        <input
                          type="checkbox"
                          role="switch"
                          checked={s.is_active}
                          onChange={() => handleToggleActive(s)}
                          aria-label={`${s.name} actif`}
                          style={{
                            width: 28,
                            height: 16,
                            cursor: "pointer",
                            accentColor: "#1A1A1A",
                          }}
                        />
                        {s.is_active ? "Actif" : "Inactif"}
                      </label>
                    </>
                  )}
                  {state === "failing" && (
                    <Link
                      href={`/${params.locale}/dashboard/alerts`}
                      style={{
                        fontSize: 12,
                        color: "#D72C0D",
                        textDecoration: "none",
                      }}
                    >
                      Voir alertes →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {storefronts.length === 0 && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "#6D7175",
              border: "1px dashed #E1E3E5",
              borderRadius: "0.5rem",
              fontSize: 13,
            }}
          >
            Aucun storefront configuré pour ce marché.
          </div>
        )}
      </div>

      {/* Connection wizard */}
      {wizardOpen && canManage && (
        <ConnectionWizard
          marketId={marketId}
          marketName=""
          onCancel={() => setWizardOpen(false)}
          onComplete={(r) => {
            setWizardOpen(false);
            setCreatedInfo({ webhookUrl: r.webhook_url, secret: r.secret });
            mutate();
          }}
        />
      )}

      {/* Edit panel (simpler than wizard for existing records) */}
      {editStorefront && canManage && (
        <>
          <div
            onClick={closeEdit}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(26,26,26,0.4)",
              zIndex: 40,
            }}
          />
          <FocusTrap
            focusTrapOptions={{
              allowOutsideClick: true,
              fallbackFocus: () => panelRef.current ?? document.body,
            }}
          >
            <div
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-label="Modifier storefront"
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
              <div
                style={{ padding: "20px 24px", borderBottom: "1px solid #E1E3E5" }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#1A1A1A",
                  }}
                >
                  Modifier le storefront
                </h3>
              </div>
              <form
                onSubmit={handleEditSubmit}
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: 24,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                <Field label="Nom">
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Webhook URL">
                  <input
                    type="url"
                    value={form.webhook_url}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, webhook_url: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Webhook Secret">
                  <input
                    type="password"
                    value={form.webhook_secret}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, webhook_secret: e.target.value }))
                    }
                    style={inputStyle}
                    placeholder="Laisser tel quel pour ne pas modifier"
                  />
                </Field>
                {errorMsg && (
                  <p role="alert" style={{ fontSize: 13, color: "#D72C0D", margin: 0 }}>
                    {errorMsg}
                  </p>
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
                    onClick={closeEdit}
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

      {/* Created-storefront secret modal */}
      {createdInfo && (
        <FocusTrap
          focusTrapOptions={{
            allowOutsideClick: false,
            fallbackFocus: () => secretsRef.current ?? document.body,
          }}
        >
          <div
            ref={secretsRef}
            tabIndex={-1}
            role="dialog"
            aria-label="Informations créées"
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
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "#1A1A1A",
                  marginTop: 0,
                }}
              >
                Storefront créé
              </h3>
              <p style={{ fontSize: 13, color: "#D72C0D", marginBottom: 20 }}>
                Copiez ces informations — elles ne seront plus affichées.
              </p>
              <CopyBlock label="URL Webhook (OMS)" value={createdInfo.webhookUrl} />
              <CopyBlock
                label="Secret Webhook"
                value={createdInfo.secret}
                highlight
              />
              <button
                onClick={() => setCreatedInfo(null)}
                style={{
                  backgroundColor: "#1A1A1A",
                  color: "white",
                  border: "none",
                  borderRadius: "0.5rem",
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                  marginTop: 16,
                }}
              >
                J&apos;ai sauvegardé ces informations
              </button>
            </div>
          </div>
        </FocusTrap>
      )}
    </>
  );
}

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 500,
          color: "#374151",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function HealthStat({
  label,
  value,
  valueColor = "#1A1A1A",
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: valueColor,
          marginTop: 2,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function CopyBlock({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 500,
          color: "#6D7175",
          marginBottom: 4,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <code
          style={{
            flex: 1,
            fontSize: 12,
            backgroundColor: highlight ? "#FFF3CD" : "#F6F6F7",
            padding: "8px 12px",
            borderRadius: "0.375rem",
            wordBreak: "break-all",
            color: "#1A1A1A",
          }}
        >
          {value}
        </code>
        <button
          onClick={() => navigator.clipboard.writeText(value)}
          style={{
            background: "none",
            border: "none",
            color: "#2C6ECB",
            fontSize: 13,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Copier
        </button>
      </div>
    </div>
  );
}

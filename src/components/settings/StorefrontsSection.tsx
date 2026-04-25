"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import FocusTrap from "focus-trap-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { canManageStorefronts } from "@/lib/settings-permissions";
import { generateSecret } from "@/lib/storefronts/secret-gen";
import {
  HealthBadge,
  computeHealthState,
  formatRelative,
} from "./storefronts/HealthBadge";
import { ConnectionWizard } from "./storefronts/ConnectionWizard";
import { PlatformIcon } from "./storefronts/PlatformIcon";
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

const PLATFORM_LABEL_KEYS: Record<string, string> = {
  easy_orders: "easyOrders",
  shopify: "shopify",
  woocommerce: "woocommerce",
  lightfunnels: "lightfunnels",
};

interface TestResult {
  success: boolean;
  stage: string;
  message: string;
}

export function StorefrontsSection({ role, marketId }: StorefrontsSectionProps) {
  const t = useTranslations("settings.storefronts");
  const tWizard = useTranslations("settings.storefronts.wizard");
  const params = useParams<{ locale: string }>();
  const { data, mutate, isLoading } = useSWR<{ data: Storefront[] }>(
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const secretsRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    name: "",
    platform: "easy_orders",
    webhook_url: "",
    webhook_secret: "",
  });

  function platformLabel(p: string): string {
    const key = PLATFORM_LABEL_KEYS[p];
    return key ? tWizard(`platforms.${key}` as never) : p;
  }

  function copy(value: string, key: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => {
          setCopiedKey((c) => (c === key ? null : c));
        }, 2000);
      })
      .catch(() => {
        // Silent — fallback to selection if needed
      });
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
          message: t("errorMessages.networkError"),
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
        setErrorMsg(
          (b as { error?: string }).error ?? t("edit_panel.error"),
        );
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
            {t("title")}
          </h2>
          <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0 0" }}>
            {canManage ? t("subtitle") : t("subtitleReadOnly")}
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
            {t("connect")}
          </button>
        )}
      </div>

      {/* Storefront cards with health dashboard */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {isLoading && storefronts.length === 0 && (
          <>
            <StorefrontCardSkeleton />
            <StorefrontCardSkeleton />
            <StorefrontCardSkeleton />
          </>
        )}
        {storefronts.map((s) => {
          const state = computeHealthState({
            is_active: s.is_active,
            last_webhook_received_at: s.last_webhook_received_at,
            last_webhook_status: s.last_webhook_status,
            webhook_failure_count: s.webhook_failure_count,
          });
          const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/${s.id}`;
          const test = testResults[s.id];
          const copyKey = `wh-${s.id}`;
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
                        padding: "2px 8px 2px 4px",
                        fontSize: 11,
                        fontWeight: 500,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <PlatformIcon
                        platform={s.platform}
                        size={14}
                        background="#1A1A1A"
                        color="white"
                      />
                      {platformLabel(s.platform)}
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
                      label={t("lastWebhook")}
                      value={formatRelative(s.last_webhook_received_at)}
                    />
                    <HealthStat
                      label={t("failureCount")}
                      value={String(s.webhook_failure_count)}
                      valueColor={
                        s.webhook_failure_count > 0 ? "#D72C0D" : "#1A1A1A"
                      }
                    />
                    <HealthStat
                      label={t("status")}
                      value={
                        s.last_webhook_status === "error"
                          ? t("statusError")
                          : s.last_webhook_status === "processed"
                            ? t("statusProcessed")
                            : s.last_webhook_status === "ignored"
                              ? t("statusIgnored")
                              : t("statusNone")
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
                      <strong>{t("lastError")}</strong> {s.last_webhook_error}
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
                      onClick={() => copy(webhookUrl, copyKey)}
                      style={{
                        background: "none",
                        border: "none",
                        color: copiedKey === copyKey ? "#008060" : "#2C6ECB",
                        fontSize: 12,
                        cursor: "pointer",
                        padding: 0,
                        fontWeight: copiedKey === copyKey ? 600 : 400,
                        minWidth: 60,
                        textAlign: "start",
                      }}
                      aria-live="polite"
                    >
                      {copiedKey === copyKey ? t("copied") : t("copy")}
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
                        {testingId === s.id ? t("testing") : t("test")}
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
                        {t("edit")}
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
                          aria-label={`${s.name} ${t("active").toLowerCase()}`}
                          style={{
                            width: 28,
                            height: 16,
                            cursor: "pointer",
                            accentColor: "#1A1A1A",
                          }}
                        />
                        {s.is_active ? t("active") : t("inactive")}
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
                      {t("viewAlerts")}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {!isLoading && storefronts.length === 0 && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "#6D7175",
              border: "1px dashed #E1E3E5",
              borderRadius: "0.5rem",
              fontSize: 13,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ color: "#1A1A1A", fontWeight: 500 }}>
              {t("noStorefronts")}
            </div>
            <div style={{ fontSize: 12 }}>{t("emptyHint")}</div>
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
              aria-label={t("edit_panel.title")}
              style={{
                position: "fixed",
                top: 0,
                insetInlineEnd: 0,
                bottom: 0,
                width: 420,
                backgroundColor: "white",
                borderInlineStart: "1px solid #E1E3E5",
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
                  {t("edit_panel.title")}
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
                <Field label={t("edit_panel.name")}>
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
                <Field label={t("edit_panel.webhookUrl")}>
                  <input
                    type="url"
                    value={form.webhook_url}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, webhook_url: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label={t("edit_panel.webhookSecret")}>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#8A6116",
                      background: "#FFF8E1",
                      padding: "6px 8px",
                      borderRadius: "0.375rem",
                      marginBottom: 6,
                    }}
                  >
                    {t("regenerateWarning")}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      value={form.webhook_secret}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, webhook_secret: e.target.value }))
                      }
                      style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }}
                      placeholder={t("edit_panel.secretPlaceholder")}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, webhook_secret: generateSecret() }))
                      }
                      style={{
                        background: "white",
                        border: "1px solid #E1E3E5",
                        borderRadius: "0.5rem",
                        padding: "0 12px",
                        fontSize: 13,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        color: "#1A1A1A",
                      }}
                    >
                      {t("regenerateSecret")}
                    </button>
                  </div>
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
                    {saving ? t("edit_panel.saving") : t("edit_panel.save")}
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
                    {t("edit_panel.cancel")}
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
            aria-label={t("created_modal.title")}
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
                {t("created_modal.title")}
              </h3>
              <p style={{ fontSize: 13, color: "#D72C0D", marginBottom: 20 }}>
                {t("created_modal.warning")}
              </p>
              <CopyBlock
                label={t("created_modal.webhookUrlLabel")}
                value={createdInfo.webhookUrl}
                copyKey="created-url"
                copy={copy}
                copiedKey={copiedKey}
                tCopy={t("copy")}
                tCopied={t("copied")}
              />
              <CopyBlock
                label={t("created_modal.secretLabel")}
                value={createdInfo.secret}
                highlight
                copyKey="created-secret"
                copy={copy}
                copiedKey={copiedKey}
                tCopy={t("copy")}
                tCopied={t("copied")}
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
                {t("created_modal.ack")}
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
  copyKey,
  copy,
  copiedKey,
  tCopy,
  tCopied,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  copyKey: string;
  copy: (v: string, key: string) => void;
  copiedKey: string | null;
  tCopy: string;
  tCopied: string;
}) {
  const isCopied = copiedKey === copyKey;
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
          onClick={() => copy(value, copyKey)}
          style={{
            background: "none",
            border: "none",
            color: isCopied ? "#008060" : "#2C6ECB",
            fontSize: 13,
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontWeight: isCopied ? 600 : 400,
            minWidth: 70,
            textAlign: "start",
          }}
          aria-live="polite"
        >
          {isCopied ? tCopied : tCopy}
        </button>
      </div>
    </div>
  );
}

function StorefrontCardSkeleton() {
  return (
    <div
      style={{
        border: "1px solid #E1E3E5",
        borderRadius: "0.5rem",
        background: "white",
        padding: 16,
      }}
      aria-hidden="true"
    >
      <style>{`@keyframes oms-sf-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }`}</style>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          animation: "oms-sf-pulse 1.4s ease-in-out infinite",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ width: 140, height: 16, background: "#E1E3E5", borderRadius: 4 }} />
          <div style={{ width: 80, height: 16, background: "#E1E3E5", borderRadius: 9999 }} />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <div style={{ height: 36, background: "#F0F1F2", borderRadius: 4 }} />
          <div style={{ height: 36, background: "#F0F1F2", borderRadius: 4 }} />
          <div style={{ height: 36, background: "#F0F1F2", borderRadius: 4 }} />
        </div>
        <div style={{ width: 320, height: 24, background: "#F0F1F2", borderRadius: 4 }} />
      </div>
    </div>
  );
}

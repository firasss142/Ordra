"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import FocusTrap from "focus-trap-react";
import { useTranslations } from "next-intl";
import { generateSecret } from "@/lib/storefronts/secret-gen";
import { PlatformIcon } from "./PlatformIcon";

export interface WizardValues {
  name: string;
  platform: string;
  webhook_url: string;
  webhook_secret: string;
}

interface ConnectionWizardProps {
  marketId: string;
  marketName: string;
  onCancel: () => void;
  onComplete: (result: { id: string; webhook_url: string; secret: string }) => void;
}

const PLATFORM_VALUES = [
  "easy_orders",
  "shopify",
  "woocommerce",
  "lightfunnels",
] as const;
type PlatformValue = (typeof PLATFORM_VALUES)[number];

const PLATFORM_LABEL_KEYS: Record<PlatformValue, string> = {
  easy_orders: "easyOrders",
  shopify: "shopify",
  woocommerce: "woocommerce",
  lightfunnels: "lightfunnels",
};

const STEPS = ["name", "platform", "auth", "webhook"] as const;
type StepKey = (typeof STEPS)[number];

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

export function ConnectionWizard({
  marketId,
  marketName,
  onCancel,
  onComplete,
}: ConnectionWizardProps) {
  const t = useTranslations("settings.storefronts.wizard");
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState<WizardValues>({
    name: "",
    platform: "easy_orders",
    webhook_url: "",
    webhook_secret: generateSecret(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const currentStep = STEPS[stepIdx];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  const canProceed = useMemo(() => {
    if (currentStep === "name") return values.name.trim().length > 0;
    if (currentStep === "platform") return values.platform.length > 0;
    if (currentStep === "auth") return values.webhook_secret.trim().length >= 16;
    return true;
  }, [currentStep, values]);

  function next() {
    if (!canProceed) return;
    setError("");
    if (stepIdx < STEPS.length - 1) setStepIdx(stepIdx + 1);
  }

  function back() {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  }

  const submit = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/storefronts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market_id: marketId,
          platform: values.platform,
          name: values.name,
          config: { webhook_url: values.webhook_url },
          webhook_secret: values.webhook_secret,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError((b as { error?: string }).error ?? t("errorCreate"));
        return;
      }
      const body = await res.json();
      const sf = (body as { data?: { id?: string } }).data;
      if (sf?.id) {
        const url = `${window.location.origin}/api/webhooks/${sf.id}`;
        onComplete({ id: sf.id, webhook_url: url, secret: values.webhook_secret });
      }
    } finally {
      setSaving(false);
    }
  }, [marketId, values, onComplete, t]);

  const platformLabel = (p: string) => {
    const key = PLATFORM_LABEL_KEYS[p as PlatformValue];
    return key ? t(`platforms.${key}` as never) : p;
  };
  const platformHint = (p: string) => {
    const key = PLATFORM_LABEL_KEYS[p as PlatformValue];
    return key ? t(`hints.${key}` as never) : "";
  };

  return (
    <>
      <div
        onClick={onCancel}
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
          aria-label={t("title", { market: marketName })}
          style={{
            position: "fixed",
            top: 0,
            insetInlineEnd: 0,
            bottom: 0,
            width: 480,
            backgroundColor: "white",
            borderInlineStart: "1px solid #E1E3E5",
            zIndex: 50,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header + stepper */}
          <div
            style={{
              padding: "20px 24px 16px",
              borderBottom: "1px solid #E1E3E5",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                color: "#1A1A1A",
              }}
            >
              {t("title", { market: marketName })}
            </h3>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 16,
                alignItems: "center",
              }}
              aria-label={t("stepsAria")}
            >
              {STEPS.map((s, i) => {
                const done = i < stepIdx;
                const active = i === stepIdx;
                return (
                  <div
                    key={s}
                    style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <div
                      aria-current={active ? "step" : undefined}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        backgroundColor: done || active ? "#1A1A1A" : "#E1E3E5",
                        color: "white",
                        fontSize: 12,
                        fontWeight: 500,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {i + 1}
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        color: active ? "#1A1A1A" : "#6D7175",
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      {t(`steps.${s}` as never)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Body */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {currentStep === "name" && (
              <div>
                <label htmlFor="sf-name" style={labelStyle}>
                  {t("nameLabel")}
                </label>
                <input
                  id="sf-name"
                  type="text"
                  autoFocus
                  value={values.name}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, name: e.target.value }))
                  }
                  style={inputStyle}
                  placeholder={t("namePlaceholder")}
                />
                <p style={{ fontSize: 12, color: "#6D7175", marginTop: 8 }}>
                  {t("nameHelp")}
                </p>
              </div>
            )}

            {currentStep === "platform" && (
              <div>
                <label style={labelStyle}>{t("platformLabel")}</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {PLATFORM_VALUES.map((p) => {
                    const selected = values.platform === p;
                    return (
                      <button
                        type="button"
                        key={p}
                        onClick={() =>
                          setValues((v) => ({ ...v, platform: p }))
                        }
                        style={{
                          textAlign: "start",
                          padding: "12px 16px",
                          border: selected
                            ? "2px solid #1A1A1A"
                            : "1px solid #E1E3E5",
                          borderRadius: "0.5rem",
                          background: "white",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                          }}
                        >
                          <PlatformIcon platform={p} size={24} />
                          <div>
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 500,
                                color: "#1A1A1A",
                              }}
                            >
                              {platformLabel(p)}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "#6D7175",
                                marginTop: 2,
                                fontFamily: "monospace",
                              }}
                            >
                              {platformHint(p)}
                            </div>
                          </div>
                        </div>
                        {selected && (
                          <span style={{ color: "#1A1A1A", fontSize: 16 }}>✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {currentStep === "auth" && (
              <div>
                <label htmlFor="sf-secret" style={labelStyle}>
                  {t("secretLabel")}
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    id="sf-secret"
                    type="text"
                    value={values.webhook_secret}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, webhook_secret: e.target.value }))
                    }
                    style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setValues((v) => ({ ...v, webhook_secret: generateSecret() }))
                    }
                    style={{
                      background: "white",
                      border: "1px solid #E1E3E5",
                      borderRadius: "0.5rem",
                      padding: "0 12px",
                      fontSize: 13,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t("secretRegenerate")}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "#6D7175", marginTop: 8 }}>
                  {t("secretHelp")}
                </p>
              </div>
            )}

            {currentStep === "webhook" && (
              <div>
                <label htmlFor="sf-webhook-url" style={labelStyle}>
                  {t("webhookLabel")}
                </label>
                <input
                  id="sf-webhook-url"
                  type="url"
                  value={values.webhook_url}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, webhook_url: e.target.value }))
                  }
                  style={inputStyle}
                  placeholder="https://..."
                />
                <p style={{ fontSize: 12, color: "#6D7175", marginTop: 8 }}>
                  {t("webhookHelp")}
                </p>

                <div
                  style={{
                    marginTop: 20,
                    padding: 12,
                    background: "#F6F6F7",
                    borderRadius: "0.5rem",
                    fontSize: 12,
                    color: "#6D7175",
                  }}
                >
                  <div style={{ fontWeight: 500, color: "#1A1A1A", marginBottom: 6 }}>
                    {t("summary")}
                  </div>
                  <div>{t("summaryName", { name: values.name })}</div>
                  <div>
                    {t("summaryPlatform", { platform: platformLabel(values.platform) })}
                  </div>
                  <div>{t("summaryMarket", { market: marketName })}</div>
                </div>
              </div>
            )}

            {error && (
              <p
                role="alert"
                style={{ fontSize: 13, color: "#D72C0D", margin: 0 }}
              >
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "16px 24px",
              borderTop: "1px solid #E1E3E5",
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={onCancel}
              style={{
                background: "white",
                color: "#1A1A1A",
                border: "1px solid #E1E3E5",
                borderRadius: "0.5rem",
                padding: "8px 16px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {t("cancel")}
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              {stepIdx > 0 && (
                <button
                  type="button"
                  onClick={back}
                  style={{
                    background: "white",
                    color: "#1A1A1A",
                    border: "1px solid #E1E3E5",
                    borderRadius: "0.5rem",
                    padding: "8px 16px",
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  {t("previous")}
                </button>
              )}
              {stepIdx < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={next}
                  disabled={!canProceed}
                  style={{
                    background: canProceed ? "#1A1A1A" : "#B5B5B5",
                    color: "white",
                    border: "none",
                    borderRadius: "0.5rem",
                    padding: "8px 16px",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: canProceed ? "pointer" : "not-allowed",
                  }}
                >
                  {t("next")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={saving}
                  style={{
                    background: "#1A1A1A",
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
                  {saving ? t("creating") : t("create")}
                </button>
              )}
            </div>
          </div>
        </div>
      </FocusTrap>
    </>
  );
}

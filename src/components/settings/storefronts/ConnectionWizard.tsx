"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import FocusTrap from "focus-trap-react";

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

const PLATFORMS = [
  { value: "easy_orders", label: "Easy Orders", hint: "Signature HMAC-SHA256" },
  { value: "shopify", label: "Shopify", hint: "X-Shopify-Hmac-Sha256" },
  { value: "woocommerce", label: "WooCommerce", hint: "X-WC-Webhook-Signature" },
];

const STEPS = ["name", "platform", "auth", "webhook"] as const;
type StepKey = (typeof STEPS)[number];

const STEP_LABEL: Record<StepKey, string> = {
  name: "Nom",
  platform: "Plateforme",
  auth: "Authentification",
  webhook: "Webhook",
};

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

function generateSecret(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ConnectionWizard({
  marketId,
  marketName,
  onCancel,
  onComplete,
}: ConnectionWizardProps) {
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
        setError((b as { error?: string }).error ?? "Erreur lors de la création");
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
  }, [marketId, values, onComplete]);

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
          aria-label="Assistant de connexion storefront"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: 480,
            backgroundColor: "white",
            borderLeft: "1px solid #E1E3E5",
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
              Nouveau storefront — {marketName}
            </h3>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 16,
                alignItems: "center",
              }}
              aria-label="Étapes"
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
                      {STEP_LABEL[s]}
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
                  Nom du storefront
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
                  placeholder="ex : Boutique principale"
                />
                <p style={{ fontSize: 12, color: "#6D7175", marginTop: 8 }}>
                  Un nom court, visible partout où ce storefront apparaît.
                </p>
              </div>
            )}

            {currentStep === "platform" && (
              <div>
                <label style={labelStyle}>Plateforme</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {PLATFORMS.map((p) => {
                    const selected = values.platform === p.value;
                    return (
                      <button
                        type="button"
                        key={p.value}
                        onClick={() =>
                          setValues((v) => ({ ...v, platform: p.value }))
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
                        }}
                      >
                        <div>
                          <div
                            style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A" }}
                          >
                            {p.label}
                          </div>
                          <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
                            {p.hint}
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
                  Secret webhook
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
                    Regénérer
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "#6D7175", marginTop: 8 }}>
                  Ce secret servira à signer les webhooks entrants. 16 caractères minimum.
                </p>
              </div>
            )}

            {currentStep === "webhook" && (
              <div>
                <label htmlFor="sf-webhook-url" style={labelStyle}>
                  URL webhook (côté storefront)
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
                  Optionnel — URL où le storefront envoie les webhooks (pour référence).
                  L&apos;URL d&apos;écoute OMS sera affichée après création.
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
                    Récapitulatif
                  </div>
                  <div>Nom : {values.name}</div>
                  <div>Plateforme : {values.platform}</div>
                  <div>Marché : {marketName}</div>
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
              Annuler
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
                  Précédent
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
                  Suivant
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
                  {saving ? "Création…" : "Créer le storefront"}
                </button>
              )}
            </div>
          </div>
        </div>
      </FocusTrap>
    </>
  );
}

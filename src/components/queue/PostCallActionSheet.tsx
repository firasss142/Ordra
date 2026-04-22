"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import { CallbackPicker } from "./CallbackPicker";
import { RejectionReasonSelect } from "./RejectionReasonSelect";

// Kept for backwards compat — no longer used by QueuePage
export interface PostCallOrder {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string | null;
  customer_address: string | null;
  customer_note: string | null;
  product_name: string;
  variant_label: string | null;
  total_price: number;
  quantity: number;
  status: string;
  created_at: string;
  callback_scheduled_at: string | null;
}

export interface ActionResult {
  action: "attempt" | "confirmed" | "rejected" | "callback";
  newStatus: string;
  autoRejected?: boolean;
  attemptsCount?: number;
  callbackAt?: string;
}

interface PostCallActionSheetProps {
  orderId: string;
  orderStatus: string;
  marketId: string;
  maxAttempts?: number;
  attemptsCount?: number;
  initialFlow?: Flow;
  onClose: () => void;
  onSuccess: (result: ActionResult) => void;
}

type Flow =
  | "option_select"
  | "confirm_flow"
  | "reject_flow"
  | "callback_expanded";

// ── styles ──────────────────────────────────────────────────────────
const overlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(26,26,26,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 40,
};

const panelStyle: React.CSSProperties = {
  background: "#FFFFFF",
  borderRadius: "0.5rem",
  width: 480,
  maxWidth: "90vw",
  maxHeight: "85vh",
  overflowY: "auto",
  zIndex: 50,
  position: "relative",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 20px",
  borderBottom: "1px solid #E5E7EB",
};

const bodyStyle: React.CSSProperties = {
  padding: "20px",
};

const optionButtonBase: React.CSSProperties = {
  width: "100%",
  padding: "16px",
  border: "1px solid #D1D5DB",
  borderRadius: "0.25rem",
  cursor: "pointer",
  backgroundColor: "#FFFFFF",
  color: "#1A1A1A",
  textAlign: "start",
  fontSize: 14,
  fontWeight: 500,
};

const optionButtonDisabled: React.CSSProperties = {
  ...optionButtonBase,
  backgroundColor: "#F3F4F6",
  color: "#9CA3AF",
  cursor: "not-allowed",
  borderColor: "#E5E7EB",
};

const backButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 14,
  color: "#6B7280",
  cursor: "pointer",
  padding: "0 0 12px 0",
  textAlign: "start",
};

const submitButtonBase: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  backgroundColor: "#1A1A1A",
  color: "#FFFFFF",
  border: "none",
  borderRadius: "0.25rem",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const submitButtonDisabled: React.CSSProperties = {
  ...submitButtonBase,
  opacity: 0.5,
  cursor: "not-allowed",
};

const accordionWrapStyle: React.CSSProperties = {
  marginTop: 8,
  padding: 12,
  border: "1px solid #E5E7EB",
  borderRadius: "0.25rem",
  backgroundColor: "#F9FAFB",
};

function getDefaultCallbackTime(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 2);
  return d;
}

export function PostCallActionSheet({
  orderId,
  orderStatus,
  marketId,
  maxAttempts = 3,
  attemptsCount = 0,
  initialFlow,
  onClose,
  onSuccess,
}: PostCallActionSheetProps) {
  const t = useTranslations("queue");
  const panelRef = useRef<HTMLDivElement>(null);
  const [flow, setFlow] = useState<Flow>(initialFlow ?? "option_select");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // NOANSWER
  const [autoRejectMessage, setAutoRejectMessage] = useState(false);

  // CONFIRM
  const [confirmSuccess, setConfirmSuccess] = useState(false);

  // REJECT
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [rejectionNote, setRejectionNote] = useState<string | undefined>(undefined);

  // CALLBACK — pre-seed with default so "Planifier le rappel" is enabled immediately
  const [callbackTime, setCallbackTime] = useState<Date | null>(() => getDefaultCallbackTime());

  // Reset error on flow change; re-seed defaults when re-entering callback
  useEffect(() => {
    setError(null);
    if (flow === "callback_expanded" && callbackTime === null) {
      setCallbackTime(getDefaultCallbackTime());
    }
  }, [flow, callbackTime]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Attempt info — derived from attempts_count column (not from status string)
  const currentAttemptNumber = attemptsCount;
  const atMax = attemptsCount >= maxAttempts;

  function httpErrorMessage(status: number): string {
    if (status === 401) return t("sessionExpired");
    if (status === 403) return t("actionForbidden");
    if (status === 409) return t("statusChanged");
    if (status === 422) return t("carrierRetry");
    return t("networkError");
  }

  // ── NOANSWER submit ──────────────────────────────────────────────
  async function submitNoAnswer() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/no-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        setError(httpErrorMessage(res.status));
        return;
      }
      const json = await res.json();
      const autoRejected: boolean = json.data?.auto_rejected ?? false;
      const newStatus: string = json.data?.new_status ?? "attempt_1";
      const attemptsCountResp: number | undefined = json.data?.attempts_count;
      const callbackAt: string | undefined = json.data?.callback_at;

      if (autoRejected) {
        setAutoRejectMessage(true);
        setTimeout(() => {
          onSuccess({
            action: "attempt",
            newStatus,
            autoRejected: true,
            attemptsCount: attemptsCountResp,
            callbackAt,
          });
        }, 1500);
      } else {
        onSuccess({
          action: "attempt",
          newStatus,
          autoRejected: false,
          attemptsCount: attemptsCountResp,
          callbackAt,
        });
      }
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  // ── CONFIRM submit ───────────────────────────────────────────────
  async function submitConfirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      if (!res.ok || json.success === false) {
        setError(json.error ?? httpErrorMessage(res.status));
        return;
      }

      setConfirmSuccess(true);
      setTimeout(() => {
        onSuccess({ action: "confirmed", newStatus: json.new_status ?? "confirmed" });
      }, 1200);
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  // ── REJECT submit ────────────────────────────────────────────────
  async function submitReject() {
    if (!rejectionReason) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rejection_reason: rejectionReason,
          rejection_note: rejectionNote,
        }),
      });
      if (!res.ok) {
        setError(httpErrorMessage(res.status));
        return;
      }
      onSuccess({ action: "rejected", newStatus: "rejected" });
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  // ── CALLBACK submit ──────────────────────────────────────────────
  async function submitCallback() {
    if (!callbackTime) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_time: callbackTime.toISOString() }),
      });
      if (!res.ok) {
        setError(httpErrorMessage(res.status));
        return;
      }
      onSuccess({ action: "callback", newStatus: "callback_scheduled" });
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  // Attempt counter label — always visible so agent knows where they stand
  const attemptCounterColor = atMax ? "#DC2626" : "#6B7280";
  const showAttemptCounter = true;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <FocusTrap focusTrapOptions={{ allowOutsideClick: true, fallbackFocus: () => panelRef.current ?? document.body }}>
      <div ref={panelRef} tabIndex={-1} style={panelStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <span style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
              {t("callResult")}
            </span>
            {showAttemptCounter && (
              <span
                style={{
                  display: "block",
                  fontSize: 14,
                  fontWeight: 600,
                  color: attemptCounterColor,
                  marginTop: 2,
                }}
              >
                {t("attemptCounter", { current: currentAttemptNumber, max: maxAttempts })}
              </span>
            )}
          </div>
          <button
            style={{
              background: "none",
              border: "none",
              fontSize: 14,
              color: "#6B7280",
              cursor: "pointer",
            }}
            onClick={onClose}
          >
            {t("cancel")}
          </button>
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {/* Error banner */}
          {error && (
            <div
              style={{
                padding: "8px 12px",
                marginBottom: 12,
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: "0.25rem",
                fontSize: 13,
                color: "#DC2626",
              }}
            >
              {error}
            </div>
          )}

          {/* Auto-reject inline message */}
          {autoRejectMessage && (
            <div
              style={{
                padding: "10px 12px",
                marginBottom: 12,
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: "0.25rem",
                fontSize: 14,
                color: "#DC2626",
              }}
            >
              {t("autoRejectedMessage")}
            </div>
          )}

          {/* OPTION_SELECT / NOANSWER_EXPANDED / CALLBACK_EXPANDED */}
          {(flow === "option_select" || flow === "callback_expanded") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {atMax && (
                <div style={{ padding: "8px 12px", background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: "0.25rem", fontSize: 13, color: "#92400E" }}>
                  {t("noResponseHintMax")}
                </div>
              )}
              {/* Pas de réponse — hidden at max attempts. Direct action; server computes next retry slot from manager-configured preset times. */}
              {!atMax && (
                <button
                  style={{
                    ...optionButtonBase,
                    opacity: loading ? 0.6 : 1,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                  disabled={loading}
                  onClick={submitNoAnswer}
                >
                  <div>{t("noResponse")}</div>
                  <div style={{ fontSize: 13, fontWeight: 400, color: "#6B7280", marginTop: 2 }}>
                    {loading ? t("saving") : t("noResponseHint")}
                  </div>
                </button>
              )}

              {/* Confirmé */}
              <button
                style={optionButtonBase}
                onClick={() => setFlow("confirm_flow")}
              >
                <div>{t("confirmed")}</div>
                <div style={{ fontSize: 13, fontWeight: 400, color: "#6B7280", marginTop: 2 }}>
                  {t("confirmedHint")}
                </div>
              </button>

              {/* Rejeté */}
              <button
                style={optionButtonBase}
                onClick={() => {
                  setFlow("reject_flow");
                  if (atMax) setRejectionReason("injoignable");
                }}
              >
                <div>{t("rejected")}</div>
                <div style={{ fontSize: 13, fontWeight: 400, color: "#6B7280", marginTop: 2 }}>
                  {atMax ? t("rejectedHintMax") : t("rejectedHint")}
                </div>
              </button>

              {/* Rappel demandé — hidden at max attempts */}
              {!atMax && (
                <div>
                  <button
                    style={optionButtonBase}
                    onClick={() =>
                      setFlow(
                        flow === "callback_expanded" ? "option_select" : "callback_expanded"
                      )
                    }
                  >
                    <div>{t("callbackRequested")}</div>
                    <div style={{ fontSize: 13, fontWeight: 400, color: "#6B7280", marginTop: 2 }}>
                      {t("callbackHint")}
                    </div>
                  </button>

                  {flow === "callback_expanded" && (
                    <div style={accordionWrapStyle}>
                      <CallbackPicker
                        defaultValue={getDefaultCallbackTime()}
                        onSelect={(d) => setCallbackTime(d)}
                      />
                      <button
                        style={{
                          ...submitButtonBase,
                          marginTop: 12,
                          opacity: !callbackTime || loading ? 0.5 : 1,
                          cursor: !callbackTime || loading ? "not-allowed" : "pointer",
                        }}
                        disabled={!callbackTime || loading}
                        onClick={submitCallback}
                      >
                        {loading ? t("saving") : t("scheduleCallback")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* CONFIRM_FLOW */}
          {flow === "confirm_flow" && (
            <div>
              <button style={backButtonStyle} onClick={() => { setFlow("option_select"); setConfirmSuccess(false); }}>
                {t("back")}
              </button>

              {confirmSuccess ? (
                <div style={{ fontSize: 14, color: "#16A34A", padding: "8px 0" }}>
                  {t("confirmedSuccess")}
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 14, color: "#6B7280", marginBottom: 16 }}>
                    {t("confirmedHint")}
                  </p>
                  <button
                    style={{
                      ...submitButtonBase,
                      marginTop: 8,
                      opacity: loading ? 0.5 : 1,
                      cursor: loading ? "not-allowed" : "pointer",
                    }}
                    disabled={loading}
                    onClick={submitConfirm}
                  >
                    {loading ? t("saving") : t("confirmed")}
                  </button>
                </>
              )}
            </div>
          )}

          {/* REJECT_FLOW */}
          {flow === "reject_flow" && (
            <div>
              <button style={backButtonStyle} onClick={() => { setFlow("option_select"); setRejectionReason(atMax ? "injoignable" : null); }}>
                {t("back")}
              </button>

              <RejectionReasonSelect
                defaultReason={atMax ? "injoignable" : undefined}
                onSelect={(reason, note) => {
                  setRejectionReason(reason);
                  setRejectionNote(note);
                }}
              />

              <button
                style={{
                  ...(rejectionReason ? submitButtonBase : submitButtonDisabled),
                  marginTop: 16,
                }}
                disabled={
                  !rejectionReason ||
                  (rejectionReason === "autre" && !rejectionNote) ||
                  loading
                }
                onClick={submitReject}
              >
                {loading ? t("saving") : t("confirmReject")}
              </button>
            </div>
          )}

        </div>
      </div>
      </FocusTrap>
    </div>
  );
}

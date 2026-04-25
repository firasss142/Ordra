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

const optionButtonClasses =
  "block w-full p-4 rounded-md border border-line-strong bg-surface-card text-start text-[14px] font-medium text-ink-primary transition-colors duration-fast hover:bg-surface-hover disabled:bg-[#F3F4F6] disabled:text-ink-muted disabled:cursor-not-allowed";

const submitButtonClasses =
  "inline-flex items-center justify-center w-full py-2.5 px-4 rounded-md bg-ink-primary text-white text-[14px] font-medium transition-colors duration-fast hover:bg-[#2A2A2A] disabled:opacity-50 disabled:cursor-not-allowed";

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

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-primary/50"
      onClick={onClose}
    >
      <FocusTrap
        focusTrapOptions={{
          allowOutsideClick: true,
          fallbackFocus: () => panelRef.current ?? document.body,
        }}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="relative z-50 bg-surface-card rounded-card w-[480px] max-w-[90vw] max-h-[85vh] overflow-y-auto shadow-floating"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-line-subtle">
            <div>
              <span className="text-[16px] font-semibold text-ink-primary">
                {t("callResult")}
              </span>
              <span
                className={[
                  "block text-[14px] font-semibold mt-0.5",
                  atMax ? "text-status-critical" : "text-ink-secondary",
                ].join(" ")}
              >
                {t("attemptCounter", {
                  current: currentAttemptNumber,
                  max: maxAttempts,
                })}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[14px] text-ink-secondary hover:text-ink-primary transition-colors duration-fast"
            >
              {t("cancel")}
            </button>
          </div>

          {/* Body */}
          <div className="p-5">
            {error && (
              <div className="px-3 py-2 mb-3 bg-status-criticalBg border border-status-critical/30 rounded-md text-[13px] text-status-critical">
                {error}
              </div>
            )}

            {autoRejectMessage && (
              <div className="px-3 py-2.5 mb-3 bg-status-criticalBg border border-status-critical/30 rounded-md text-[14px] text-status-critical">
                {t("autoRejectedMessage")}
              </div>
            )}

            {(flow === "option_select" || flow === "callback_expanded") && (
              <div className="flex flex-col gap-3">
                {atMax && (
                  <div className="px-3 py-2 bg-status-warningBg border border-status-warning/30 rounded-md text-[13px] text-[#92400E]">
                    {t("noResponseHintMax")}
                  </div>
                )}
                {!atMax && (
                  <button
                    type="button"
                    className={optionButtonClasses}
                    style={{ opacity: loading ? 0.6 : 1 }}
                    disabled={loading}
                    onClick={submitNoAnswer}
                  >
                    <div>{t("noResponse")}</div>
                    <div className="text-[13px] font-normal text-ink-secondary mt-0.5">
                      {loading ? t("saving") : t("noResponseHint")}
                    </div>
                  </button>
                )}

                <button
                  type="button"
                  className={optionButtonClasses}
                  onClick={() => setFlow("confirm_flow")}
                >
                  <div>{t("confirmed")}</div>
                  <div className="text-[13px] font-normal text-ink-secondary mt-0.5">
                    {t("confirmedHint")}
                  </div>
                </button>

                <button
                  type="button"
                  className={optionButtonClasses}
                  onClick={() => {
                    setFlow("reject_flow");
                    if (atMax) setRejectionReason("injoignable");
                  }}
                >
                  <div>{t("rejected")}</div>
                  <div className="text-[13px] font-normal text-ink-secondary mt-0.5">
                    {atMax ? t("rejectedHintMax") : t("rejectedHint")}
                  </div>
                </button>

                {!atMax && (
                  <div>
                    <button
                      type="button"
                      className={optionButtonClasses}
                      onClick={() =>
                        setFlow(
                          flow === "callback_expanded"
                            ? "option_select"
                            : "callback_expanded",
                        )
                      }
                    >
                      <div>{t("callbackRequested")}</div>
                      <div className="text-[13px] font-normal text-ink-secondary mt-0.5">
                        {t("callbackHint")}
                      </div>
                    </button>

                    {flow === "callback_expanded" && (
                      <div className="mt-2 p-3 border border-line-subtle rounded-md bg-[#F9FAFB]">
                        <CallbackPicker
                          defaultValue={getDefaultCallbackTime()}
                          onSelect={(d) => setCallbackTime(d)}
                        />
                        <button
                          type="button"
                          className={`${submitButtonClasses} mt-3`}
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

            {flow === "confirm_flow" && (
              <div>
                <button
                  type="button"
                  className="bg-transparent border-0 text-[14px] text-ink-secondary p-0 pb-3 text-start hover:text-ink-primary transition-colors duration-fast"
                  onClick={() => {
                    setFlow("option_select");
                    setConfirmSuccess(false);
                  }}
                >
                  {t("back")}
                </button>

                {confirmSuccess ? (
                  <div className="text-[14px] text-status-success py-2">
                    {t("confirmedSuccess")}
                  </div>
                ) : (
                  <>
                    <p className="text-[14px] text-ink-secondary mb-4">
                      {t("confirmedHint")}
                    </p>
                    <button
                      type="button"
                      className={`${submitButtonClasses} mt-2`}
                      disabled={loading}
                      onClick={submitConfirm}
                    >
                      {loading ? t("saving") : t("confirmed")}
                    </button>
                  </>
                )}
              </div>
            )}

            {flow === "reject_flow" && (
              <div>
                <button
                  type="button"
                  className="bg-transparent border-0 text-[14px] text-ink-secondary p-0 pb-3 text-start hover:text-ink-primary transition-colors duration-fast"
                  onClick={() => {
                    setFlow("option_select");
                    setRejectionReason(atMax ? "injoignable" : null);
                  }}
                >
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
                  type="button"
                  className={`${submitButtonClasses} mt-4`}
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

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import { CallbackPicker } from "./CallbackPicker";
import { RejectionReasonSelect } from "./RejectionReasonSelect";
import { DexpressLocationPicker, type DexpressSelection } from "./DexpressLocationPicker";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CarrierOption {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

interface OrderForUpload {
  customer_address: string | null;
  dexpress_state_id: number | null;
}

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
  | "reject_flow"
  | "callback_expanded"
  // After /confirm succeeds: pick a carrier, then either upload now or
  // schedule. "Plus tard" closes and finalises as `confirmed`.
  | "upload_after_confirm"
  // Sub-flow of upload_after_confirm: agent chose Dexpress but the order
  // has no dexpress_state_id yet — pick one inline before uploading.
  | "upload_pick_state"
  // Sub-flow of upload_after_confirm: agent picked a carrier and clicked
  // "Programmer" — show the date/time picker.
  | "schedule_after_confirm";

const optionButtonClasses =
  "block w-full p-4 rounded-xl border border-line-strong bg-surface-card text-start text-[14px] font-semibold text-ink-primary transition-colors duration-fast hover:bg-surface-hover disabled:bg-[#F3F4F6] disabled:text-ink-muted disabled:cursor-not-allowed";

const submitButtonClasses =
  "inline-flex items-center justify-center w-full py-2.5 px-4 rounded-xl bg-ink-primary text-white text-[14px] font-semibold transition-colors duration-fast hover:bg-[#2A2A2A] disabled:opacity-50 disabled:cursor-not-allowed";

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
  // Which option is mid-flight on the option_select screen. Used purely for
  // UI feedback — `loading` already disables every button, but only the
  // pending one should fade and show "Enregistrement…".
  const [pendingAction, setPendingAction] = useState<
    "no_answer" | "confirm" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  // NOANSWER
  const [autoRejectMessage, setAutoRejectMessage] = useState(false);

  // CONFIRM
  // After /confirm succeeds we don't close the sheet anymore — we flip to
  // the upload-after-confirm flow. confirmSuccess is kept only as a brief
  // visual cue while data loads, then cleared.
  const [confirmSuccess, setConfirmSuccess] = useState(false);

  // UPLOAD_AFTER_CONFIRM
  const [selectedCarrierId, setSelectedCarrierId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stateSelection, setStateSelection] = useState<DexpressSelection>({
    stateId: null,
    stateName: "",
  });

  // SCHEDULE_AFTER_CONFIRM
  const todayIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d;
  })();
  const [scheduleDate, setScheduleDate] = useState<string>(() => {
    const y = todayIso.getFullYear();
    const m = String(todayIso.getMonth() + 1).padStart(2, "0");
    const d = String(todayIso.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  });
  const [scheduleTime, setScheduleTime] = useState<string>(() => {
    const h = String(todayIso.getHours()).padStart(2, "0");
    const m = String(todayIso.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  });

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

  // Carriers + order detail are needed once the agent reaches the post-confirm
  // upload step. Fetch them only when actually entering that flow.
  const isPostConfirm =
    flow === "upload_after_confirm" ||
    flow === "upload_pick_state" ||
    flow === "schedule_after_confirm";

  const { data: carriersData } = useSWR<{ data: CarrierOption[] }>(
    isPostConfirm && marketId
      ? `/api/carriers?market_id=${marketId}&is_active=true`
      : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const carriers = (carriersData?.data ?? []).filter((c) => c.is_active);

  const { data: orderForUpload } = useSWR<{ data: OrderForUpload }>(
    isPostConfirm ? `/api/orders/${orderId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  // Auto-select the only carrier when there's exactly one. Saves a click but
  // keeps the radio visible (per UX call) so the user always sees what's
  // about to happen.
  useEffect(() => {
    if (!isPostConfirm) return;
    if (carriers.length === 1 && selectedCarrierId === null) {
      setSelectedCarrierId(carriers[0].id);
    }
  }, [carriers, isPostConfirm, selectedCarrierId]);

  const selectedCarrier =
    carriers.find((c) => c.id === selectedCarrierId) ?? null;

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
    setPendingAction("no_answer");
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
      setPendingAction(null);
    }
  }

  // ── CONFIRM submit ───────────────────────────────────────────────
  // After confirm succeeds, we flip the sheet into the post-confirm carrier
  // picker instead of closing. The agent can then upload immediately, schedule,
  // or close ("Plus tard") — leaving status=confirmed.
  async function submitConfirm() {
    setLoading(true);
    setPendingAction("confirm");
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
      setFlow("upload_after_confirm");
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  }

  // ── UPLOAD now (post-confirm) ────────────────────────────────────
  async function submitUploadNow() {
    if (!selectedCarrier) return;

    // Dexpress requires a destination state_id. Use the order's saved value
    // when available; otherwise route the agent through the inline picker.
    const isDexpress = selectedCarrier.code === "dexpress";
    const savedStateId = orderForUpload?.data?.dexpress_state_id ?? null;

    if (isDexpress && savedStateId === null && stateSelection.stateId === null) {
      setFlow("upload_pick_state");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const extra: Record<string, unknown> = {};
      if (isDexpress) {
        extra.state_id = savedStateId ?? stateSelection.stateId;
      }

      const res = await fetch(`/api/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier_id: selectedCarrier.id,
          extra,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof json?.error === "string"
            ? json.error
            : httpErrorMessage(res.status),
        );
        return;
      }
      onSuccess({ action: "confirmed", newStatus: "uploaded" });
    } catch {
      setError(t("networkError"));
    } finally {
      setUploading(false);
    }
  }

  // ── SCHEDULE upload (post-confirm) ───────────────────────────────
  async function submitScheduleUpload() {
    if (!selectedCarrier) return;
    const combined = new Date(`${scheduleDate}T${scheduleTime}:00`);
    if (Number.isNaN(combined.getTime()) || combined.getTime() <= Date.now()) {
      setError(t("scheduleMustBeFuture"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/schedule-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_at: combined.toISOString(),
          auto_dispatch: true,
          carrier_id: selectedCarrier.id,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof json?.error === "string"
            ? json.error
            : httpErrorMessage(res.status),
        );
        return;
      }
      onSuccess({ action: "confirmed", newStatus: "dispatch_scheduled" });
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  // "Plus tard" — close, leave order at status=confirmed.
  function finishLater() {
    onSuccess({ action: "confirmed", newStatus: "confirmed" });
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
    <>
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
                    // Real disabled (with greyed styling) only on the pending
                    // button. The other one stays visually idle but ignores
                    // clicks while a request is in flight.
                    disabled={pendingAction === "no_answer"}
                    aria-disabled={loading}
                    onClick={() => {
                      if (loading) return;
                      submitNoAnswer();
                    }}
                  >
                    <div>{t("noResponse")}</div>
                    <div className="text-[13px] font-normal text-ink-secondary mt-0.5">
                      {pendingAction === "no_answer"
                        ? t("saving")
                        : t("noResponseHint")}
                    </div>
                  </button>
                )}

                <button
                  type="button"
                  className={optionButtonClasses}
                  disabled={pendingAction === "confirm"}
                  aria-disabled={loading}
                  onClick={() => {
                    if (loading) return;
                    submitConfirm();
                  }}
                >
                  <div>{t("confirmed")}</div>
                  <div className="text-[13px] font-normal text-ink-secondary mt-0.5">
                    {pendingAction === "confirm"
                      ? t("saving")
                      : t("confirmedHint")}
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

            {/* ── Post-confirm: pick carrier, then upload now or schedule. ── */}
            {flow === "upload_after_confirm" && (
              <div>
                <div className="text-[13px] text-status-success mb-3">
                  ✓ {t("confirmedSuccess")}
                </div>

                <div className="text-[14px] font-semibold text-ink-primary mb-2">
                  {t("pickCarrierTitle")}
                </div>

                {!carriersData ? (
                  <div className="text-[13px] text-ink-secondary py-2">
                    {t("loadingCarriers")}
                  </div>
                ) : carriers.length === 0 ? (
                  <div className="px-3 py-2 mb-3 rounded-md bg-status-warningBg border border-status-warning/30 text-[13px] text-status-warning">
                    {t("noActiveCarrier")}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 mb-4">
                    {carriers.map((c) => {
                      const isSelected = selectedCarrierId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedCarrierId(c.id)}
                          className={[
                            "flex items-center justify-between w-full px-3 py-2.5 rounded-md text-[14px] text-start text-ink-primary border bg-surface-card",
                            isSelected
                              ? "border-2 border-ink-primary"
                              : "border border-line-strong hover:bg-surface-hover",
                          ].join(" ")}
                        >
                          <span className="font-medium">{c.name}</span>
                          <span className="text-[12px] font-normal text-ink-secondary">
                            ({c.code})
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    className={`${submitButtonClasses} flex-1`}
                    disabled={!selectedCarrier || uploading}
                    onClick={submitUploadNow}
                  >
                    {uploading ? t("uploadingNow") : t("uploadNow")}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center flex-1 py-2.5 px-4 rounded-md border border-line-strong bg-surface-card text-[14px] font-medium text-ink-primary transition-colors duration-fast hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!selectedCarrier}
                    onClick={() => setFlow("schedule_after_confirm")}
                  >
                    {t("scheduleUpload")}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={finishLater}
                  className="block mt-3 mx-auto text-[13px] text-ink-secondary hover:text-ink-primary"
                >
                  {t("notNow")}
                </button>
              </div>
            )}

            {/* ── Dexpress fallback: pick a destination state inline. ── */}
            {flow === "upload_pick_state" && (
              <div>
                <button
                  type="button"
                  className="bg-transparent border-0 text-[14px] text-ink-secondary p-0 pb-3 text-start hover:text-ink-primary transition-colors duration-fast"
                  onClick={() => setFlow("upload_after_confirm")}
                >
                  {t("back")}
                </button>

                <p className="text-[14px] text-ink-secondary mb-3">
                  {t("pickCityForDexpress")}
                </p>

                <DexpressLocationPicker
                  value={stateSelection}
                  onChange={setStateSelection}
                />

                <button
                  type="button"
                  className={`${submitButtonClasses} mt-4`}
                  disabled={stateSelection.stateId === null || uploading}
                  onClick={submitUploadNow}
                >
                  {uploading ? t("uploadingNow") : t("uploadNow")}
                </button>
              </div>
            )}

            {/* ── Schedule the upload for later (auto-dispatch via cron). ── */}
            {flow === "schedule_after_confirm" && (
              <div>
                <button
                  type="button"
                  className="bg-transparent border-0 text-[14px] text-ink-secondary p-0 pb-3 text-start hover:text-ink-primary transition-colors duration-fast"
                  onClick={() => setFlow("upload_after_confirm")}
                >
                  {t("back")}
                </button>

                <div className="text-[13px] text-ink-secondary mb-3">
                  {selectedCarrier ? (
                    <>
                      {t("schedulingFor")} <strong>{selectedCarrier.name}</strong>
                    </>
                  ) : (
                    t("schedulingHint")
                  )}
                </div>

                <div className="flex gap-2 mb-3">
                  <div className="flex-1">
                    <div className="text-[12px] text-ink-secondary mb-1">
                      {t("scheduleDate")}
                    </div>
                    <input
                      type="date"
                      aria-label={t("scheduleDate")}
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="w-full px-3 py-2 text-[14px] rounded-md border border-line-strong bg-surface-card text-ink-primary"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="text-[12px] text-ink-secondary mb-1">
                      {t("scheduleTime")}
                    </div>
                    <input
                      type="time"
                      aria-label={t("scheduleTime")}
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="w-full px-3 py-2 text-[14px] rounded-md border border-line-strong bg-surface-card text-ink-primary"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className={submitButtonClasses}
                  disabled={loading}
                  onClick={submitScheduleUpload}
                >
                  {loading ? t("saving") : t("scheduleConfirm")}
                </button>
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
    </>
  );
}

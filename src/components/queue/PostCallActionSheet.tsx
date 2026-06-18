"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { useTranslations, useLocale } from "next-intl";
import FocusTrap from "focus-trap-react";
import {
  CheckCircle2,
  XCircle,
  CalendarClock,
  PhoneOff,
  ChevronRight,
} from "lucide-react";
import { CallbackPicker } from "./CallbackPicker";
import { RejectionReasonSelect } from "./RejectionReasonSelect";
import { DexpressLocationPicker, type DexpressSelection } from "./DexpressLocationPicker";
import { DarbAssabilDispatchModal } from "./DarbAssabilDispatchModal";
import { coverageFor, type CoverageState } from "@/lib/carriers/coverage";
import { useOptimisticOrderAction } from "@/hooks/useOptimisticOrderAction";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CarrierOption {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

interface OrderForUpload {
  customer_address: string | null;
  customer_city: string | null;
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

// Each call-result option carries the semantic color of the status it sets:
// confirm→success, reject→critical, callback→warning, no-answer→neutral. The
// color lives on the leading icon disc only — the card itself stays white so
// the screen reads calm, per the design system's "color communicates status,
// never decorates" rule. The disc also tints to its status background on hover.
const optionCardClasses =
  "group flex w-full items-center gap-3 p-3.5 rounded-xl border border-line-strong bg-surface-card text-start transition-colors duration-fast hover:bg-surface-hover disabled:bg-[#F3F4F6] disabled:text-ink-muted disabled:cursor-not-allowed";

type OptionTone = "success" | "critical" | "warning" | "neutral";

// disc = resting icon-circle fill + text; hover deepens the fill a touch.
const OPTION_TONE: Record<OptionTone, { disc: string; icon: string }> = {
  success: {
    disc: "bg-status-successBg group-hover:bg-status-success/15",
    icon: "text-status-success",
  },
  critical: {
    disc: "bg-status-criticalBg group-hover:bg-status-critical/15",
    icon: "text-status-critical",
  },
  warning: {
    disc: "bg-status-warningBg group-hover:bg-status-warning/15",
    icon: "text-status-warning",
  },
  neutral: {
    disc: "bg-status-neutralBg group-hover:bg-ink-muted/15",
    icon: "text-ink-secondary",
  },
};

const submitButtonClasses =
  "inline-flex items-center justify-center w-full py-2.5 px-4 rounded-xl bg-ink-primary text-white text-[14px] font-semibold transition-colors duration-fast hover:bg-[#2A2A2A] disabled:opacity-50 disabled:cursor-not-allowed";

function getDefaultCallbackTime(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 2);
  return d;
}

// A single call-result choice: colored icon disc, label, hint, and a trailing
// chevron. Pending state fades the disc and swaps the hint for "Enregistrement…"
// (handled by the caller via `hint`); `dimmed` keeps a non-pending button
// visually idle while another request is in flight.
function OptionCard({
  tone,
  icon,
  label,
  hint,
  onClick,
  disabled,
  dimmed,
}: {
  tone: OptionTone;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  dimmed?: boolean;
}) {
  const toneStyle = OPTION_TONE[tone];
  const locale = useLocale();
  const isRtl = locale === "ar";
  return (
    <button
      type="button"
      className={optionCardClasses}
      disabled={disabled}
      aria-disabled={dimmed}
      onClick={onClick}
    >
      <span
        className={[
          "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors duration-fast group-disabled:opacity-50",
          toneStyle.disc,
          toneStyle.icon,
        ].join(" ")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink-primary group-disabled:text-ink-muted">
          {label}
        </span>
        <span className="mt-0.5 block text-[13px] font-normal text-ink-secondary group-disabled:text-ink-muted">
          {hint}
        </span>
      </span>
      <ChevronRight
        size={16}
        strokeWidth={2}
        aria-hidden="true"
        className={[
          "flex-shrink-0 text-ink-muted transition-transform duration-fast",
          // Chevron points "forward into the flow"; under RTL that's leftward.
          isRtl
            ? "-scale-x-100 group-hover:-translate-x-0.5"
            : "group-hover:translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
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
  const tDup = useTranslations("duplicateOrder.uploadGuard");
  const tCov = useTranslations("dispatch.coverage");
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
  // Duplicate-upload guard: set when the server returns 409 needsConfirmation,
  // holds the already-shipped sibling so the agent can confirm or cancel.
  const [duplicateConfirm, setDuplicateConfirm] = useState<{
    externalId: string | null;
  } | null>(null);
  const [stateSelection, setStateSelection] = useState<DexpressSelection>({
    stateId: null,
    stateName: "",
  });
  // Darb Assabil uploads route through the shared DarbAssabilDispatchModal
  // (service + area + options) — one source of truth, no inline divergence.
  const [darbModalOpen, setDarbModalOpen] = useState(false);

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

  // Optimistic action runner: patches the agent queue cache before the request
  // resolves so the card jumps to its new bucket instantly, and rolls back if
  // the server rejects.
  const { run: runOptimistic } = useOptimisticOrderAction(orderId);

  // Carriers + order detail are needed once the agent reaches the post-confirm
  // upload step. Fetch them only when actually entering that flow.
  const isPostConfirm =
    flow === "upload_after_confirm" ||
    flow === "upload_pick_state" ||
    flow === "schedule_after_confirm" ||
    darbModalOpen;

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
    // Don't auto-select a carrier that clearly doesn't serve this city.
    if (
      carriers.length === 1 &&
      selectedCarrierId === null &&
      carrierCoverage(carriers[0].code) !== "uncovered"
    ) {
      setSelectedCarrierId(carriers[0].id);
    }
    // carrierCoverage is derived from the same deps (carriers + orderForUpload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carriers, isPostConfirm, selectedCarrierId, orderForUpload]);

  const selectedCarrier =
    carriers.find((c) => c.id === selectedCarrierId) ?? null;

  // Per-carrier destination coverage for this order's city. Computed once the
  // order detail (city + resolved dexpress_state_id) has loaded. Carriers with
  // no coverage model (anything other than dexpress/darb_assabil) are treated
  // as "covered" so the check never blocks them.
  const coverage = coverageFor(
    orderForUpload?.data?.customer_city ?? null,
    orderForUpload?.data?.dexpress_state_id ?? null,
  );
  function carrierCoverage(code: string): CoverageState {
    if (code === "dexpress") return coverage.dexpress;
    if (code === "darb_assabil") return coverage.darb_assabil;
    return "covered";
  }

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
    let serverError: string | null = null;
    const result = await runOptimistic({
      optimisticPatch: () => ({ status: "confirmed" }),
      request: async () => {
        const res = await fetch(`/api/orders/${orderId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          try {
            const j = (await res.json()) as { error?: unknown } | null;
            if (j && typeof j.error === "string") serverError = j.error;
          } catch {
            // swallow body parse errors — fall back to httpErrorMessage
          }
        }
        return res;
      },
    });
    setLoading(false);
    setPendingAction(null);
    if (!result.ok) {
      setError(serverError ?? httpErrorMessage(result.status || 500));
      return;
    }
    setConfirmSuccess(true);
    setFlow("upload_after_confirm");
  }

  // ── UPLOAD now (post-confirm) ────────────────────────────────────
  async function submitUploadNow(confirmDuplicate = false) {
    if (!selectedCarrier) return;
    // Hard stop if the city is confidently not served by this carrier.
    if (carrierCoverage(selectedCarrier.code) === "uncovered") {
      setError(
        tCov("notCovered", {
          city: orderForUpload?.data?.customer_city ?? "",
        }),
      );
      return;
    }

    // Dexpress requires a destination state_id. Use the order's saved value
    // when available; otherwise route the agent through the inline picker.
    const isDexpress = selectedCarrier.code === "dexpress";
    const savedStateId = orderForUpload?.data?.dexpress_state_id ?? null;

    if (isDexpress && savedStateId === null && stateSelection.stateId === null) {
      setFlow("upload_pick_state");
      return;
    }

    // Darb Assabil uploads go through the shared DarbAssabilDispatchModal, which
    // collects the service package, destination (city, area), and per-order
    // options, then performs the dispatch itself. Open it instead of POSTing
    // inline so the agent gets the SAME choices as the order-detail flow.
    if (selectedCarrier.code === "darb_assabil") {
      setDarbModalOpen(true);
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
          ...(confirmDuplicate ? { confirm_duplicate: true } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      // Duplicate-upload guard: a sibling order is already shipped to the
      // carrier. Ask the agent to confirm rather than silently shipping twice.
      if (res.status === 409 && json?.needsConfirmation) {
        setDuplicateConfirm({ externalId: json?.duplicate?.external_id ?? null });
        return;
      }
      if (!res.ok) {
        setError(
          typeof json?.error === "string"
            ? json.error
            : httpErrorMessage(res.status),
        );
        return;
      }
      setDuplicateConfirm(null);
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
    let serverError: string | null = null;
    const scheduledIso = combined.toISOString();
    const result = await runOptimistic({
      optimisticPatch: () => ({
        status: "dispatch_scheduled",
        scheduled_dispatch_at: scheduledIso,
        scheduled_dispatch_auto: true,
        scheduled_dispatch_carrier_id: selectedCarrier.id,
      }),
      request: async () => {
        const res = await fetch(`/api/orders/${orderId}/schedule-dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduled_at: scheduledIso,
            auto_dispatch: true,
            carrier_id: selectedCarrier.id,
          }),
        });
        if (!res.ok) {
          try {
            const j = (await res.json()) as { error?: unknown } | null;
            if (j && typeof j.error === "string") serverError = j.error;
          } catch {
            // swallow body parse errors — fall back to httpErrorMessage
          }
        }
        return res;
      },
    });
    setLoading(false);
    if (!result.ok) {
      setError(serverError ?? httpErrorMessage(result.status || 500));
      return;
    }
    onSuccess({ action: "confirmed", newStatus: "dispatch_scheduled" });
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
    const result = await runOptimistic({
      optimisticPatch: () => ({
        status: "rejected",
        rejection_reason: rejectionReason,
        rejection_note: rejectionNote ?? null,
      }),
      request: () =>
        fetch(`/api/orders/${orderId}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rejection_reason: rejectionReason,
            rejection_note: rejectionNote,
          }),
        }),
    });
    setLoading(false);
    if (!result.ok) {
      setError(httpErrorMessage(result.status || 500));
      return;
    }
    onSuccess({ action: "rejected", newStatus: "rejected" });
  }

  // ── CALLBACK submit ──────────────────────────────────────────────
  async function submitCallback() {
    if (!callbackTime) return;
    setLoading(true);
    setError(null);
    const isoTime = callbackTime.toISOString();
    const result = await runOptimistic({
      optimisticPatch: () => ({
        status: "callback_scheduled",
        callback_scheduled_at: isoTime,
      }),
      request: () =>
        fetch(`/api/orders/${orderId}/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_time: isoTime }),
        }),
    });
    setLoading(false);
    if (!result.ok) {
      setError(httpErrorMessage(result.status || 500));
      return;
    }
    onSuccess({ action: "callback", newStatus: "callback_scheduled" });
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
                  // Real disabled (with greyed styling) only on the pending
                  // button. The others stay visually idle but ignore clicks
                  // while a request is in flight (handled via `dimmed`).
                  <OptionCard
                    tone="neutral"
                    icon={<PhoneOff size={18} strokeWidth={2} aria-hidden="true" />}
                    label={t("noResponse")}
                    hint={pendingAction === "no_answer" ? t("saving") : t("noResponseHint")}
                    disabled={pendingAction === "no_answer"}
                    dimmed={loading}
                    onClick={() => {
                      if (loading) return;
                      submitNoAnswer();
                    }}
                  />
                )}

                <OptionCard
                  tone="success"
                  icon={<CheckCircle2 size={18} strokeWidth={2} aria-hidden="true" />}
                  label={t("confirmed")}
                  hint={pendingAction === "confirm" ? t("saving") : t("confirmedHint")}
                  disabled={pendingAction === "confirm"}
                  dimmed={loading}
                  onClick={() => {
                    if (loading) return;
                    submitConfirm();
                  }}
                />

                <OptionCard
                  tone="critical"
                  icon={<XCircle size={18} strokeWidth={2} aria-hidden="true" />}
                  label={t("rejected")}
                  hint={atMax ? t("rejectedHintMax") : t("rejectedHint")}
                  onClick={() => {
                    setFlow("reject_flow");
                    if (atMax) setRejectionReason("injoignable");
                  }}
                />

                {!atMax && (
                  <div>
                    <OptionCard
                      tone="warning"
                      icon={<CalendarClock size={18} strokeWidth={2} aria-hidden="true" />}
                      label={t("callbackRequested")}
                      hint={t("callbackHint")}
                      onClick={() =>
                        setFlow(
                          flow === "callback_expanded"
                            ? "option_select"
                            : "callback_expanded",
                        )
                      }
                    />

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
                      const cov = carrierCoverage(c.code);
                      const blocked = cov === "uncovered";
                      const city = orderForUpload?.data?.customer_city ?? "";
                      return (
                        <div key={c.id}>
                          <button
                            type="button"
                            disabled={blocked}
                            aria-disabled={blocked}
                            onClick={() => !blocked && setSelectedCarrierId(c.id)}
                            className={[
                              "flex items-center justify-between w-full px-3 py-2.5 rounded-md text-[14px] text-start border",
                              blocked
                                ? "border-status-critical/40 bg-status-criticalBg text-ink-muted cursor-not-allowed"
                                : isSelected
                                  ? "border-2 border-ink-primary bg-surface-card text-ink-primary"
                                  : "border border-line-strong bg-surface-card text-ink-primary hover:bg-surface-hover",
                            ].join(" ")}
                          >
                            <span className="font-medium">{c.name}</span>
                            <span
                              className={[
                                "text-[12px] font-normal",
                                blocked ? "text-status-critical" : "text-ink-secondary",
                              ].join(" ")}
                            >
                              {blocked ? tCov("badge") : `(${c.code})`}
                            </span>
                          </button>
                          {blocked && (
                            <p className="mt-1 px-1 text-[12px] text-status-critical">
                              {tCov("notCovered", { city })}
                            </p>
                          )}
                          {cov === "unknown" && isSelected && (
                            <p className="mt-1 px-1 text-[12px] text-status-warning">
                              {tCov("unknownCity")}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    className={`${submitButtonClasses} flex-1`}
                    disabled={!selectedCarrier || uploading}
                    onClick={() => submitUploadNow()}
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
                  onClick={() => submitUploadNow()}
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

    {/* Darb Assabil upload — the shared modal (service + area + options + its
        own dispatch + duplicate guard). On success, finalise as uploaded. */}
    {darbModalOpen && (
      <DarbAssabilDispatchModal
        orderId={orderId}
        marketId={marketId}
        customerAddress={orderForUpload?.data?.customer_address ?? null}
        customerCity={orderForUpload?.data?.customer_city ?? null}
        onClose={() => setDarbModalOpen(false)}
        onSuccess={() => {
          setDarbModalOpen(false);
          onSuccess({ action: "confirmed", newStatus: "uploaded" });
        }}
      />
    )}

    {/* Duplicate-upload confirm: a sibling order is already shipped to the
        carrier. Warn but allow the agent to proceed. */}
    {duplicateConfirm && (
      <div
        className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
        role="dialog"
        aria-modal="true"
        onClick={() => setDuplicateConfirm(null)}
      >
        <div
          className="w-full max-w-sm rounded-lg border border-line-subtle bg-surface-card p-5 shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="mb-2 text-[15px] font-semibold text-status-warning">
            {tDup("title")}
          </h2>
          <p className="mb-4 text-[13.5px] leading-relaxed text-ink-secondary">
            {tDup("body", {
              externalId: duplicateConfirm.externalId ?? "—",
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="inline-flex flex-1 items-center justify-center rounded-md border border-line-strong bg-surface-card px-4 py-2.5 text-[14px] font-medium text-ink-primary transition-colors duration-fast hover:bg-surface-hover"
              onClick={() => setDuplicateConfirm(null)}
            >
              {tDup("cancel")}
            </button>
            <button
              type="button"
              className={`${submitButtonClasses} flex-1`}
              disabled={uploading}
              onClick={() => {
                setDuplicateConfirm(null);
                submitUploadNow(true);
              }}
            >
              {uploading ? t("uploadingNow") : tDup("confirm")}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

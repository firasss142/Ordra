"use client";

/**
 * The four endings as a small machine (prototype `act`, `ship`, `data-dorej`, `data-docb`,
 * `data-dosend`, `data-dosched`, `data-tray`): which step is open, what is chosen in it,
 * the result line once something is recorded. The panel (desktop tray) and the phone
 * sheet both run one of these; useCallOutcome does the talking to the server.
 */

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRejectionReasons } from "@/hooks/useRejectionReasons";
import { buildRejectionTree } from "@/lib/orders/rejection-config";
import { REJECTION_GROUPS, REJECTION_SUBREASONS } from "@/lib/orders/rejection-taxonomy";
import { useFeedbackCapture } from "@/components/feedback/FeedbackCaptureProvider";
import { useFeedbackOffer } from "@/components/feedback/FeedbackOffer";
import { useFeedbackTopics } from "@/hooks/useFeedback";
import { useAgentToast } from "@/components/agent/shared";
import type { DexpressSelection } from "@/components/queue/DexpressLocationPicker";
import { useCallOutcome } from "./useCallOutcome";
import { useCarrierChoice } from "./useCarrierChoice";
import { callbackSlots, carrierFormFor, groupIcon, localInputs, type OutcomeDone, type SlotKey, type Tray, type Twin } from "./outcome-model";

export interface OutcomeOrder {
  id: string;
  status: string;
  marketId: string | null;
  attempts: number;
  currency: string;
  twin: Twin | null;
}

export interface DoneLine {
  hue: "amber" | "red" | "violet" | "teal" | "green";
  icon: string;
  text: string;
}

export interface ReasonGroup {
  key: string;
  label: string;
  hint: string | null;
  noteOnly: boolean;
  subs: Array<{ key: string; label: string }>;
}

/** « 18:30 » today, « demain 11:00 », else « 7 oct. 10:00 » — the prototype's `cbWhen`. */
export function useCbWhen() {
  const t = useTranslations("agentOutcome.when");
  const locale = useLocale();
  return useCallback(
    (d: Date | string | null | undefined, now = new Date()): string => {
      if (!d) return "";
      const x = typeof d === "string" ? new Date(d) : d;
      const { time } = localInputs(x);
      const day = (v: Date) => `${v.getFullYear()}-${v.getMonth()}-${v.getDate()}`;
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      if (day(x) === day(now)) return time;
      if (day(x) === day(tomorrow)) return t("tomorrow", { time });
      const date = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { day: "numeric", month: "short" }).format(x);
      return `${date} ${time}`;
    },
    [t, locale],
  );
}

function useReasonGroups(marketId: string | null): ReasonGroup[] {
  const { rows } = useRejectionReasons(marketId);
  const locale = useLocale();
  const tGroups = useTranslations("orders.rejectionGroups");
  const tHints = useTranslations("orders.rejectionGroupHints");
  const tSubs = useTranslations("orders.rejectionSubreasons");
  return useMemo(() => {
    const hint = (k: string) => {
      const h = tHints(k as never);
      return h && !h.includes("rejectionGroupHints") ? h : null;
    };
    const tree = buildRejectionTree(rows, { activeOnly: true });
    const ar = locale.startsWith("ar");
    if (tree.length > 0) {
      return tree.map((g) => ({
        key: g.key,
        label: ar ? g.labelAr : g.labelFr,
        hint: hint(g.key),
        noteOnly: g.requiresNote,
        subs: g.subreasons.map((s) => ({ key: s.key, label: ar ? s.label_ar : s.label_fr })),
      }));
    }
    // The compiled taxonomy, until the market's own rows arrive.
    return REJECTION_GROUPS.map((g) => ({
      key: g as string,
      label: tGroups(g),
      hint: hint(g),
      noteOnly: g === "autre",
      subs: (REJECTION_SUBREASONS[g] ?? []).map((s) => ({ key: s, label: tSubs(s as never) })),
    }));
  }, [rows, locale, tGroups, tHints, tSubs]);
}

export function useOutcomeFlow({
  order,
  maxAttempts,
  initialTray,
  onDone,
}: {
  order: OutcomeOrder;
  maxAttempts: number;
  initialTray?: Tray | null;
  onDone: (r: OutcomeDone) => void;
}) {
  const t = useTranslations("agentOutcome");
  const tCov = useTranslations("dispatch.coverage");
  const toast = useAgentToast();
  const cbWhen = useCbWhen();
  const outcome = useCallOutcome(order.id);
  const atMax = order.attempts >= maxAttempts;

  const [tray, setTrayState] = useState<Tray | null>(initialTray ?? null);
  const [justConfirmed, setJustConfirmed] = useState(false);
  const [done, setDone] = useState<DoneLine | null>(null);

  // ── reject ──
  const groups = useReasonGroups(order.marketId);
  const [group, setGroup] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const capture = useFeedbackCapture();
  const topics = useFeedbackTopics(order.marketId, capture.enabled && tray === "reject");
  const offer = useFeedbackOffer({ topics, words: note });

  // ── callback ──
  const [now] = useState(() => new Date());
  const [slotsAt, setSlotsAt] = useState(now);
  const slots = useMemo(() => callbackSlots(slotsAt), [slotsAt]);
  const [pick, setPick] = useState<SlotKey | "custom" | null>(null);
  const [custom, setCustom] = useState(() => localInputs(new Date(now.getTime() + 3 * 3_600_000)).datetime);

  // ── send / schedule ──
  const [darbOpen, setDarbOpen] = useState(false);
  const [xdOpen, setXdOpen] = useState(false);
  const carriers = useCarrierChoice({
    orderId: order.id,
    marketId: order.marketId,
    enabled: tray === "send" || tray === "schedule" || darbOpen || xdOpen,
  });
  const [dexState, setDexState] = useState<DexpressSelection>({ stateId: null, stateName: "" });
  const [needState, setNeedState] = useState(false);
  const [dupAsk, setDupAsk] = useState<{ externalId: string | null } | null>(null);
  const tomorrow10 = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return localInputs(d);
  }, [now]);
  const [schedDate, setSchedDate] = useState(tomorrow10.date);
  const [schedTime, setSchedTime] = useState(tomorrow10.time);
  const [schedAuto, setSchedAuto] = useState(true);

  const groupOf = (k: string | null) => groups.find((g) => g.key === k) ?? null;
  const G = groupOf(group);
  const rejectReady = !!G && (G.noteOnly ? note.trim().length > 0 : G.subs.length === 0 || sub !== null);
  const offering = capture.enabled && !!G?.noteOnly;

  /** Open a step with a clean slate (prototype `act`: S.rj, S.cbk, S.car reset). */
  const openTray = useCallback(
    (k: Tray) => {
      outcome.setError(null);
      setDupAsk(null);
      setNeedState(false);
      if (k === "reject") {
        // At the ceiling the answer is « Injoignable › Ne répond pas », pre-chosen.
        if (atMax) {
          const inj = groups.find((g) => g.key === "injoignable");
          setGroup(inj ? inj.key : null);
          setSub(inj?.subs.find((s) => s.key === "pas_de_reponse")?.key ?? null);
        } else {
          setGroup(null);
          setSub(null);
        }
        setNote("");
      }
      if (k === "callback") {
        setSlotsAt(new Date());
        setPick(null);
      }
      setTrayState(k);
    },
    [atMax, groups, outcome],
  );

  const finish = useCallback(
    (line: DoneLine | null, r: OutcomeDone) => {
      setTrayState(null);
      setJustConfirmed(false);
      setDone(line);
      onDone(r);
    },
    [onDone],
  );

  /** Close the open step. Closing the post-confirm send step is « Plus tard »: it stays confirmed. */
  const dismiss = useCallback(() => {
    outcome.setError(null);
    setDupAsk(null);
    if (justConfirmed) {
      finish({ hue: "green", icon: "check", text: t("done.confirmed") }, { action: "confirmed", newStatus: "confirmed" });
      return;
    }
    setTrayState(null);
  }, [justConfirmed, finish, t, outcome]);

  /** Schedule's « Retour »: back to the send step after a confirmation, else out. */
  const back = useCallback(() => {
    if (justConfirmed) setTrayState("send");
    else dismiss();
  }, [justConfirmed, dismiss]);

  const act = useCallback(
    async (kind: "noAnswer" | "confirm" | Tray) => {
      if (outcome.busy) return;
      if (kind === "noAnswer") {
        const r = await outcome.noAnswer();
        if (!r) return;
        const n = r.attemptsCount ?? order.attempts + 1;
        const line: DoneLine = r.autoRejected
          ? { hue: "red", icon: "phoneoff", text: t("done.autoRejected") }
          : {
              hue: "amber",
              icon: "phone",
              // The market's ceiling may not be known yet: then the count stands alone, never over a guess.
              text: Number.isFinite(maxAttempts)
                ? r.callbackAt
                  ? t("done.attempt", { n, max: maxAttempts, time: cbWhen(r.callbackAt) })
                  : t("done.attemptPlain", { n, max: maxAttempts })
                : r.callbackAt
                  ? t("done.attemptBare", { n, time: cbWhen(r.callbackAt) })
                  : t("done.attemptBarePlain", { n }),
            };
        toast(t("toast.noAnswer"));
        finish(line, { action: "attempt", newStatus: r.newStatus, autoRejected: r.autoRejected });
        return;
      }
      if (kind === "confirm") {
        const ok = await outcome.confirm();
        if (!ok) return;
        setDone(null);
        setJustConfirmed(true);
        setTrayState("send");
        return;
      }
      openTray(kind);
    },
    [outcome, maxAttempts, order.attempts, t, cbWhen, toast, finish, openTray],
  );

  const chooseGroup = useCallback((k: string) => {
    setGroup(k);
    setSub(null);
  }, []);

  const submitReject = useCallback(async () => {
    if (!G || !rejectReady) return;
    const keep = offering && offer.state.on && note.trim().length > 0 && offer.state.category !== null;
    const ok = await outcome.reject({
      group: G.key,
      sub: G.noteOnly ? null : sub,
      note: note.trim() ? note.trim() : null,
      feedback: keep ? { category: offer.state.category as string, topicId: offer.state.topicId } : null,
    });
    if (!ok) return;
    const reason = G.subs.find((s) => s.key === sub)?.label ?? G.label;
    toast(keep ? t("toast.rejectedKept", { reason }) : t("toast.rejected", { reason }));
    finish({ hue: "red", icon: groupIcon(G.key), text: t("done.rejected", { reason }) }, { action: "rejected", newStatus: "rejected" });
  }, [G, rejectReady, offering, offer.state, note, sub, outcome, toast, t, finish]);

  const chosenAt: Date | null =
    pick === "custom" ? (custom ? new Date(custom) : null) : pick ? slots.find((s) => s.key === pick)?.at ?? null : null;

  const submitCallback = useCallback(async () => {
    if (!chosenAt) return;
    const ok = await outcome.callback(chosenAt);
    if (!ok) return;
    const when = cbWhen(chosenAt);
    toast(t("toast.callback", { when }));
    finish({ hue: "violet", icon: "clock", text: t("done.callback", { when }) }, { action: "callback", newStatus: "callback_scheduled" });
  }, [chosenAt, outcome, cbWhen, toast, t, finish]);

  const sent = useCallback(
    (tracking: string | null, carrierName: string) => {
      toast(t("toast.sent", { carrier: carrierName }));
      finish({ hue: "teal", icon: "truck", text: t("done.sent", { tracking: tracking ?? "—" }) }, { action: "confirmed", newStatus: "uploaded" });
    },
    [toast, t, finish],
  );

  const submitSend = useCallback(
    async (confirmDuplicate = false) => {
      const c = carriers.selectedCard;
      // Never a silent no-op: the button says why it did nothing.
      if (!c) {
        outcome.setError(carriers.loading ? t("send.loading") : carriers.cards.length ? t("send.pickFirst") : t("send.none"));
        return;
      }
      if (c.coverage === "uncovered") {
        outcome.setError(tCov("notCovered", { city: carriers.order?.customer_city ?? "" }));
        return;
      }
      // Darb asks its own questions (service, area, options) in its own form; X-Delivery
      // its governorate and optional delegation.
      const form = carrierFormFor(c.code);
      if (form === "darb") {
        setDarbOpen(true);
        return;
      }
      if (form === "xdelivery") {
        setXdOpen(true);
        return;
      }
      const savedState = carriers.order?.dexpress_state_id ?? null;
      if (c.code === "dexpress" && savedState === null && dexState.stateId === null) {
        setNeedState(true);
        return;
      }
      setDupAsk(null);
      const r = await outcome.dispatch(c.id, {
        stateId: c.code === "dexpress" ? savedState ?? dexState.stateId : null,
        confirmDuplicate,
      });
      if (r.kind === "duplicate") setDupAsk({ externalId: r.externalId });
      if (r.kind === "sent") sent(r.tracking, c.name);
    },
    [carriers.selectedCard, carriers.order, carriers.loading, carriers.cards.length, dexState.stateId, outcome, sent, t, tCov],
  );

  const scheduledAt = new Date(`${schedDate}T${schedTime}:00`);

  const submitSchedule = useCallback(async () => {
    const c = carriers.selectedCard;
    if (!c) {
      outcome.setError(carriers.loading ? t("send.loading") : carriers.cards.length ? t("send.pickFirst") : t("send.none"));
      return;
    }
    const ok = await outcome.schedule(c.id, scheduledAt, schedAuto);
    if (!ok) return;
    finish(
      { hue: "violet", icon: "cal", text: t("done.scheduled", { when: cbWhen(scheduledAt) }) },
      { action: "confirmed", newStatus: "dispatch_scheduled" },
    );
  }, [carriers.selectedCard, carriers.loading, carriers.cards.length, outcome, scheduledAt, schedAuto, finish, t, cbWhen]);

  const onDarbSuccess = useCallback(
    (tracking: string | null) => {
      setDarbOpen(false);
      sent(tracking, carriers.selectedCard?.name ?? "Darb Assabil");
    },
    [sent, carriers.selectedCard],
  );

  const onXdSuccess = useCallback(
    (tracking: string | null) => {
      setXdOpen(false);
      sent(tracking, carriers.selectedCard?.name ?? "X-Delivery");
    },
    [sent, carriers.selectedCard],
  );

  /** « Supprimer celle-ci » — held 5 s behind « Annuler » before anything is sent. */
  const deleteDup = useCallback(() => {
    const twin = order.twin;
    if (!twin) return;
    let undone = false;
    const timer = setTimeout(async () => {
      if (undone) return;
      const ok = await outcome.deleteDuplicate(twin.id);
      if (ok) onDone({ action: "deleted", newStatus: "deleted" });
      else toast(t("toast.dupFailed"));
    }, 5_000);
    toast(t("toast.dupDeleted", { ref: twin.ref }), () => {
      undone = true;
      clearTimeout(timer);
    });
  }, [order.twin, outcome, onDone, toast, t]);

  return {
    order,
    maxAttempts,
    atMax,
    tray,
    openTray,
    dismiss,
    back,
    act,
    justConfirmed,
    done,
    setDone,
    busy: outcome.busy,
    error: outcome.error,
    reject: { groups, group, sub, note, chooseGroup, setSub, setNote, ready: rejectReady, offering, offer, submit: submitReject },
    callback: { slots, pick, setPick, custom, setCustom, chosenAt, submit: submitCallback },
    send: {
      carriers,
      needState,
      dexState,
      setDexState,
      dupAsk,
      submit: submitSend,
      darbOpen,
      closeDarb: () => setDarbOpen(false),
      onDarbSuccess,
      xdOpen,
      closeXd: () => setXdOpen(false),
      onXdSuccess,
    },
    schedule: { date: schedDate, setDate: setSchedDate, time: schedTime, setTime: setSchedTime, auto: schedAuto, setAuto: setSchedAuto, at: scheduledAt, submit: submitSchedule },
    deleteDup,
    cbWhen,
  };
}

export type OutcomeFlow = ReturnType<typeof useOutcomeFlow>;

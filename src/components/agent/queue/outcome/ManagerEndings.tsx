"use client";

/**
 * The manager's call results (owner, 2026-10-05: « managers' call results use the new pop-up,
 * abandon the old one »). The manager keeps their own footer (ActionFooter — it carries what an
 * agent never has: return to the pool, restore, cancel), but its call-result buttons no longer open
 * the old PostCallActionSheet: they run the same flow as the agent's — the step opens inside the
 * order on a desktop (`.tray`), in the bottom sheet on a phone — and « Envoyer au transporteur » /
 * « Planifier la livraison » open the same send / schedule steps.
 *
 * The steps are drawn with agent.css, so they sit in an inline `.agt` layer (display: contents)
 * inside the managers' `.cmd` panel.
 */

import { useCallback, useEffect, type ReactNode } from "react";
import { Ic } from "@/components/agent/shared";
import { ActionFooter } from "@/components/queue/OrderDetailPanel/ActionFooter";
import type { PanelActionKind, PanelActions } from "@/components/queue/OrderDetailPanel/types";
import { useOutcomeFlow, type OutcomeOrder } from "./useOutcomeFlow";
import { OutcomeTray } from "./OutcomeTray";
import { DarbStep, OutcomeSheet, XDeliveryStep, type SheetEcho } from "./OutcomeSheet";
import type { OutcomeDone } from "./outcome-model";
import "@/components/agent/agent.css";
import "@/components/agent/agent-app.css";

export interface ManagerEndingsProps {
  order: OutcomeOrder;
  maxAttempts: number;
  phone: boolean;
  locale: string;
  echo: SheetEcho;
  actions: PanelActions;
  pending: boolean;
  /** The notices above the footer (AlertBanners) — hidden while a step is open, as for the agent. */
  banners: ReactNode;
  showNavHint: boolean;
  feedbackHint: boolean;
  onDone: (r: OutcomeDone) => void;
  /** Every action that is not a call result goes back to the panel. */
  onInvoke: (kind: PanelActionKind) => void;
}

export function ManagerEndings(p: ManagerEndingsProps) {
  const { onDone } = p;
  const done = useCallback((r: OutcomeDone) => onDone(r), [onDone]);
  const flow = useOutcomeFlow({ order: p.order, maxAttempts: p.maxAttempts, onDone: done });

  // An open step owns Escape: it closes the step, not the order (the panel listens on document,
  // so this runs first, on window, in the capture phase).
  useEffect(() => {
    if (!flow.tray) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || flow.send.darbOpen || flow.send.xdOpen) return;
      e.stopImmediatePropagation();
      flow.dismiss();
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [flow]);

  const invoke = (kind: PanelActionKind) => {
    switch (kind) {
      case "endCall":
        return void flow.act("noAnswer");
      case "confirm":
        return void flow.act("confirm");
      case "reject":
        return void flow.act("reject");
      case "callback":
      case "rescheduleCallback":
        return void flow.act("callback");
      case "uploadToCarrier":
      case "uploadNow":
        return flow.openTray("send");
      case "scheduleDispatch":
        return flow.openTray("schedule");
      default:
        return p.onInvoke(kind);
    }
  };

  const desktopTray = flow.tray && !p.phone;
  return (
    <div className="agt agt-layer agt-inline" dir={p.locale === "ar" ? "rtl" : "ltr"} lang={p.locale}>
      {flow.done ? (
        <div className="notes" data-testid="outcome-done">
          <div className={`note h-${flow.done.hue}`} role="status">
            <Ic n={flow.done.icon} />
            <span>{flow.done.text}</span>
          </div>
        </div>
      ) : null}
      {!flow.tray && flow.error ? (
        <div className="notes">
          <div className="note h-red" role="alert">
            <Ic n="alert" />
            <span>{flow.error}</span>
          </div>
        </div>
      ) : null}
      {desktopTray ? (
        <>
          <OutcomeTray flow={flow} />
          <DarbStep flow={flow} />
          <XDeliveryStep flow={flow} />
        </>
      ) : (
        <>
          {p.banners}
          <ActionFooter actions={p.actions} primaryPending={p.pending || flow.busy !== null} onInvoke={invoke} showNavHint={p.showNavHint} feedbackHint={p.feedbackHint} />
        </>
      )}
      {p.phone && flow.tray ? <OutcomeSheet flow={flow} echo={p.echo} onClose={flow.dismiss} /> : null}
    </div>
  );
}

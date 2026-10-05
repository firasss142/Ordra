"use client";

/**
 * The agent's endings, mounted by OrderDetailPanel for role="agent" only — so the manager's
 * panel never runs (or fetches for) any of this.
 */

import { useCallback } from "react";
import { useOutcomeFlow, type OutcomeOrder } from "./useOutcomeFlow";
import { AgentEndings, type AgentEndingsProps } from "./AgentEndings";
import type { OutcomeDone, Tray } from "./outcome-model";

export function AgentOrderEndings({
  order,
  maxAttempts,
  initialTray,
  onDone,
  ...rest
}: Omit<AgentEndingsProps, "flow"> & {
  order: OutcomeOrder;
  maxAttempts: number;
  initialTray?: Tray | null;
  onDone: (r: OutcomeDone) => void;
}) {
  const done = useCallback((r: OutcomeDone) => onDone(r), [onDone]);
  const flow = useOutcomeFlow({ order, maxAttempts, initialTray, onDone: done });
  // Closing the order right after a confirmation is « Plus tard »: it is reported as confirmed.
  const { onClose } = rest;
  const close = useCallback(() => {
    if (flow.justConfirmed) flow.dismiss();
    onClose();
  }, [flow, onClose]);
  return <AgentEndings {...rest} flow={flow} onClose={close} />;
}

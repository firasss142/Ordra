"use client";

/**
 * « Résultat de l'appel » from a queue row on a phone (plan decision 3): the green button
 * dials, then this asks how it went; a confirmed row's truck opens it on the send step.
 * After a recorded ending it reports `onDone`, then closes.
 */

import { useCallback, useEffect } from "react";
import type { QueueOrder } from "@/types/queue";
import { CALLING_STATUSES } from "@/lib/orders/row-signals";
import { twinOf, type OutcomeDone, type Tray } from "./outcome-model";
import { useOutcomeFlow } from "./useOutcomeFlow";
import { OutcomeSheet } from "./OutcomeSheet";

export interface CallResultSheetProps {
  order: QueueOrder;
  maxAttempts: number;
  marketId: string;
  initialStep?: Tray;
  onClose: () => void;
  onDone: (r: OutcomeDone) => void;
}

export function CallResultSheet({ order, maxAttempts, marketId, initialStep, onClose, onDone }: CallResultSheetProps) {
  const done = useCallback(
    (r: OutcomeDone) => {
      onDone(r);
      onClose();
    },
    [onDone, onClose],
  );
  const flow = useOutcomeFlow({
    order: {
      id: order.id,
      status: order.status,
      marketId: marketId || order.market_id,
      attempts: order.attempt_count ?? 0,
      currency: order.currency,
      twin: twinOf(order),
    },
    maxAttempts,
    initialTray: initialStep ?? null,
    onDone: done,
  });

  // A step opened straight from a non-calling row (the truck) has no list to fall back to.
  const calling = CALLING_STATUSES.has(order.status);
  useEffect(() => {
    if (!flow.tray && !flow.justConfirmed && !calling) onClose();
  }, [flow.tray, flow.justConfirmed, calling, onClose]);

  // Leaving right after a confirmation is « Plus tard »: it is recorded as confirmed.
  const close = useCallback(() => {
    if (flow.justConfirmed) flow.dismiss();
    else onClose();
  }, [flow, onClose]);

  return (
    <OutcomeSheet
      flow={flow}
      onClose={close}
      echo={{
        name: order.customer_name,
        phone: order.customer_phone,
        productName: order.product_display_name || order.product_name,
        imageUrl: order.product_image_url,
        quantity: order.quantity,
        total: order.total_price,
      }}
    />
  );
}

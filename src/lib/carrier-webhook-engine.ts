import type { OrderStatus } from "@/types/order-status";

export type CarrierEventMapping = {
  status_to: OrderStatus;
  stock_effect: "decrement" | "increment" | "none";
  actor_note: string;
  damaged?: boolean;
};

type EventSpec = {
  status_to: OrderStatus;
  stock_effect: "decrement" | "increment" | "none";
  damaged?: boolean;
};

const SHARED_EVENT_MAP: Record<string, EventSpec> = {
  package_received: { status_to: "deposit", stock_effect: "decrement" },
  deposit:          { status_to: "deposit", stock_effect: "decrement" },
  in_transit:       { status_to: "in_transit", stock_effect: "none" },
  delivered:        { status_to: "delivered", stock_effect: "none" },
  return_initiated: { status_to: "to_be_returned", stock_effect: "none" },
  returned:         { status_to: "returned", stock_effect: "increment", damaged: false },
  damaged_return:   { status_to: "returned", stock_effect: "none", damaged: true },
};

function mapEvent(carrier: string, event: string): CarrierEventMapping | null {
  const spec = SHARED_EVENT_MAP[event];
  if (!spec) return null;
  const mapping: CarrierEventMapping = {
    status_to: spec.status_to,
    stock_effect: spec.stock_effect,
    actor_note: `${carrier}: ${event}`,
  };
  if (spec.damaged !== undefined) {
    mapping.damaged = spec.damaged;
  }
  return mapping;
}

export function mapNavexEvent(event: string): CarrierEventMapping | null {
  return mapEvent("Navex", event);
}

export function mapDexpressEvent(event: string): CarrierEventMapping | null {
  return mapEvent("Dexpress", event);
}

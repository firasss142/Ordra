import type { Role } from "@/types";

export interface HistoryEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  actor_id: string | null;
  actor_type: string | null;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  variant_id: string | null;
  variant_label: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
  updated_at: string;
}

export interface OrderDetail {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_phone_2: string | null;
  customer_city: string | null;
  customer_address: string | null;
  customer_note: string | null;
  product_id: string | null;
  product_name: string;
  variant_id: string | null;
  variant_label: string | null;
  city_id: string | null;
  dexpress_state_id: number | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  delivery_fee: number;
  card_payment: boolean;
  currency: string;
  status: string;
  assigned_to: string | null;
  /** Resolved server-side — `null` means unassigned, never "not looked up". */
  assigned_agent_name: string | null;
  market_id: string;
  attempts_count?: number | null;
  /** Intake time — drives the header's elapsed-time reading. */
  created_at: string;
  updated_at: string;
  /** Storefront order number. Preferred over the UUID as the human reference. */
  external_id: string | null;
  tracking_number: string | null;
  carrier_id: string | null;
  carrier_barcode_deleted_at: string | null;
  carrier_barcode_deleted_carrier_code: string | null;
  callback_scheduled_at: string | null;
  scheduled_dispatch_at: string | null;
  scheduled_dispatch_auto: boolean | null;
  scheduled_dispatch_carrier_id: string | null;
  history: HistoryEntry[];
  order_items: OrderItem[];
}

export type PanelActionKind =
  | "confirm"
  | "callback"
  | "reject"
  | "endCall"
  | "uploadToCarrier"
  | "uploadNow"
  | "close"
  | "returnToPool"
  | "cancel"
  | "rescheduleCallback"
  | "changeStatus"
  | "scheduleDispatch"
  | "cancelSchedule"
  | "deleteCarrierBarcode"
  | "reopen"
  | "recover"
  | "fulfillmentOverride";

export interface PanelAction {
  /** Action identifier — also the i18n suffix under `orders.detail.actions.*`. */
  kind: PanelActionKind;
  /** Translation key path, e.g. `actions.uploadToCarrier`. */
  labelKey: string;
  /** Optional tooltip key path shown when `disabled` is true. */
  disabledReasonKey?: string;
  /** Disabled means visible but non-interactive (e.g. no active carrier). */
  disabled?: boolean;
  /** Destructive items get a critical color treatment in the overflow menu. */
  destructive?: boolean;
}

export interface PanelActions {
  primary: PanelAction;
  /**
   * The other ways a call can end, rendered as buttons beside the primary.
   * Only the in-confirmation group has any: everywhere else the panel has one
   * next step, not a choice between three.
   */
  outcomes?: PanelAction[];
  overflow: PanelAction[];
}

export interface PrimaryActionInputs {
  order: Pick<
    OrderDetail,
    | "status"
    | "assigned_to"
    | "updated_at"
    | "tracking_number"
    | "carrier_barcode_deleted_at"
  >;
  role: Role | undefined;
  userId: string | undefined;
  /** Whether the market currently exposes at least one active carrier. */
  hasActiveCarrier: boolean;
  /** Whether the agent's pool exposes a "return to pool" affordance. */
  canReturnToPool?: boolean;
  /** Optional now for deterministic tests; defaults to `new Date()`. */
  now?: Date;
}

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  CheckCircle2,
  Globe,
  Package,
  Pencil,
  Phone,
  PhoneCall,
  Sheet,
  ShieldAlert,
  Trash2,
  Truck,
  UserPlus,
  XCircle,
} from "lucide-react";

/**
 * Picks the lucide icon that leads a status-history entry's pill in the popover.
 * Precedence: note-pattern → status → actor_type → Activity (fallback).
 *
 * The note patterns mirror the recognised intake/assignment notes written by
 * webhook handlers, the orders create endpoint, and the assignment RPCs.
 */
export function eventIconFor(args: {
  to_status: string;
  actor_type: "system" | "agent" | "manager";
  note: string | null;
}): LucideIcon {
  const { to_status, actor_type, note } = args;

  if (note) {
    if (/^Order received via Google Sheets sync/i.test(note)) return Sheet;
    if (/^Order received via webhook/i.test(note)) return Globe;
    if (/^Order created manually/i.test(note)) return Pencil;
    if (/^Order created by agent/i.test(note)) return Pencil;
    if (/^Assigned to agent/i.test(note)) return UserPlus;
    if (/^Auto-assigned/i.test(note)) return UserPlus;
    if (/^Assigné à l'agent/i.test(note)) return UserPlus;
  }

  if (to_status === "attempt_1" || to_status === "attempt_2" || to_status === "attempt_3") {
    return Phone;
  }
  if (to_status === "callback_scheduled") return PhoneCall;
  if (to_status === "confirmed") return CheckCircle2;
  if (
    to_status === "uploaded" ||
    to_status === "scanned" ||
    to_status === "dispatched" ||
    to_status === "deposit" ||
    to_status === "in_transit"
  ) {
    return Truck;
  }
  if (to_status === "delivered") return Package;
  if (to_status === "rejected" || to_status === "cancelled") return XCircle;
  if (to_status === "deleted") return Trash2;

  if (actor_type === "manager") return ShieldAlert;
  return Activity;
}

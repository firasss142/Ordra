import { describe, it, expect } from "vitest";
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
import { eventIconFor } from "./order-history-event-icon";

const base = { actor_type: "system" as const, to_status: "pending", note: null };

describe("eventIconFor", () => {
  it("matches Google Sheets intake first (note pattern wins over status)", () => {
    expect(
      eventIconFor({ ...base, note: "Order received via Google Sheets sync" }),
    ).toBe(Sheet);
  });

  it("matches webhook intake", () => {
    expect(
      eventIconFor({ ...base, note: "Order received via webhook" }),
    ).toBe(Globe);
  });

  it("matches manual creation", () => {
    expect(eventIconFor({ ...base, note: "Order created manually" })).toBe(Pencil);
    expect(
      eventIconFor({ ...base, note: "Order created by agent (self-assigned)" }),
    ).toBe(Pencil);
  });

  it("matches manual + auto assignment notes", () => {
    expect(eventIconFor({ ...base, note: "Assigned to agent" })).toBe(UserPlus);
    expect(
      eventIconFor({ ...base, note: "Auto-assigned via Tour de rôle" }),
    ).toBe(UserPlus);
  });

  it("maps attempt statuses to Phone", () => {
    for (const s of ["attempt_1", "attempt_2", "attempt_3"]) {
      expect(eventIconFor({ ...base, to_status: s, actor_type: "agent" })).toBe(Phone);
    }
  });

  it("maps callback_scheduled to PhoneCall", () => {
    expect(
      eventIconFor({ ...base, to_status: "callback_scheduled", actor_type: "agent" }),
    ).toBe(PhoneCall);
  });

  it("maps confirmed to CheckCircle2", () => {
    expect(
      eventIconFor({ ...base, to_status: "confirmed", actor_type: "agent" }),
    ).toBe(CheckCircle2);
  });

  it("maps carrier-flow statuses to Truck", () => {
    for (const s of ["uploaded", "scanned", "dispatched", "deposit", "in_transit"]) {
      expect(eventIconFor({ ...base, to_status: s })).toBe(Truck);
    }
  });

  it("maps delivered to Package", () => {
    expect(eventIconFor({ ...base, to_status: "delivered" })).toBe(Package);
  });

  it("maps rejected and cancelled to XCircle", () => {
    expect(
      eventIconFor({ ...base, to_status: "rejected", actor_type: "agent" }),
    ).toBe(XCircle);
    expect(
      eventIconFor({ ...base, to_status: "cancelled", actor_type: "manager" }),
    ).toBe(XCircle);
  });

  it("maps deleted to Trash2", () => {
    expect(
      eventIconFor({ ...base, to_status: "deleted", actor_type: "manager" }),
    ).toBe(Trash2);
  });

  it("falls back to ShieldAlert for unrecognised manager actions", () => {
    expect(
      eventIconFor({ ...base, to_status: "something_new", actor_type: "manager" }),
    ).toBe(ShieldAlert);
  });

  it("falls back to Activity for anything else", () => {
    expect(eventIconFor({ ...base, to_status: "weird" })).toBe(Activity);
  });

  it("status takes precedence over actor_type once note doesn't match", () => {
    // A manager who CONFIRMS should still get CheckCircle2 (status wins).
    expect(
      eventIconFor({ ...base, to_status: "confirmed", actor_type: "manager" }),
    ).toBe(CheckCircle2);
  });
});

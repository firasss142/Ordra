import { describe, it, expect } from "vitest";
import { resolvePanelActions } from "../usePrimaryAction";
import type { PrimaryActionInputs } from "../types";

const NOW = new Date("2026-05-30T12:00:00.000Z");
const RECENT = new Date(NOW.getTime() - 1000 * 60 * 60).toISOString(); // 1h ago — inside agent window
const STALE = new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 30).toISOString(); // 30d ago — outside agent window

function input(overrides: Partial<PrimaryActionInputs> = {}): PrimaryActionInputs {
  return {
    order: {
      status: "pending",
      assigned_to: "agent-1",
      updated_at: RECENT,
      tracking_number: null,
      carrier_barcode_deleted_at: null,
      ...overrides.order,
    },
    role: "agent",
    userId: "agent-1",
    hasActiveCarrier: true,
    canReturnToPool: true,
    now: NOW,
    ...overrides,
  };
}

const inConfirmation = (status: string, overrides: Partial<PrimaryActionInputs> = {}) =>
  resolvePanelActions(
    input({
      order: {
        status,
        assigned_to: "agent-1",
        updated_at: RECENT,
        tracking_number: null,
        carrier_barcode_deleted_at: null,
      },
      ...overrides,
    }),
  );

describe("resolvePanelActions — the three call outcomes", () => {
  it("leads with confirm on pending", () => {
    const { primary } = inConfirmation("pending");
    expect(primary.kind).toBe("confirm");
    expect(primary.labelKey).toBe("actions.confirm");
  });

  it("offers callback and reject beside it, in that order", () => {
    const { outcomes } = inConfirmation("pending");
    expect(outcomes?.map((o) => o.kind)).toEqual(["callback", "reject"]);
  });

  it("marks reject as destructive so it never wears the confirm colour", () => {
    const { outcomes } = inConfirmation("pending");
    expect(outcomes?.find((o) => o.kind === "reject")?.destructive).toBe(true);
  });

  it("offers the same three outcomes on every attempt_* status", () => {
    for (const status of ["attempt_1", "attempt_2", "attempt_3"]) {
      const { primary, outcomes } = inConfirmation(status);
      expect(primary.kind).toBe("confirm");
      expect(outcomes).toHaveLength(2);
    }
  });

  it("offers them on callback_scheduled too", () => {
    expect(inConfirmation("callback_scheduled").primary.kind).toBe("confirm");
  });

  it("keeps the full call sheet one click away, since no-answer has no button", () => {
    // "Sans réponse" is the outcome the three buttons dropped. It stays
    // reachable through the overflow rather than disappearing.
    const { overflow } = inConfirmation("pending");
    expect(overflow[0].kind).toBe("endCall");
  });

  it("offers no outcomes once the call is behind us", () => {
    const { outcomes } = resolvePanelActions(
      input({
        order: {
          status: "confirmed",
          assigned_to: "agent-1",
          updated_at: RECENT,
          tracking_number: null,
          carrier_barcode_deleted_at: null,
        },
      }),
    );
    expect(outcomes ?? []).toHaveLength(0);
  });
});

describe("resolvePanelActions — primary CTA", () => {

  it("returns uploadToCarrier for confirmed when an active carrier exists", () => {
    const { primary } = resolvePanelActions(input({ order: { status: "confirmed", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null } }));
    expect(primary.kind).toBe("uploadToCarrier");
    expect(primary.disabled).toBeFalsy();
  });

  it("disables uploadToCarrier when no active carrier and surfaces primaryDisabledNoCarrier", () => {
    const { primary } = resolvePanelActions(input({
      order: { status: "confirmed", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
      hasActiveCarrier: false,
    }));
    expect(primary.kind).toBe("uploadToCarrier");
    expect(primary.disabled).toBe(true);
    expect(primary.disabledReasonKey).toBe("actions.primaryDisabledNoCarrier");
  });

  it("returns uploadNow for dispatch_scheduled and includes cancelSchedule in overflow", () => {
    const { primary, overflow } = resolvePanelActions(input({ order: { status: "dispatch_scheduled", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null } }));
    expect(primary.kind).toBe("uploadNow");
    expect(overflow.some((a) => a.kind === "cancelSchedule")).toBe(true);
  });

  it("returns close for terminal statuses with empty overflow", () => {
    for (const status of ["delivered", "returned", "cancelled", "deleted"]) {
      const { primary, overflow } = resolvePanelActions(input({ order: { status, assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null } }));
      expect(primary.kind).toBe("close");
      expect(overflow).toEqual([]);
    }
  });

  it("promotes recover to primary for deleted orders when the actor is a manager/admin", () => {
    for (const role of ["market_manager", "super_admin"] as const) {
      const { primary, overflow } = resolvePanelActions(
        input({
          role,
          order: { status: "deleted", assigned_to: null, updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
        }),
      );
      expect(primary.kind).toBe("recover");
      expect(primary.labelKey).toBe("actions.recover");
      expect(overflow).toEqual([]);
    }
  });

  it("does NOT offer recover to agents on a deleted order (close-only)", () => {
    const { primary } = resolvePanelActions(
      input({
        role: "agent",
        order: { status: "deleted", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
      }),
    );
    expect(primary.kind).toBe("close");
  });

  it("promotes reopen to primary for rejected within agent window; falls back to close when stale", () => {
    const fresh = resolvePanelActions(input({ order: { status: "rejected", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null } }));
    expect(fresh.primary.kind).toBe("reopen");
    expect(fresh.overflow.some((a) => a.kind === "reopen")).toBe(false);

    const stale = resolvePanelActions(input({ order: { status: "rejected", assigned_to: "agent-1", updated_at: STALE, tracking_number: null, carrier_barcode_deleted_at: null } }));
    expect(stale.primary.kind).toBe("close");
    expect(stale.overflow.some((a) => a.kind === "reopen")).toBe(false);
  });

  it("agent on uploaded with reference_deleted reverts to confirmed action set", () => {
    const { primary } = resolvePanelActions(input({
      order: {
        status: "uploaded",
        assigned_to: "agent-1",
        updated_at: RECENT,
        tracking_number: null,
        carrier_barcode_deleted_at: RECENT,
      },
    }));
    expect(primary.kind).toBe("uploadToCarrier");
  });

  it("promotes reopen to primary for uploaded within agent window and exposes deleteCarrierBarcode in overflow", () => {
    const { primary, overflow } = resolvePanelActions(input({
      order: { status: "uploaded", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
    }));
    expect(primary.kind).toBe("reopen");
    expect(overflow.some((a) => a.kind === "deleteCarrierBarcode")).toBe(true);
    expect(overflow.some((a) => a.kind === "reopen")).toBe(false);
  });

  it("marks deleting the carrier barcode destructive, because it cancels a shipment", () => {
    // The footer promotes the first non-destructive overflow action to a
    // labelled button. Unflagged, "Supprimer le code-barres" was landing next
    // to the primary CTA — one mis-click from pulling a live shipment back.
    const { overflow } = resolvePanelActions(input({
      order: { status: "uploaded", assigned_to: "agent-1", updated_at: STALE, tracking_number: "TR123", carrier_barcode_deleted_at: null },
    }));
    const del = overflow.find((a) => a.kind === "deleteCarrierBarcode");
    expect(del?.destructive).toBe(true);
  });

  it("falls back to close for uploaded when stale; reopen does not appear", () => {
    const { primary, overflow } = resolvePanelActions(input({
      order: { status: "uploaded", assigned_to: "agent-1", updated_at: STALE, tracking_number: "TR123", carrier_barcode_deleted_at: null },
    }));
    expect(primary.kind).toBe("close");
    expect(overflow.some((a) => a.kind === "reopen")).toBe(false);
  });

  it("promotes reopen to primary for dispatched within agent window", () => {
    const { primary } = resolvePanelActions(input({
      order: { status: "dispatched", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
    }));
    expect(primary.kind).toBe("reopen");
  });
});

/**
 * Opening an uploaded order from the orders page gave a manager "Fermer" where
 * the same order in the agent queue gave "Rouvrir" — the resolver returned
 * early for any role that was not `agent`. A manager's whole job is correcting
 * what an agent did; the ownership and window checks are agent guardrails, not
 * a statement about what a manager may undo.
 */
describe("resolvePanelActions — reopen is not agent-only", () => {
  const uploaded = (over: Partial<PrimaryActionInputs>) =>
    resolvePanelActions(input({
      order: {
        status: "uploaded",
        assigned_to: "agent-1",
        updated_at: RECENT,
        tracking_number: "TR123",
        carrier_barcode_deleted_at: null,
      },
      ...over,
    }));

  for (const role of ["market_manager", "super_admin"] as const) {
    it(`leads with reopen on an uploaded order for ${role}`, () => {
      expect(uploaded({ role, userId: "manager-1" }).primary.kind).toBe("reopen");
    });

    it(`still leads with reopen for ${role} when the order is outside the agent window`, () => {
      const { primary } = resolvePanelActions(input({
        order: { status: "uploaded", assigned_to: "agent-1", updated_at: STALE, tracking_number: "TR123", carrier_barcode_deleted_at: null },
        role,
        userId: "manager-1",
      }));
      expect(primary.kind).toBe("reopen");
    });

    it(`keeps the destructive overflow beside ${role}'s reopen`, () => {
      // Reopen and barcode-deletion are different landings — pending vs
      // confirmed — so promoting one must not remove the other.
      const { overflow } = uploaded({ role, userId: "manager-1" });
      expect(overflow.some((a) => a.kind === "deleteCarrierBarcode")).toBe(true);
      expect(overflow.some((a) => a.kind === "cancel")).toBe(true);
    });

    it(`leads with reopen on a rejected order for ${role}`, () => {
      const { primary } = resolvePanelActions(input({
        order: { status: "rejected", assigned_to: "agent-1", updated_at: STALE, tracking_number: null, carrier_barcode_deleted_at: null },
        role,
        userId: "manager-1",
      }));
      expect(primary.kind).toBe("reopen");
    });

    it(`still refuses a genuinely terminal status for ${role}`, () => {
      for (const status of ["delivered", "returned"]) {
        const { primary } = resolvePanelActions(input({
          order: { status, assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
          role,
          userId: "manager-1",
        }));
        expect(primary.kind, status).toBe("close");
      }
    });
  }

  it("leaves warehouse_agent with close — reopen is not theirs to do", () => {
    expect(uploaded({ role: "warehouse_agent", userId: "wh-1" }).primary.kind).toBe("close");
  });

  it("a reference-deleted upload is still an upload job, not a reopen", () => {
    // No tracking number and a deletion stamp means it already came back from
    // the carrier; it behaves as `confirmed` and wants re-uploading.
    const { primary } = resolvePanelActions(input({
      order: { status: "uploaded", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: RECENT },
      role: "market_manager",
      userId: "manager-1",
    }));
    expect(primary.kind).toBe("uploadToCarrier");
  });
});

describe("resolvePanelActions — overflow by role", () => {
  it("manager overflow on confirmed includes cancel and scheduleDispatch", () => {
    const { overflow } = resolvePanelActions(input({
      order: { status: "confirmed", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
      role: "market_manager",
      userId: undefined,
    }));
    expect(overflow.some((a) => a.kind === "cancel")).toBe(true);
    expect(overflow.some((a) => a.kind === "scheduleDispatch")).toBe(true);
  });

  it("super_admin overflow mirrors manager on confirmed", () => {
    const { overflow } = resolvePanelActions(input({
      order: { status: "confirmed", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
      role: "super_admin",
      userId: undefined,
    }));
    expect(overflow.some((a) => a.kind === "cancel")).toBe(true);
    expect(overflow.some((a) => a.kind === "scheduleDispatch")).toBe(true);
  });

  it("agent overflow on confirmed includes scheduleDispatch but excludes cancel", () => {
    const { overflow } = resolvePanelActions(input({
      order: { status: "confirmed", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
    }));
    expect(overflow.some((a) => a.kind === "scheduleDispatch")).toBe(true);
    expect(overflow.some((a) => a.kind === "cancel")).toBe(false);
  });

  it("agent overflow on pending includes returnToPool when canReturnToPool is true", () => {
    const { overflow } = resolvePanelActions(input({ canReturnToPool: true }));
    expect(overflow.some((a) => a.kind === "returnToPool")).toBe(true);
  });

  it("agent overflow on pending omits returnToPool when canReturnToPool is false", () => {
    const { overflow } = resolvePanelActions(input({ canReturnToPool: false }));
    expect(overflow.some((a) => a.kind === "returnToPool")).toBe(false);
  });

  it("manager overflow on uploaded includes cancel; agent overflow does not", () => {
    const managerOverflow = resolvePanelActions(input({
      order: { status: "uploaded", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
      role: "market_manager",
      userId: undefined,
    })).overflow;
    expect(managerOverflow.some((a) => a.kind === "cancel")).toBe(true);

    const agentOverflow = resolvePanelActions(input({
      order: { status: "uploaded", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
    })).overflow;
    expect(agentOverflow.some((a) => a.kind === "cancel")).toBe(false);
  });
});

describe("resolvePanelActions — fulfillment-stage statuses", () => {
  it("returns close for non-reopenable fulfillment statuses (scanned/deposit/in_transit)", () => {
    // `dispatched` is also fulfillment-stage but it's reopenable and therefore
    // tested separately — its primary CTA flips to "reopen" within the window.
    for (const status of ["scanned", "deposit", "in_transit"]) {
      const { primary } = resolvePanelActions(input({
        order: { status, assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
      }));
      expect(primary.kind).toBe("close");
    }
  });

  it("manager overflow on scanned offers no fulfillment override", () => {
    // The manual fulfillment override was removed: carrier status is authoritative
    // and arrives via the sweep, so a hand-entered status could only contradict it.
    const { overflow } = resolvePanelActions(input({
      order: { status: "scanned", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
      role: "market_manager",
      userId: undefined,
    }));
    expect(overflow.map((a) => a.kind)).not.toContain("fulfillmentOverride");
  });

  it("agent overflow on scanned is empty", () => {
    const { overflow } = resolvePanelActions(input({
      order: { status: "scanned", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
    }));
    expect(overflow).toEqual([]);
  });
});

describe("resolvePanelActions — terminal cancel is destructive", () => {
  it("cancel action is flagged destructive", () => {
    const { overflow } = resolvePanelActions(input({
      order: { status: "pending", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
      role: "market_manager",
      userId: undefined,
    }));
    const cancel = overflow.find((a) => a.kind === "cancel");
    expect(cancel?.destructive).toBe(true);
  });
});

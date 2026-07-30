import { NextRequest, NextResponse } from "next/server";
import { isPeriodLocked } from "./period-lock";

/**
 * Closed-period guard shared by every ad_spend mutation (create, edit,
 * delete, CSV import). Returns a response to short-circuit with, or null
 * when the mutation may proceed.
 */
export function enforcePeriodLock(
  periodEnd: string,
  role: string,
  req: NextRequest,
): NextResponse | null {
  if (!isPeriodLocked(periodEnd)) return null;
  if (role !== "super_admin") {
    return NextResponse.json(
      { error: "period_locked", message: "This period is closed. Only super_admin can edit." },
      { status: 403 },
    );
  }
  const confirm = req.headers.get("x-confirm-locked-period");
  if (confirm !== "true") {
    return NextResponse.json(
      {
        error: "period_locked_confirmation_required",
        message: "Closed-period edits require x-confirm-locked-period: true header.",
      },
      { status: 409 },
    );
  }
  return null;
}

/** Non-response variant for batch flows (CSV import): true = locked & not allowed. */
export function isLockedForActor(periodEnd: string, role: string, req: NextRequest): boolean {
  if (!isPeriodLocked(periodEnd)) return false;
  if (role !== "super_admin") return true;
  return req.headers.get("x-confirm-locked-period") !== "true";
}

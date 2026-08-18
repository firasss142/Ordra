import type { PayoutRequest } from "@/components/team/control-room/PayoutModal";

/** POST /api/team/commissions/payouts — returns ok + the server's code on refusal. */
export async function submitPayout(req: PayoutRequest): Promise<{ ok: boolean; code?: string }> {
  try {
    const res = await fetch("/api/team/commissions/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    return { ok: false, code: body.code };
  } catch {
    return { ok: false };
  }
}

import type { UserWithStats } from "@/types";

export const TN = "00000000-0000-0000-0000-000000000001";
export const LY = "00000000-0000-0000-0000-000000000002";
export const TRIPOLI = "0dfa8255-0c13-478f-b24d-0fb037c7e09a";
export const BENGHAZI = "6639af0c-be36-4cca-aed8-67e0c60ebee9";

/** A row as GET /api/users returns it — every column, active, never seen. */
export function accessUser(over: Partial<UserWithStats> & { full_name: string }): UserWithStats {
  const slug = over.full_name.trim().toLowerCase().replace(/\s+/g, ".");
  return {
    id: `u-${slug}`,
    email: `${slug}@oms.local`,
    avatar_url: null,
    role: "agent",
    market_id: LY,
    warehouse_id: null,
    is_active: true,
    invitation_sent_at: null,
    invitation_accepted_at: null,
    deactivation_reason: null,
    last_seen_at: null,
    created_at: "2026-06-01T10:00:00Z",
    ...over,
  };
}

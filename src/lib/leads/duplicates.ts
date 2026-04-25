import type { LeadStatus } from "@/types/lead";
import { normalizePhone } from "./phone";

export interface DuplicateResult {
  id: string;
  customer_name: string;
  status: LeadStatus;
  market_id: string;
}

// Minimal Supabase-compatible interface for testability
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilder = any;

export async function findPhoneDuplicates(
  supabase: { from(table: string): QueryBuilder },
  rawPhone: string,
  marketId: string,
  excludeLeadId?: string,
): Promise<DuplicateResult[]> {
  const digits = normalizePhone(rawPhone);
  if (!digits) return [];

  let query = supabase
    .from("leads")
    .select("id, customer_name, status, market_id")
    .ilike("customer_phone", `%${digits}%`)
    .eq("market_id", marketId);

  if (excludeLeadId) {
    query = query.neq("id", excludeLeadId);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data as DuplicateResult[];
}

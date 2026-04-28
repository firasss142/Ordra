// PostgREST enforces a server-side row cap (default 1000 in Supabase).
// Client-side .limit(N) cannot exceed that cap. To pull all matching rows we
// page through with .range(). Use only when full enumeration is needed —
// count queries (head:true) and aggregations are not affected.
//
// The builder type uses `unknown` because Supabase's inferred row shape often
// disagrees with hand-typed mappings (e.g. embedded `orders` is typed as an
// array by inference, but we treat it as a single record). Callers cast the
// result to the exact shape they expect via the generic parameter.
export async function fetchAllRows<Row>(
  builder: {
    range: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
): Promise<Row[]> {
  const PAGE = 1000;
  const out: Row[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await builder.range(start, start + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (Array.isArray(data) ? data : []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    if (out.length >= 200_000) break; // safety bail
  }
  return out;
}

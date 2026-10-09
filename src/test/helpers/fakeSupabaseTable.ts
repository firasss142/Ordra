/**
 * A tiny in-memory stand-in for a Supabase table query.
 *
 * It APPLIES the filters it is given (eq / is / in / order / limit) to a fixed
 * set of rows, so a test can assert on what a route returns rather than on the
 * filter strings it built — the difference between "the route asked for one
 * building" and "the route showed one building". `or()` is accepted and
 * ignored (a keyset cursor), and `select()` returns whole rows.
 *
 * Awaiting the chain resolves `{ data, error: null }`, like PostgREST.
 */
export type Row = Record<string, unknown>;

export interface FakeQueryLog {
  table: string;
  eq: Array<[string, unknown]>;
}

export function fakeTableQuery(table: string, rows: Row[], log?: FakeQueryLog[]) {
  let current = [...rows];
  const entry: FakeQueryLog = { table, eq: [] };
  log?.push(entry);
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (col: string, val: unknown) => {
    entry.eq.push([col, val]);
    current = current.filter((r) => r[col] === val);
    return q;
  };
  q.is = (col: string, val: unknown) => {
    current = current.filter((r) => (r[col] ?? null) === val);
    return q;
  };
  q.in = (col: string, vals: unknown[]) => {
    current = current.filter((r) => vals.includes(r[col]));
    return q;
  };
  q.or = () => q;
  q.order = (col: string, opts?: { ascending?: boolean }) => {
    const dir = opts?.ascending === false ? -1 : 1;
    current = [...current].sort((a, b) =>
      String(a[col]) < String(b[col]) ? -dir : String(a[col]) > String(b[col]) ? dir : 0,
    );
    return q;
  };
  q.limit = (n: number) => {
    current = current.slice(0, n);
    return q;
  };
  q.maybeSingle = () => Promise.resolve({ data: current[0] ?? null, error: null });
  q.single = () => Promise.resolve({ data: current[0] ?? null, error: null });
  q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve({ data: current, error: null }).then(resolve, reject);
  return q;
}

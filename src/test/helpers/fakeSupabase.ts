/**
 * In-memory double of the supabase-js query builder, for route and handler
 * tests that need several tables to behave consistently (a webhook that
 * updates a message, bumps a conversation and inserts a notification).
 *
 * Supports the subset this repo's WhatsApp code uses: from / select / eq /
 * neq / in / is / gt / gte / lt / lte / order / limit / maybeSingle / single /
 * insert / upsert / update / delete / rpc, and awaiting the chain directly.
 * Anything else throws loudly rather than returning undefined.
 *
 * TEST ONLY — lives in src/test/helpers and must never be imported by
 * production code.
 */
import { vi } from "vitest";

export type Row = Record<string, unknown>;

type Filter = (row: Row) => boolean;

interface Op {
  kind: "select" | "insert" | "upsert" | "update" | "delete";
  payload?: Row | Row[];
  options?: { onConflict?: string; count?: string; head?: boolean };
}

export interface FakeSupabase {
  client: {
    from: (table: string) => Chain;
    rpc: (name: string, args?: Row) => Promise<{ data: unknown; error: unknown }>;
  };
  tables: Record<string, Row[]>;
  rpcs: Record<string, (args: Row) => unknown>;
  /** Every mutation, in order — assert on writes without digging into tables. */
  log: { table: string; op: Op["kind"]; payload?: Row | Row[] }[];
  /** Force the next call on a table to fail. */
  failNext: (table: string, error?: { message: string; code?: string }) => void;
}

let idSeq = 1;

export function makeFakeSupabase(seed: Record<string, Row[]> = {}): FakeSupabase {
  const tables: Record<string, Row[]> = {};
  for (const [k, rows] of Object.entries(seed)) tables[k] = rows.map((r) => ({ ...r }));
  const rpcs: Record<string, (args: Row) => unknown> = {};
  const log: FakeSupabase["log"] = [];
  const failures: Record<string, { message: string; code?: string }> = {};

  const ensure = (table: string) => (tables[table] ??= []);

  const client = {
    from: (table: string) => new Chain(table, ensure, log, failures),
    rpc: async (name: string, args: Row = {}) => {
      const fn = rpcs[name];
      if (!fn) return { data: null, error: { message: `rpc ${name} not stubbed` } };
      try {
        return { data: await fn(args), error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
  };

  return {
    client,
    tables,
    rpcs,
    log,
    failNext: (table, error = { message: "forced failure" }) => {
      failures[table] = error;
    },
  };
}

class Chain implements PromiseLike<{ data: unknown; error: unknown; count: number | null }> {
  private filters: Filter[] = [];
  private op: Op = { kind: "select" };
  private orderBy: { col: string; ascending: boolean }[] = [];
  private limitN: number | null = null;
  private mode: "single" | "maybe" | null = null;
  private returning = false;

  constructor(
    private table: string,
    private ensure: (t: string) => Row[],
    private log: FakeSupabase["log"],
    private failures: Record<string, { message: string; code?: string }>,
  ) {}

  select(_cols?: string, options?: { count?: string; head?: boolean }) {
    if (this.op.kind === "select") this.op.options = options;
    else this.returning = true;
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (v === null ? r[col] === null || r[col] === undefined : r[col] === v));
    return this;
  }
  not(col: string, op: string, v: unknown) {
    if (op === "is" && v === null) this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    else throw new Error(`fakeSupabase: not(${op}) unsupported`);
    return this;
  }
  gt(col: string, v: unknown) {
    this.filters.push((r) => (r[col] as never) > (v as never));
    return this;
  }
  gte(col: string, v: unknown) {
    this.filters.push((r) => (r[col] as never) >= (v as never));
    return this;
  }
  lt(col: string, v: unknown) {
    this.filters.push((r) => (r[col] as never) < (v as never));
    return this;
  }
  lte(col: string, v: unknown) {
    this.filters.push((r) => (r[col] as never) <= (v as never));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  single(): any {
    this.mode = "single";
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = { kind: "insert", payload };
    return this;
  }
  upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    this.op = { kind: "upsert", payload, options };
    return this;
  }
  update(payload: Row) {
    this.op = { kind: "update", payload };
    return this;
  }
  delete() {
    this.op = { kind: "delete" };
    return this;
  }

  private matching(rows: Row[]): Row[] {
    let out = rows.filter((r) => this.filters.every((f) => f(r)));
    for (const o of [...this.orderBy].reverse()) {
      out = [...out].sort((a, b) => {
        const x = a[o.col] as never;
        const y = b[o.col] as never;
        if (x === y) return 0;
        const cmp = x > y ? 1 : -1;
        return o.ascending ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out;
  }

  private finish(data: unknown, count: number | null = null) {
    if (this.mode === "single") {
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      if (rows.length !== 1) {
        return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" }, count };
      }
      return { data: rows[0], error: null, count };
    }
    if (this.mode === "maybe") {
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      return { data: rows[0] ?? null, error: null, count };
    }
    return { data, error: null, count };
  }

  private execute() {
    const forced = this.failures[this.table];
    if (forced) {
      delete this.failures[this.table];
      return { data: null, error: forced, count: null };
    }
    const rows = this.ensure(this.table);
    switch (this.op.kind) {
      case "select": {
        const m = this.matching(rows);
        if (this.op.options?.head) return { data: null, error: null, count: m.length };
        return this.finish(m.map((r) => ({ ...r })), this.op.options?.count ? m.length : null);
      }
      case "insert": {
        const list = (Array.isArray(this.op.payload) ? this.op.payload : [this.op.payload!]).map((p) => ({
          id: `id-${idSeq++}`,
          created_at: new Date().toISOString(),
          ...p,
        }));
        rows.push(...list);
        this.log.push({ table: this.table, op: "insert", payload: this.op.payload });
        return this.finish(this.returning || this.mode ? list : null);
      }
      case "upsert": {
        const keys = (this.op.options?.onConflict ?? "id").split(",").map((s) => s.trim());
        const list = Array.isArray(this.op.payload) ? this.op.payload : [this.op.payload!];
        const out: Row[] = [];
        for (const p of list) {
          const idx = rows.findIndex((r) => keys.every((k) => r[k] === p[k]));
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...p };
            out.push(rows[idx]);
          } else {
            const row = { id: `id-${idSeq++}`, created_at: new Date().toISOString(), ...p };
            rows.push(row);
            out.push(row);
          }
        }
        this.log.push({ table: this.table, op: "upsert", payload: this.op.payload });
        return this.finish(this.returning || this.mode ? out : null);
      }
      case "update": {
        const m = this.matching(rows);
        for (const r of m) Object.assign(r, this.op.payload);
        this.log.push({ table: this.table, op: "update", payload: this.op.payload });
        return this.finish(this.returning || this.mode ? m.map((r) => ({ ...r })) : null);
      }
      case "delete": {
        const m = this.matching(rows);
        for (const r of m) rows.splice(rows.indexOf(r), 1);
        this.log.push({ table: this.table, op: "delete" });
        return this.finish(this.returning || this.mode ? m : null);
      }
    }
  }

  then<R1 = unknown, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown; count: number | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.execute() as { data: unknown; error: unknown; count: number | null }).then(onfulfilled, onrejected);
  }
}

/** A `vi.fn` wrapper around a fake, so `expect(from).toHaveBeenCalledWith("table")` works. */
export function spyFrom(fake: FakeSupabase) {
  const original = fake.client.from;
  const spy = vi.fn((table: string) => original(table));
  fake.client.from = spy as unknown as typeof original;
  return spy;
}

import { describe, test, expect, vi, beforeEach } from "vitest";

const createSupabaseClient = vi.fn((..._args: unknown[]) => ({ tag: "admin" }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createSupabaseClient(...args),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { createAdminClient } from "../server";

const ACTOR = "11111111-2222-4333-8444-555555555555";

function optionsOfLastCall(): Record<string, unknown> {
  const call = createSupabaseClient.mock.calls.at(-1)!;
  return call[2] as Record<string, unknown>;
}

describe("createAdminClient — who the service role is writing for", () => {
  beforeEach(() => createSupabaseClient.mockClear());

  test("without an argument, no actor header is sent (behaviour unchanged)", () => {
    createAdminClient();
    const opts = optionsOfLastCall();
    expect(opts.auth).toEqual({ autoRefreshToken: false, persistSession: false });
    expect(opts.global).toBeUndefined();
  });

  test("with a uuid actorId, every request carries x-ordra-actor", () => {
    createAdminClient({ actorId: ACTOR });
    const opts = optionsOfLastCall();
    expect(opts.auth).toEqual({ autoRefreshToken: false, persistSession: false });
    expect(opts.global).toEqual({ headers: { "x-ordra-actor": ACTOR } });
  });

  test("an actorId that is not a uuid is ignored, never forwarded", () => {
    createAdminClient({ actorId: "mgr-1; drop table" });
    expect(optionsOfLastCall().global).toBeUndefined();
  });

  test("a null actorId behaves like no argument", () => {
    createAdminClient({ actorId: null });
    expect(optionsOfLastCall().global).toBeUndefined();
  });
});

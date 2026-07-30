import type { Role } from "@/types";

/**
 * Test double for `getActor()`.
 *
 * Route tests used to fake the acting user by setting `x-oms-role` /
 * `x-oms-actor-id` headers on the request. That worked because getActor()
 * trusted those headers — the same reason any authenticated caller could
 * impersonate super_admin in production. Now that identity comes only from the
 * signed cookie or the session, route tests mock the resolver instead.
 *
 * Usage:
 *
 *   vi.mock("@/lib/auth/actor", async () => {
 *     const { makeGetActor } = await import("@/test/helpers/actorMock");
 *     return { getActor: makeGetActor() };
 *   });
 *
 *   beforeEach(() => resetTestActor());
 *   test("403s for agents", () => { setTestActor({ role: "agent" }); ... });
 */

export interface TestActor {
  id: string;
  role: Role;
  market_id: string | null;
}

const DEFAULT_ACTOR: TestActor = {
  id: "mgr-1",
  role: "market_manager",
  market_id: "m-1",
};

let current: TestActor | null = { ...DEFAULT_ACTOR };

/** Set the actor getActor() resolves to. Pass null to simulate no session (401). */
export function setTestActor(actor: Partial<TestActor> | null): void {
  current = actor === null ? null : { ...DEFAULT_ACTOR, ...actor };
}

/** Restore the default market_manager actor. Call from beforeEach. */
export function resetTestActor(): void {
  current = { ...DEFAULT_ACTOR };
}

/** Builds the mocked getActor implementation. */
export function makeGetActor() {
  return async () =>
    current
      ? { actor: current }
      : {
          response: new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
        };
}

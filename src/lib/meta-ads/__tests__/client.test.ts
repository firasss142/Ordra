import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchCampaignInsights, fetchAccountMeta, MetaApiError } from "../client";

/**
 * The client is the part of this integration that fails in ways nothing else
 * can catch: a mis-classified error turns a revoked token into an infinite
 * retry loop, a lost paging cursor silently under-reports spend, and a leaked
 * token is written into `ad_sync_runs.error`, a table every market_manager in
 * the market can read.
 *
 * `fetch` is stubbed rather than a network fixture recorded, because what is
 * under test is the classification and the loop, not Meta's wire format —
 * insights.test.ts owns the wire format.
 */

const CFG = {
  adAccountId: "act_123456789",
  accessToken: "EAAsecrettokenvalue",
  graphVersion: "v26.0",
};

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
    headers: new Headers(init.headers ?? {}),
  } as unknown as Response;
}

function stubFetch(...responses: Response[]) {
  const fn = vi.fn();
  responses.forEach((r) => fn.mockResolvedValueOnce(r));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const row = (id: string) => ({
  campaign_id: id,
  campaign_name: `Campaign ${id}`,
  spend: "10.00",
  account_currency: "USD",
  date_start: "2026-06-01",
  date_stop: "2026-06-01",
});

describe("credential handling", () => {
  it("sends the token as a header, never in the URL", async () => {
    const fn = stubFetch(jsonResponse({ data: [row("1")] }));
    await fetchCampaignInsights(CFG, { since: "2026-06-01", until: "2026-06-07" });

    const [url, init] = fn.mock.calls[0];
    // A credential in a query string is recorded by Meta's edge, by any egress
    // proxy, and by anything that logs outbound URLs.
    expect(String(url)).not.toContain(CFG.accessToken);
    expect(String(url)).not.toContain("access_token");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${CFG.accessToken}`,
    });
  });

  it("strips the token Meta echoes back on the paging cursor", async () => {
    const next = `https://graph.facebook.com/v26.0/act_1/insights?after=CUR&access_token=${CFG.accessToken}`;
    const fn = stubFetch(
      jsonResponse({ data: [row("1")], paging: { next } }),
      jsonResponse({ data: [row("2")] }),
    );
    await fetchCampaignInsights(CFG, { since: "2026-06-01", until: "2026-06-07" });

    expect(String(fn.mock.calls[1][0])).not.toContain(CFG.accessToken);
    expect(String(fn.mock.calls[1][0])).toContain("after=CUR");
  });

  it("keeps the token out of an error message that echoes the request URL", async () => {
    stubFetch(
      jsonResponse(
        { error: { message: `Invalid call: ...access_token=${CFG.accessToken}&x=1`, code: 100 } },
        { status: 400 },
      ),
    );
    // One call, one assertion pass over the captured error. Calling twice
    // against a single-shot mock would make the second assertion pass on a
    // TypeError from the exhausted stub rather than on the redaction.
    const err = await fetchCampaignInsights(CFG, {
      since: "2026-06-01",
      until: "2026-06-07",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.message).toContain("REDACTED");
    expect(err.message).not.toContain(CFG.accessToken);
  });
});

describe("pagination", () => {
  it("concatenates every page", async () => {
    const next = "https://graph.facebook.com/v26.0/act_1/insights?after=CUR";
    stubFetch(
      jsonResponse({ data: [row("1")], paging: { next } }),
      jsonResponse({ data: [row("2"), row("3")] }),
    );
    const { rows } = await fetchCampaignInsights(CFG, { since: "2026-06-01", until: "2026-06-07" });
    expect(rows.map((r) => r.campaign_id)).toEqual(["1", "2", "3"]);
  });

  it("takes the throttle reading from the LAST response, not the first", async () => {
    const next = "https://graph.facebook.com/v26.0/act_1/insights?after=CUR";
    stubFetch(
      jsonResponse(
        { data: [row("1")], paging: { next } },
        { headers: { "x-fb-ads-insights-throttle": JSON.stringify({ acc_id_util_pct: 11 }) } },
      ),
      jsonResponse(
        { data: [row("2")] },
        { headers: { "x-fb-ads-insights-throttle": JSON.stringify({ acc_id_util_pct: 47 }) } },
      ),
    );
    const { accUtilPct } = await fetchCampaignInsights(CFG, {
      since: "2026-06-01",
      until: "2026-06-07",
    });
    // The most recent reading is the one that reflects the load we just added.
    expect(accUtilPct).toBe(47);
  });
});

describe("throttle header parsing never throws", () => {
  const cases: Array<[string, Record<string, string>]> = [
    ["a missing header", {}],
    ["a non-JSON header", { "x-fb-ads-insights-throttle": "not json at all" }],
    ["JSON without the field", { "x-fb-ads-insights-throttle": JSON.stringify({ app_id_util_pct: 3 }) }],
  ];

  for (const [label, headers] of cases) {
    it(`returns null for ${label}`, async () => {
      stubFetch(jsonResponse({ data: [row("1")] }, { headers }));
      const { accUtilPct } = await fetchCampaignInsights(CFG, {
        since: "2026-06-01",
        until: "2026-06-07",
      });
      expect(accUtilPct).toBeNull();
    });
  }
});

describe("error classification", () => {
  // Getting these wrong is not cosmetic: isAuthFailure decides whether the sync
  // backs off and retries or stops and tells a human, and a revoked token
  // retried forever is a silently zeroed ROAS on the finance page.
  const cases: Array<[string, number, number | null, "throttle" | "auth" | "window" | "other"]> = [
    ["business-use-case throttle", 4, null, "throttle"],
    ["global load shedding", 4, 1504022, "throttle"],
    ["legacy throttle 17", 17, null, "throttle"],
    ["legacy throttle 613", 613, null, "throttle"],
    ["80000-series throttle", 80001, null, "throttle"],
    ["too much data per call", 100, 1487534, "window"],
    ["invalid token", 190, null, "auth"],
  ];

  for (const [label, code, subcode, kind] of cases) {
    it(`classifies ${label}`, async () => {
      stubFetch(
        jsonResponse(
          { error: { message: label, code, ...(subcode ? { error_subcode: subcode } : {}) } },
          { status: 400 },
        ),
      );
      const err = await fetchCampaignInsights(CFG, {
        since: "2026-06-01",
        until: "2026-06-07",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(MetaApiError);
      expect(err.code).toBe(code);
      expect(err.isThrottle).toBe(kind === "throttle");
      expect(err.isAuthFailure).toBe(kind === "auth");
    });
  }

  it("falls back to the HTTP status when the body carries no error object", async () => {
    stubFetch({
      status: 502,
      text: async () => "<html>Bad Gateway</html>",
      headers: new Headers(),
    } as unknown as Response);

    const err = await fetchCampaignInsights(CFG, {
      since: "2026-06-01",
      until: "2026-06-07",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.message).toContain("502");
  });
});

describe("request shape", () => {
  it("pins the configured Graph version and omits attribution windows", async () => {
    const fn = stubFetch(jsonResponse({ data: [] }));
    await fetchCampaignInsights(CFG, { since: "2026-06-01", until: "2026-06-07" });

    const url = String(fn.mock.calls[0][0]);
    expect(url).toContain("/v26.0/");
    expect(url).toContain("level=campaign");
    expect(url).toContain("time_increment=1");
    // The 7d/28d view windows were removed on 2026-01-12 and removed windows
    // return NO DATA rather than erroring, so asking is worse than not asking.
    expect(url).not.toContain("action_attribution_windows");
  });

  it("requests the objective, without which the lead-source choice is unreachable", async () => {
    const fn = stubFetch(jsonResponse({ data: [] }));
    await fetchCampaignInsights(CFG, { since: "2026-06-01", until: "2026-06-07" });
    expect(decodeURIComponent(String(fn.mock.calls[0][0]))).toContain("objective");
  });
});

describe("fetchAccountMeta", () => {
  it("reads currency and timezone, which spend is meaningless without", async () => {
    stubFetch(
      jsonResponse({ name: "Kassandra LY", currency: "USD", timezone_name: "Africa/Tripoli" }),
    );
    const meta = await fetchAccountMeta(CFG);
    expect(meta).toEqual({
      name: "Kassandra LY",
      currency: "USD",
      timezoneName: "Africa/Tripoli",
    });
  });
});

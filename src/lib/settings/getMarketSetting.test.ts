import { describe, expect, test, vi } from "vitest";
import { getMarketSetting } from "./getMarketSetting";

function mockSupabase(value: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({
    data: value === undefined ? null : { value },
  });
  return {
    from: vi.fn().mockReturnValue(chain),
  };
}

describe("getMarketSetting", () => {
  test("unwraps settings stored as { value }", async () => {
    const supabase = mockSupabase({ value: 5 });
    await expect(
      getMarketSetting(supabase as never, "market-1", "max_call_attempts", "3"),
    ).resolves.toBe("5");
  });

  test("supports scalar JSON settings", async () => {
    const supabase = mockSupabase(4);
    await expect(
      getMarketSetting(supabase as never, "market-1", "max_call_attempts", "3"),
    ).resolves.toBe("4");
  });

  test("returns default when the setting is missing", async () => {
    const supabase = mockSupabase(undefined);
    await expect(
      getMarketSetting(supabase as never, "market-1", "max_call_attempts", "3"),
    ).resolves.toBe("3");
  });
});

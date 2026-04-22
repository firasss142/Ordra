import { describe, test, expect } from "vitest";
import { sortAgentLeadQueue } from "./queue-sort";

interface L {
  id: string;
  status: string;
  callback_scheduled_at: string | null;
  created_at: string;
}

function lead(
  id: string,
  status: string,
  createdAt: string,
  callbackAt: string | null = null
): L {
  return {
    id,
    status,
    callback_scheduled_at: callbackAt,
    created_at: createdAt,
  };
}

describe("sortAgentLeadQueue", () => {
  test("due callbacks come first (priority 0)", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    const result = sortAgentLeadQueue([
      lead("a", "assigned", "2026-01-01T00:00:00Z"),
      lead("b", "callback_scheduled", "2026-01-02T00:00:00Z", past),
      lead("c", "attempt_1", "2026-01-03T00:00:00Z"),
      lead("d", "callback_scheduled", "2026-01-04T00:00:00Z", future),
    ]);

    expect(result[0].id).toBe("b");
  });

  test("attempts (1/2/3) come before plain assigned", () => {
    const result = sortAgentLeadQueue([
      lead("a", "assigned", "2026-01-01T00:00:00Z"),
      lead("b", "attempt_1", "2026-01-02T00:00:00Z"),
      lead("c", "attempt_3", "2026-01-03T00:00:00Z"),
    ]);

    expect(result.map((l) => l.id)).toEqual(["b", "c", "a"]);
  });

  test("qualified leads come after assigned (ready to convert but lowest urgency)", () => {
    const result = sortAgentLeadQueue([
      lead("a", "qualified", "2026-01-01T00:00:00Z"),
      lead("b", "assigned", "2026-01-02T00:00:00Z"),
    ]);

    expect(result.map((l) => l.id)).toEqual(["b", "a"]);
  });

  test("within same priority, older created_at wins", () => {
    const result = sortAgentLeadQueue([
      lead("new", "attempt_1", "2026-02-01T00:00:00Z"),
      lead("old", "attempt_1", "2026-01-01T00:00:00Z"),
    ]);

    expect(result.map((l) => l.id)).toEqual(["old", "new"]);
  });

  test("future callbacks fall to lowest priority bucket", () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const result = sortAgentLeadQueue([
      lead("future", "callback_scheduled", "2026-01-01T00:00:00Z", future),
      lead("attempt", "attempt_1", "2026-01-02T00:00:00Z"),
      lead("assigned", "assigned", "2026-01-03T00:00:00Z"),
      lead("qualified", "qualified", "2026-01-04T00:00:00Z"),
    ]);

    expect(result[result.length - 1].id).toBe("future");
  });

  test("does not mutate input array", () => {
    const input = [
      lead("a", "assigned", "2026-01-01T00:00:00Z"),
      lead("b", "attempt_1", "2026-01-02T00:00:00Z"),
    ];
    const before = input.map((l) => l.id);
    sortAgentLeadQueue(input);
    expect(input.map((l) => l.id)).toEqual(before);
  });
});

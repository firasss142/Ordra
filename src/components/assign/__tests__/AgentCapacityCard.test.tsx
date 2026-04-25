import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params)
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          val
        );
      return val;
    };
    return resolve;
  },
}));

import { AgentCapacityCard } from "../AgentCapacityCard";
import type { AgentCapacityRow } from "@/hooks/useAgentCapacity";

const NOW = new Date("2026-04-24T12:00:00Z");

function makeAgent(overrides: Partial<AgentCapacityRow> = {}): AgentCapacityRow {
  return {
    id: "a1",
    full_name: "Agent One",
    avatar_url: null,
    is_active: true,
    last_seen_at: new Date(NOW.getTime() - 60_000).toISOString(),
    last_action_at: null,
    queue_size: 5,
    confirmation_rate: 0.72,
    actioned_count: 25,
    ...overrides,
  };
}

describe("<AgentCapacityCard />", () => {
  it("renders name, queue size, and confirmation rate", () => {
    render(
      <AgentCapacityCard agent={makeAgent()} selectedCount={0} onAssign={() => {}} now={NOW} />
    );
    expect(screen.getByText("Agent One")).toBeTruthy();
    expect(screen.getByText(/5 en file/)).toBeTruthy();
    expect(screen.getByText(/72% confirm\./)).toBeTruthy();
  });

  it("disables the assign button when selectedCount is zero", () => {
    render(
      <AgentCapacityCard agent={makeAgent()} selectedCount={0} onAssign={() => {}} now={NOW} />
    );
    const btn = screen.getByRole("button", { name: /Assigner/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls onAssign with agent id when button clicked and selection present", async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn();
    render(
      <AgentCapacityCard agent={makeAgent()} selectedCount={3} onAssign={onAssign} now={NOW} />
    );
    const btn = screen.getByRole("button", { name: /Assigner \(3\)/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    await user.click(btn);
    expect(onAssign).toHaveBeenCalledWith("a1");
  });
});

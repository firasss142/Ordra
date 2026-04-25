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

import { AutoAssignBar } from "../AutoAssignBar";

describe("<AutoAssignBar />", () => {
  it("disables Auto-assign button when no selection", () => {
    render(
      <AutoAssignBar
        selectedCount={0}
        onAutoAssign={() => {}}
        algorithm="workload"
        onAlgorithmChange={() => {}}
        isActive={true}
        onIsActiveChange={() => {}}
        onClearSelection={() => {}}
        onSelectAll={() => {}}
        totalCount={0}
      />
    );
    const btn = screen.getByRole("button", { name: "Auto-assigner" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Auto-assign when algorithm is manual even with selection", () => {
    render(
      <AutoAssignBar
        selectedCount={3}
        onAutoAssign={() => {}}
        algorithm="manual"
        onAlgorithmChange={() => {}}
        isActive={true}
        onIsActiveChange={() => {}}
        onClearSelection={() => {}}
        onSelectAll={() => {}}
        totalCount={0}
      />
    );
    const btn = screen.getByRole("button", { name: "Auto-assigner" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("fires onAlgorithmChange when dropdown changes", async () => {
    const user = userEvent.setup();
    const onAlgorithmChange = vi.fn();
    render(
      <AutoAssignBar
        selectedCount={0}
        onAutoAssign={() => {}}
        algorithm="manual"
        onAlgorithmChange={onAlgorithmChange}
        isActive={true}
        onIsActiveChange={() => {}}
        onClearSelection={() => {}}
        onSelectAll={() => {}}
        totalCount={0}
      />
    );
    await user.selectOptions(screen.getByRole("combobox"), "workload");
    expect(onAlgorithmChange).toHaveBeenCalledWith("workload");
  });

  it("fires onSelectAll when select-all checkbox is ticked from empty state", async () => {
    const user = userEvent.setup();
    const onSelectAll = vi.fn();
    render(
      <AutoAssignBar
        selectedCount={0}
        totalCount={5}
        onAutoAssign={() => {}}
        algorithm="manual"
        onAlgorithmChange={() => {}}
        isActive={false}
        onIsActiveChange={() => {}}
        onClearSelection={() => {}}
        onSelectAll={onSelectAll}
      />
    );
    await user.click(screen.getByRole("checkbox", { name: "Tout sélectionner" }));
    expect(onSelectAll).toHaveBeenCalled();
  });

  it("fires onClearSelection when select-all checkbox is unticked while all selected", async () => {
    const user = userEvent.setup();
    const onClearSelection = vi.fn();
    render(
      <AutoAssignBar
        selectedCount={5}
        totalCount={5}
        onAutoAssign={() => {}}
        algorithm="manual"
        onAlgorithmChange={() => {}}
        isActive={false}
        onIsActiveChange={() => {}}
        onClearSelection={onClearSelection}
        onSelectAll={() => {}}
      />
    );
    await user.click(screen.getByRole("checkbox", { name: "Tout sélectionner" }));
    expect(onClearSelection).toHaveBeenCalled();
  });

  it("enables Auto-assign when selection present, algorithm non-manual, and active", async () => {
    const user = userEvent.setup();
    const onAutoAssign = vi.fn();
    render(
      <AutoAssignBar
        selectedCount={4}
        onAutoAssign={onAutoAssign}
        algorithm="round_robin"
        onAlgorithmChange={() => {}}
        isActive={true}
        onIsActiveChange={() => {}}
        onClearSelection={() => {}}
        onSelectAll={() => {}}
        totalCount={0}
      />
    );
    const btn = screen.getByRole("button", { name: "Auto-assigner" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    await user.click(btn);
    expect(onAutoAssign).toHaveBeenCalled();
  });
});

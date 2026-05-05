import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { KanbanBoard } from "../KanbanBoard";

interface Task {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
}

const tasks: Task[] = [
  { id: "1", title: "First", status: "todo" },
  { id: "2", title: "Second", status: "doing" },
  { id: "3", title: "Third", status: "todo" },
];

const columns = [
  { key: "todo", label: "To do" },
  { key: "doing", label: "Doing" },
  { key: "done", label: "Done" },
];

describe("KanbanBoard", () => {
  it("groups items into columns by groupBy", () => {
    render(
      <KanbanBoard
        columns={columns}
        items={tasks}
        getItemId={(t) => t.id}
        groupBy={(t) => t.status}
        renderCard={(t) => <div data-testid={`card-${t.id}`}>{t.title}</div>}
      />
    );

    expect(screen.getByTestId("card-1")).toBeDefined();
    expect(screen.getByTestId("card-2")).toBeDefined();
    expect(screen.getByTestId("card-3")).toBeDefined();
  });

  it("shows column counts", () => {
    render(
      <KanbanBoard
        columns={columns}
        items={tasks}
        getItemId={(t) => t.id}
        groupBy={(t) => t.status}
        renderCard={(t) => <div>{t.title}</div>}
      />
    );
    // To do has 2, Doing has 1, Done has 0
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("0")).toBeDefined();
  });

  it("renders empty label for empty columns", () => {
    render(
      <KanbanBoard
        columns={columns}
        items={tasks}
        getItemId={(t) => t.id}
        groupBy={(t) => t.status}
        renderCard={(t) => <div>{t.title}</div>}
        emptyLabel="No items"
      />
    );
    expect(screen.getByText("No items")).toBeDefined();
  });

  it("renders a top accent line when column.accent is set", () => {
    const accented = [
      { key: "todo", label: "To do", accent: "neutral" as const },
      { key: "doing", label: "Doing", accent: "warning" as const },
      { key: "done", label: "Done", accent: "success" as const },
    ];
    const { container } = render(
      <KanbanBoard
        columns={accented}
        items={tasks}
        getItemId={(t) => t.id}
        groupBy={(t) => t.status}
        renderCard={(t) => <div>{t.title}</div>}
      />
    );
    // Each accented column renders a 2px top bar with the accent color token
    const bars = container.querySelectorAll('[data-kanban-accent="warning"]');
    expect(bars.length).toBe(1);
    const success = container.querySelectorAll('[data-kanban-accent="success"]');
    expect(success.length).toBe(1);
  });

  it("applies cardAccent on the inline-start edge of each card", () => {
    const { container } = render(
      <KanbanBoard<Task>
        columns={columns}
        items={tasks}
        getItemId={(t) => t.id}
        groupBy={(t) => t.status}
        renderCard={(t) => <div data-testid={`card-${t.id}`}>{t.title}</div>}
        cardAccent={(t) => (t.id === "1" ? "warning" : "neutral")}
      />
    );
    const warningMark = container.querySelector('[data-card-accent="warning"]');
    expect(warningMark).not.toBeNull();
    const neutralMarks = container.querySelectorAll('[data-card-accent="neutral"]');
    expect(neutralMarks.length).toBeGreaterThanOrEqual(2);
  });

  it("reduces card spacing in compact density", () => {
    const { container } = render(
      <KanbanBoard<Task>
        columns={columns}
        items={tasks}
        getItemId={(t) => t.id}
        groupBy={(t) => t.status}
        renderCard={(t) => <div>{t.title}</div>}
        density="compact"
      />
    );
    const board = container.querySelector('[data-kanban-density]');
    expect(board).not.toBeNull();
    expect(board?.getAttribute("data-kanban-density")).toBe("compact");
  });

  it("defaults density to comfortable when not provided", () => {
    const { container } = render(
      <KanbanBoard<Task>
        columns={columns}
        items={tasks}
        getItemId={(t) => t.id}
        groupBy={(t) => t.status}
        renderCard={(t) => <div>{t.title}</div>}
      />
    );
    const board = container.querySelector('[data-kanban-density]');
    expect(board?.getAttribute("data-kanban-density")).toBe("comfortable");
  });

  it("renders a + button in the column header when onAdd is provided", () => {
    const onAdd = vi.fn();
    render(
      <KanbanBoard<Task>
        columns={[{ key: "todo", label: "To do", onAdd, addLabel: "Add item" }]}
        items={[]}
        getItemId={(t) => t.id}
        groupBy={(t) => t.status}
        renderCard={(t) => <div>{t.title}</div>}
      />
    );
    const btn = screen.getByRole("button", { name: "Add item" });
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("does not render a + button when onAdd is absent", () => {
    render(
      <KanbanBoard<Task>
        columns={[{ key: "todo", label: "To do" }]}
        items={[]}
        getItemId={(t) => t.id}
        groupBy={(t) => t.status}
        renderCard={(t) => <div>{t.title}</div>}
      />
    );
    expect(screen.queryByRole("button", { name: /add/i })).toBeNull();
  });

  it("invokes onMove when a card is dropped onto another column", async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(
      <KanbanBoard
        columns={columns}
        items={tasks}
        getItemId={(t) => t.id}
        groupBy={(t) => t.status}
        renderCard={(t) => <div data-testid={`card-${t.id}`}>{t.title}</div>}
        onMove={onMove}
      />
    );

    const card = screen.getByTestId("card-1").parentElement!; // draggable wrapper

    // Minimal dataTransfer mock — store keyed values per call
    const store: Record<string, string> = {};
    const dataTransfer = {
      data: store,
      setData: (k: string, v: string) => {
        store[k] = v;
      },
      getData: (k: string) => store[k] ?? "",
      effectAllowed: "move",
      dropEffect: "move",
    };

    fireEvent.dragStart(card, { dataTransfer });

    // Drop target is the "doing" column header / body — easiest: find a column by label
    const doingHeader = screen.getByText("Doing");
    const doingColumn = doingHeader.closest("div")!.parentElement!;
    fireEvent.dragOver(doingColumn, { dataTransfer });
    fireEvent.drop(doingColumn, { dataTransfer });

    await waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));
    expect(onMove.mock.calls[0][0]).toEqual(tasks[0]);
    expect(onMove.mock.calls[0][1]).toBe("todo");
    expect(onMove.mock.calls[0][2]).toBe("doing");
  });
});

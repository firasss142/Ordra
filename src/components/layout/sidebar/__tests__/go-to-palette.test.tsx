import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GoToPalette, type PaletteEntry } from "../GoToPalette";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

afterEach(() => cleanup());

const entries = (): PaletteEntry[] => [
  { id: "pulse", label: "Dashboard", icon: null, onSelect: vi.fn() },
  { id: "pnl", label: "P&L global", group: "Finances", icon: null, onSelect: vi.fn() },
  { id: "reglages", label: "Réglages", group: "Système", icon: null, onSelect: vi.fn() },
  { id: "mk:ly", label: "Passer à Libye", group: "Marchés", icon: null, onSelect: vi.fn() },
];

function open(list = entries(), onClose = vi.fn()) {
  render(<GoToPalette open entries={list} onClose={onClose} />);
  return { list, onClose, input: screen.getByRole("combobox") };
}

describe("GoToPalette", () => {
  it("is not in the page until opened", () => {
    render(<GoToPalette open={false} entries={entries()} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens with the cursor in the field and every destination listed", () => {
    const { input } = open();
    expect(input).toHaveFocus();
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("finds a page without its accents", () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: "regl" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["RéglagesSystème"]);
  });

  it("finds a page by its group", () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: "finan" } });
    expect(screen.getByRole("option", { name: /P&L global/ })).toBeInTheDocument();
  });

  it("goes with the arrows and Enter, then closes", () => {
    const { input, list, onClose } = open();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /P&L global/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(list[1].onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("goes on a click", () => {
    const { list } = open();
    fireEvent.click(screen.getByRole("option", { name: /Passer à Libye/ }));
    expect(list[3].onSelect).toHaveBeenCalled();
  });

  it("says when nothing matches", () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("Aucune page ne correspond")).toBeInTheDocument();
  });

  it("closes on Escape and on the backdrop", () => {
    const { input, onClose } = open();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByTestId("goto-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

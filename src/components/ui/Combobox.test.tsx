import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { Combobox } from "./Combobox";

const OPTIONS = [
  { id: "tunis", label: "Tunis" },
  { id: "sfax", label: "Sfax" },
  { id: "sousse", label: "Sousse" },
];

beforeEach(() => vi.clearAllMocks());

describe("Combobox", () => {
  it("shows current value label as trigger text", () => {
    render(<Combobox value="Tunis" options={OPTIONS} onCommit={vi.fn()} />);
    expect(screen.getByText("Tunis")).toBeDefined();
  });

  it("opens dropdown on trigger click showing all options", () => {
    render(<Combobox value="Tunis" options={OPTIONS} onCommit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Sfax")).toBeDefined();
    expect(screen.getByText("Sousse")).toBeDefined();
  });

  it("filters options by typed query", () => {
    render(<Combobox value="Tunis" options={OPTIONS} onCommit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "sou" } });
    expect(screen.getByText("Sousse")).toBeDefined();
    expect(screen.queryByText("Sfax")).toBeNull();
  });

  it("calls onCommit with selected id and label on option click", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<Combobox value="Tunis" options={OPTIONS} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Sfax"));
    await waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith("sfax", "Sfax")
    );
  });

  it("closes dropdown after selection", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<Combobox value="Tunis" options={OPTIONS} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Sfax"));
    await waitFor(() =>
      expect(screen.queryByRole("combobox")).toBeNull()
    );
  });

  it("Escape closes dropdown without calling onCommit", () => {
    const onCommit = vi.fn();
    render(<Combobox value="Tunis" options={OPTIONS} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("arrow down + Enter selects highlighted option", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<Combobox value="Tunis" options={OPTIONS} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
  });

  it("renders as plain text when readOnly", () => {
    render(
      <Combobox value="Tunis" options={OPTIONS} onCommit={vi.fn()} readOnly />
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Tunis")).toBeDefined();
  });

  it("does not commit if same option is reselected", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<Combobox value="Tunis" options={OPTIONS} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button"));
    // The dropdown list contains the "Tunis" option — click it by its list item role
    const listItems = screen.getAllByText("Tunis");
    fireEvent.click(listItems[listItems.length - 1]); // click the dropdown item
    await waitFor(() => expect(onCommit).not.toHaveBeenCalled());
  });
});

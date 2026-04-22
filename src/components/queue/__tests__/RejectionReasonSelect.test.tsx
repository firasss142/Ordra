import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { RejectionReasonSelect } from "../RejectionReasonSelect";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RejectionReasonSelect", () => {
  it("renders all 7 rejection reasons", () => {
    render(<RejectionReasonSelect onSelect={vi.fn()} />);
    expect(screen.getByText("Refus client")).toBeDefined();
    expect(screen.getByText("Faux numéro")).toBeDefined();
    expect(screen.getByText("Doublon")).toBeDefined();
    expect(screen.getByText("Injoignable")).toBeDefined();
    expect(screen.getByText("Prix")).toBeDefined();
    expect(screen.getByText("Non sérieux")).toBeDefined();
    expect(screen.getByText("Autre")).toBeDefined();
  });

  it("calls onSelect when a reason is clicked", () => {
    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Doublon"));
    expect(onSelect).toHaveBeenCalledWith("doublon", undefined);
  });

  it("highlights selected reason with 2px border", () => {
    render(<RejectionReasonSelect onSelect={vi.fn()} />);
    const row = screen.getByText("Refus client").closest("div");
    fireEvent.click(row!);
    expect(row?.style.borderWidth).toBe("2px");
  });

  it("does not show note input initially", () => {
    render(<RejectionReasonSelect onSelect={vi.fn()} />);
    expect(screen.queryByPlaceholderText("Précisez…")).toBeNull();
  });

  it("shows text input when autre is selected", () => {
    render(<RejectionReasonSelect onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("Autre"));
    expect(screen.getByPlaceholderText("Précisez…")).toBeDefined();
  });

  it("calls onSelect with note when autre reason and note are set", () => {
    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Autre"));
    fireEvent.change(screen.getByPlaceholderText("Précisez…"), {
      target: { value: "Raison spéciale" },
    });
    expect(onSelect).toHaveBeenCalledWith("autre", "Raison spéciale");
  });

  it("calls onSelect without note when non-autre reason selected", () => {
    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Prix"));
    expect(onSelect).toHaveBeenCalledWith("prix", undefined);
  });
});

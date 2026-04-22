import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { StepperField } from "./StepperField";

beforeEach(() => vi.clearAllMocks());

describe("StepperField", () => {
  it("renders the current value", () => {
    render(<StepperField value={3} onCommit={vi.fn()} />);
    expect(screen.getByDisplayValue("3")).toBeDefined();
  });

  it("+ button increments value and calls onCommit", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<StepperField value={2} onCommit={onCommit} />);
    fireEvent.click(screen.getByLabelText("increment"));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(3));
  });

  it("− button decrements value and calls onCommit", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<StepperField value={3} onCommit={onCommit} />);
    fireEvent.click(screen.getByLabelText("decrement"));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(2));
  });

  it("does not decrement below min", async () => {
    const onCommit = vi.fn();
    render(<StepperField value={1} onCommit={onCommit} min={1} />);
    fireEvent.click(screen.getByLabelText("decrement"));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not increment above max", async () => {
    const onCommit = vi.fn();
    render(<StepperField value={5} onCommit={onCommit} max={5} />);
    fireEvent.click(screen.getByLabelText("increment"));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("direct text input + blur commits integer value", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<StepperField value={1} onCommit={onCommit} />);
    const input = screen.getByDisplayValue("1");
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(4));
  });

  it("renders as plain text when readOnly", () => {
    render(<StepperField value={3} onCommit={vi.fn()} readOnly />);
    expect(screen.queryByLabelText("increment")).toBeNull();
    expect(screen.getByText("3")).toBeDefined();
  });
});

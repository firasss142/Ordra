import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { InlineField } from "./InlineField";

beforeEach(() => vi.clearAllMocks());

describe("InlineField", () => {
  it("renders as an input with the current value", () => {
    render(<InlineField value="Alice" onCommit={vi.fn()} />);
    const input = screen.getByRole("textbox");
    expect((input as HTMLInputElement).value).toBe("Alice");
  });

  it("blur commits onCommit with new value when changed", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<InlineField value="Alice" onCommit={onCommit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Bob" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("Bob"));
  });

  it("blur does NOT call onCommit when value is unchanged", () => {
    const onCommit = vi.fn();
    render(<InlineField value="Alice" onCommit={onCommit} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Enter key commits onCommit with new value", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<InlineField value="Alice" onCommit={onCommit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Carol" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("Carol"));
  });

  it("Escape reverts to original value without calling onCommit", () => {
    const onCommit = vi.fn();
    render(<InlineField value="Alice" onCommit={onCommit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("Alice");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("validate blocks commit and shows error styling", async () => {
    const onCommit = vi.fn();
    const validate = (v: string) => (v.length < 3 ? "Too short" : null);
    render(<InlineField value="Al" onCommit={onCommit} validate={validate} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.className).toContain("border-red");
  });

  it("renders as plain text when readOnly", () => {
    render(<InlineField value="Alice" onCommit={vi.fn()} readOnly />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Alice")).toBeDefined();
  });

  it("passes type prop to input element", () => {
    render(<InlineField value="123" onCommit={vi.fn()} type="tel" />);
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("type")).toBe("tel");
  });

  describe("multiline (textarea)", () => {
    it("renders a textarea when multiline and not in display mode", () => {
      render(<InlineField value="Note" onCommit={vi.fn()} multiline />);
      const field = screen.getByRole("textbox");
      expect(field.tagName).toBe("TEXTAREA");
      expect((field as HTMLTextAreaElement).value).toBe("Note");
    });

    it("commits on blur with the edited multiline value", async () => {
      const onCommit = vi.fn().mockResolvedValue(undefined);
      render(<InlineField value="Note" onCommit={onCommit} multiline />);
      const field = screen.getByRole("textbox");
      fireEvent.change(field, { target: { value: "Line 1\nLine 2" } });
      fireEvent.blur(field);
      await waitFor(() => expect(onCommit).toHaveBeenCalledWith("Line 1\nLine 2"));
    });

    it("Enter does NOT commit in multiline mode (newline is allowed)", () => {
      const onCommit = vi.fn();
      render(<InlineField value="Note" onCommit={onCommit} multiline />);
      const field = screen.getByRole("textbox");
      fireEvent.change(field, { target: { value: "Changed" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("Escape reverts the multiline value without committing", () => {
      const onCommit = vi.fn();
      render(<InlineField value="Note" onCommit={onCommit} multiline />);
      const field = screen.getByRole("textbox") as HTMLTextAreaElement;
      fireEvent.change(field, { target: { value: "Changed" } });
      fireEvent.keyDown(field, { key: "Escape" });
      expect(field.value).toBe("Note");
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("display-mode multiline: clicking the text activates a textarea", () => {
      render(
        <InlineField value="Existing note" onCommit={vi.fn()} multiline displayMode />,
      );
      // No textbox until activated
      expect(screen.queryByRole("textbox")).toBeNull();
      fireEvent.click(screen.getByText("Existing note"));
      const field = screen.getByRole("textbox");
      expect(field.tagName).toBe("TEXTAREA");
    });
  });
});

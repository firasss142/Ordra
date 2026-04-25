import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children as a button", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeDefined();
  });

  it("fires onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies primary variant by default", () => {
    render(<Button>Primary</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/bg-ink-primary/);
    expect(btn.className).toMatch(/text-white/);
  });

  it("applies secondary variant classes", () => {
    render(<Button variant="secondary">Secondary</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/bg-surface-card/);
    expect(btn.className).toMatch(/border/);
  });

  it("applies ghost variant classes", () => {
    render(<Button variant="ghost">Ghost</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/bg-transparent/);
  });

  it("applies destructive variant classes", () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/bg-status-critical/);
  });

  it("respects size prop", () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    expect(screen.getByRole("button").className).toMatch(/h-8/);
    rerender(<Button size="md">Medium</Button>);
    expect(screen.getByRole("button").className).toMatch(/h-10/);
  });

  it("disables when disabled prop set", () => {
    render(<Button disabled>Off</Button>);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("passes through type attribute", () => {
    render(<Button type="submit">Submit</Button>);
    expect((screen.getByRole("button") as HTMLButtonElement).type).toBe("submit");
  });

  it("forwards arbitrary className", () => {
    render(<Button className="extra-class">X</Button>);
    expect(screen.getByRole("button").className).toMatch(/extra-class/);
  });
});

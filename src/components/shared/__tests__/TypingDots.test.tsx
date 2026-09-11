import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TypingDots } from "../TypingDots";

describe("TypingDots", () => {
  it("renders three dots", () => {
    const { container } = render(<TypingDots />);
    expect(container.querySelectorAll("[data-typing-dot]")).toHaveLength(3);
  });

  // The aria-label on the parent head already says "modifie cette commande";
  // announcing it twice is worse than not announcing it here at all.
  it("is hidden from assistive tech", () => {
    render(<TypingDots />);
    expect(screen.getByTestId("typing-dots").getAttribute("aria-hidden")).toBe("true");
  });

  it("staggers the dots so they ripple rather than blink together", () => {
    const { container } = render(<TypingDots />);
    const delays = Array.from(container.querySelectorAll<HTMLElement>("[data-typing-dot]"))
      .map((d) => d.style.animationDelay);
    expect(new Set(delays).size).toBe(3);
  });
});

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NavBadge } from "../NavBadge";
import { MarketFlag } from "../MarketFlag";

describe("NavBadge", () => {
  it("shows the count in its tone", () => {
    const { getByText } = render(<NavBadge count={12} tone="warning" />);
    expect(getByText("12")).toHaveStyle({
      backgroundColor: "var(--badge-warning-bg)",
      color: "var(--badge-warning-fg)",
    });
  });

  it("caps at 999+ — the same rule for every count, the bell included", () => {
    const { container } = render(<NavBadge count={2310} tone="critical" />);
    expect(container.textContent).toBe("999+");
  });

  it("keeps « 999+ » in that order inside an Arabic page", () => {
    // Inheriting rtl, the bell printed « +99 ».
    const { container } = render(
      <div dir="rtl">
        <NavBadge count={1500} tone="critical" />
      </div>,
    );
    expect(container.querySelector("span")).toHaveStyle({ direction: "ltr", unicodeBidi: "isolate" });
  });

  it("says what it counts to a screen reader", () => {
    const { container } = render(<NavBadge count={3} tone="success" label="conversations non lues" />);
    expect(container.textContent).toBe("3 conversations non lues");
  });

  it("renders nothing for zero", () => {
    const { container } = render(<NavBadge count={0} tone="warning" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MarketFlag", () => {
  it("draws the flag instead of an emoji, which Windows prints as « TN »", () => {
    const { container } = render(<MarketFlag scope="tn" size={20} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("draws both flags, cut on the diagonal, for every market", () => {
    const { container } = render(<MarketFlag scope="all" size={20} />);
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });

  it("is decoration — the market's name always sits beside it", () => {
    const { container } = render(<MarketFlag scope="ly" size={20} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

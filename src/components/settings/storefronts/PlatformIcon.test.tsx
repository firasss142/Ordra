/**
 * @vitest-environment jsdom
 */
import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlatformIcon } from "./PlatformIcon";

describe("PlatformIcon", () => {
  test.each([
    ["shopify", "Shopify"],
    ["woocommerce", "WooCommerce"],
    ["lightfunnels", "Lightfunnels"],
  ])("renders %s as an image with alt %s", (platform, label) => {
    render(<PlatformIcon platform={platform} />);
    const img = screen.getByRole("img", { name: label });
    expect(img).toBeDefined();
  });

  test("renders easy_orders as letter E with aria-label", () => {
    render(<PlatformIcon platform="easy_orders" />);
    const svg = screen.getByRole("img", { name: "Easy Orders" });
    expect(svg).toBeDefined();
    expect(svg.textContent).toBe("E");
  });

  test("renders ? for unknown platform", () => {
    render(<PlatformIcon platform="custom_x" />);
    const svg = screen.getByRole("img", { name: "custom_x" });
    expect(svg.textContent).toBe("?");
  });
});

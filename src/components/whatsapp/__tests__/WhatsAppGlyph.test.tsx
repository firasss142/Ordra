import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WhatsAppGlyph } from "../WhatsAppGlyph";

/**
 * Prototype: whatsapp-agent-v1.html `I.wa` — the WhatsApp shape every
 * WhatsApp affordance carries (hero button, row square, bell tile, sheets),
 * so the agent tells a WhatsApp action from a phone call at a glance.
 */
describe("WhatsAppGlyph", () => {
  it("draws the WhatsApp shape, decorative by default, at the requested size", () => {
    const { container } = render(<WhatsAppGlyph size={17} className="text-brand" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "17");
    expect(svg).toHaveAttribute("data-icon", "whatsapp");
    expect(svg.getAttribute("class")).toContain("text-brand");
    expect(svg.querySelectorAll("path")).toHaveLength(2);
  });
});

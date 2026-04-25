import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsPageHeader } from "../SettingsPageHeader";

const MARKETS = [
  { id: "m-tn", name: "Tunisie", code: "tn" },
  { id: "m-ly", name: "Libye", code: "ly" },
];

describe("SettingsPageHeader", () => {
  it("renders the title", () => {
    render(
      <SettingsPageHeader
        title="Transporteurs"
        markets={MARKETS}
        selectedMarketId="m-tn"
        onChange={() => {}}
        showMarketSelector={true}
        isRtl={false}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Transporteurs" }),
    ).toBeInTheDocument();
  });

  it("renders market selector when showMarketSelector is true", () => {
    render(
      <SettingsPageHeader
        title="Transporteurs"
        markets={MARKETS}
        selectedMarketId="m-tn"
        onChange={() => {}}
        showMarketSelector={true}
        isRtl={false}
      />,
    );
    expect(screen.getByLabelText("Marché")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tunisie" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Libye" })).toBeInTheDocument();
  });

  it("hides market selector when showMarketSelector is false", () => {
    render(
      <SettingsPageHeader
        title="Marchés"
        markets={MARKETS}
        selectedMarketId=""
        onChange={() => {}}
        showMarketSelector={false}
        isRtl={false}
      />,
    );
    expect(screen.queryByLabelText("Marché")).not.toBeInTheDocument();
  });

  it("calls onChange with new market id when user changes selection", () => {
    const onChange = vi.fn();
    render(
      <SettingsPageHeader
        title="Storefronts"
        markets={MARKETS}
        selectedMarketId="m-tn"
        onChange={onChange}
        showMarketSelector={true}
        isRtl={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Marché"), {
      target: { value: "m-ly" },
    });
    expect(onChange).toHaveBeenCalledWith("m-ly");
  });

  it("applies RTL direction when isRtl is true", () => {
    const { container } = render(
      <SettingsPageHeader
        title="Paramètres"
        markets={MARKETS}
        selectedMarketId="m-tn"
        onChange={() => {}}
        showMarketSelector={true}
        isRtl={true}
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.direction).toBe("rtl");
  });
});

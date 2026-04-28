import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsPageHeader } from "../SettingsPageHeader";

describe("SettingsPageHeader", () => {
  it("renders the title", () => {
    render(<SettingsPageHeader title="Transporteurs" isRtl={false} />);
    expect(
      screen.getByRole("heading", { name: "Transporteurs" }),
    ).toBeInTheDocument();
  });

  it("renders an optional description", () => {
    render(
      <SettingsPageHeader
        title="Paramètres"
        description="Configurez les paramètres."
        isRtl={false}
      />,
    );
    expect(screen.getByText("Configurez les paramètres.")).toBeInTheDocument();
  });

  it("applies RTL direction when isRtl is true", () => {
    const { container } = render(
      <SettingsPageHeader title="Paramètres" isRtl={true} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.direction).toBe("rtl");
  });
});

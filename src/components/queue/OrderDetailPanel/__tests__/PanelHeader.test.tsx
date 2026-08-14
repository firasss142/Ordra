import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelHeader } from "../PanelHeader";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

const CREATED = "2026-08-14T09:00:00.000Z";

function renderHeader(overrides: Partial<React.ComponentProps<typeof PanelHeader>> = {}) {
  return render(
    <PanelHeader
      reference="A-21837"
      createdAt={CREATED}
      status="pending"
      statusLabel="En attente"
      locale="fr"
      slaMinutes={120}
      confirmedAt={null}
      now={new Date("2026-08-14T10:13:00.000Z")}
      saveFlash={null}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe("PanelHeader — SLA chip", () => {
  it("reads the elapsed time against the market's target", () => {
    renderHeader();

    const chip = screen.getByTestId("panel-sla");
    // Same formatter as the queue row, so one order never reads as two
    // different ages in two places.
    expect(chip).toHaveTextContent("1h 13mn");
    expect(chip).toHaveTextContent("SLA 2h");
  });

  it("marks a breach once the target is passed", () => {
    renderHeader({ now: new Date("2026-08-14T12:00:00.000Z") });

    expect(screen.getByTestId("panel-sla")).toHaveAttribute("data-state", "breached");
  });

  it("freezes at the time confirmation actually took", () => {
    renderHeader({
      status: "confirmed",
      confirmedAt: "2026-08-14T10:47:00.000Z",
      now: new Date("2026-08-14T20:00:00.000Z"),
    });

    const chip = screen.getByTestId("panel-sla");
    expect(chip).toHaveAttribute("data-state", "met");
    expect(chip).toHaveTextContent("1h 47mn");
  });

  it("drops the chip once the order is with the carrier, but still states its age", () => {
    renderHeader({ status: "uploaded", confirmedAt: "2026-08-14T10:00:00.000Z" });

    expect(screen.queryByTestId("panel-sla")).not.toBeInTheDocument();
    expect(screen.getByTestId("panel-age")).toBeInTheDocument();
  });

  it("falls back to the plain age until the market's target has loaded", () => {
    renderHeader({ slaMinutes: null });

    expect(screen.queryByTestId("panel-sla")).not.toBeInTheDocument();
    expect(screen.getByTestId("panel-age")).toHaveTextContent("1h 13mn");
  });
});

describe("PanelHeader — the chrome it already carried", () => {
  it("still shows the status and the tail of the reference", () => {
    renderHeader();

    expect(screen.getByText("En attente")).toBeInTheDocument();
    expect(screen.getByText("#…21837")).toBeInTheDocument();
  });

  it("still exposes a close control", () => {
    const onClose = vi.fn();
    renderHeader({ onClose });

    expect(screen.getByRole("button", { name: "Fermer" })).toBeInTheDocument();
  });

  it("does not state the age twice when the SLA chip is already carrying it", () => {
    renderHeader();

    expect(screen.queryByTestId("panel-age")).not.toBeInTheDocument();
  });
});

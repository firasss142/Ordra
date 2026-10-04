import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OrderTimeline } from "./OrderTimeline";
import type { TimelineStage } from "@/app/api/orders/[id]/timeline/route";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

const stages = (...s: Array<[TimelineStage["status"], number | null]>): TimelineStage[] =>
  s.map(([status, duration_hours]) => ({
    status,
    at: "2026-08-01T10:00:00Z",
    duration_hours,
  }));

describe("OrderTimeline", () => {
  it("walks the delivery pipeline in order", () => {
    render(
      <OrderTimeline stages={stages(["dispatched", 2])} currentStatus="dispatched" />,
    );
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent("Expédié");
    expect(steps[3]).toHaveTextContent("Livré");
  });

  it("marks exactly one node as the current step", () => {
    render(
      <OrderTimeline
        stages={stages(["dispatched", 2], ["deposit", 5])}
        currentStatus="deposit"
      />,
    );
    const current = screen.getAllByRole("listitem").filter(
      (li) => li.getAttribute("aria-current") === "step",
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Déposé");
  });

  it("swaps the tail for the return path rather than appending to it", () => {
    // An order that came back did not also get delivered; showing both would
    // say it did.
    render(
      <OrderTimeline
        stages={stages(["dispatched", 2], ["to_be_returned", 8])}
        currentStatus="to_be_returned"
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText("Livré")).toBeNull();
  });

  it("shows dwell time on reached stages and a pending marker on the rest", () => {
    render(
      <OrderTimeline stages={stages(["dispatched", 3])} currentStatus="dispatched" />,
    );
    const steps = screen.getAllByRole("listitem");
    expect(steps[0]).toHaveTextContent("3");
    expect(steps[3]).toHaveTextContent("À venir");
  });

  it("uses no physical direction classes, so it mirrors in RTL", () => {
    const { container } = render(
      <OrderTimeline stages={stages(["dispatched", 1])} currentStatus="dispatched" />,
    );
    const classes = Array.from(container.querySelectorAll("*"))
      .flatMap((el) => Array.from(el.classList))
      .join(" ");
    expect(classes).not.toMatch(/\b(ml-|mr-|pl-|pr-|left-|right-|text-left|text-right)/);
  });
});

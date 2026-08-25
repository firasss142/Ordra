import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TaskCard } from "../TaskCard";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

/**
 * A "Critical Task" — one of the real bench queues.
 *
 * The mockup shows invented tasks with clock deadlines. There is no task
 * model, so each card is a queue the agent actually has to empty, and the
 * "deadline" line becomes the oldest waiting item's age — which is the only
 * true urgency signal available.
 */
afterEach(cleanup);

const base = {
  href: "/fr/warehouse/preparation",
  title: "Préparation",
  pending: 12,
  done: 8,
  foot: "12 colis · plus ancien 3 j",
};

describe("TaskCard", () => {
  it("names the queue and how much of it is left, in one line", () => {
    // Mockup 01 gives the card a title, a bar, and a caption — no separate
    // hero number. The count rides in the caption with the urgency.
    render(<TaskCard {...base} />);
    expect(screen.getByText("Préparation")).toBeInTheDocument();
    expect(screen.getByTestId("wm-task-foot").textContent).toContain("12 colis");
  });

  it("shows progress as done over the whole day's work", () => {
    // 8 done of 20 touched today = 40 %.
    render(<TaskCard {...base} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  });

  it("carries the oldest item's age where the mockup had a deadline", () => {
    render(<TaskCard {...base} />);
    expect(screen.getByTestId("wm-task-foot").textContent).toContain("plus ancien 3 j");
  });

  it("puts the percentage beside the bar, not under it", () => {
    // The mockup reads "[====----] 75%" on one line; stacking them cost a
    // whole row in a card that has to sit two-up.
    render(<TaskCard {...base} />);
    const row = screen.getByTestId("wm-task-progress");
    expect(row.textContent).toContain("40");
    expect(row.querySelector("[role='progressbar']")).not.toBeNull();
  });

  it("dims an empty queue instead of hiding it", () => {
    // A Critical Tasks list that renders nothing reads as a broken screen,
    // not as "you are up to date".
    render(<TaskCard {...base} pending={0} done={0} foot={null} />);
    const card = screen.getByTestId("wm-task-card");
    expect(card.dataset.idle).toBe("true");
    expect(screen.getByText(/rien en attente/i)).toBeInTheDocument();
  });

  it("reports 100 % when everything queued today was cleared", () => {
    render(<TaskCard {...base} pending={0} done={5} foot={null} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("reports 0 %, not NaN, when nothing has been touched at all", () => {
    render(<TaskCard {...base} pending={0} done={0} foot={null} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("is a link to the screen that clears it", () => {
    render(<TaskCard {...base} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/fr/warehouse/preparation");
  });
});

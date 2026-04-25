import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScheduleSuggestionChip } from "../ScheduleSuggestionChip";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    const map: Record<string, string> = {
      scheduleSuggestion: `Relancer dans ${params?.duration ?? ""} ?`,
      acceptSchedule: "Accepter",
      skipSchedule: "Ignorer",
    };
    return map[key] ?? key;
  },
}));

const NOW = new Date("2024-06-15T10:00:00Z").getTime();

describe("ScheduleSuggestionChip", () => {
  it("renders nothing for outcome=other", () => {
    const { container } = render(
      <ScheduleSuggestionChip
        outcome="other"
        onAccept={vi.fn()}
        onSkip={vi.fn()}
        nowMs={NOW}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows duration label for no_answer (4h)", () => {
    render(
      <ScheduleSuggestionChip
        outcome="no_answer"
        onAccept={vi.fn()}
        onSkip={vi.fn()}
        nowMs={NOW}
      />
    );
    expect(screen.getByText(/Relancer dans 4h/i)).toBeInTheDocument();
  });

  it("shows duration label for voicemail (24h)", () => {
    render(
      <ScheduleSuggestionChip
        outcome="voicemail"
        onAccept={vi.fn()}
        onSkip={vi.fn()}
        nowMs={NOW}
      />
    );
    expect(screen.getByText(/24h/i)).toBeInTheDocument();
  });

  it("clicking Accept calls onAccept with a Date", () => {
    const onAccept = vi.fn();
    render(
      <ScheduleSuggestionChip
        outcome="busy"
        onAccept={onAccept}
        onSkip={vi.fn()}
        nowMs={NOW}
      />
    );
    fireEvent.click(screen.getByText("Accepter"));
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onAccept.mock.calls[0][0]).toBeInstanceOf(Date);
    // busy = +2h
    expect(onAccept.mock.calls[0][0].getTime()).toBe(NOW + 2 * 60 * 60 * 1000);
  });

  it("clicking Skip calls onSkip", () => {
    const onSkip = vi.fn();
    render(
      <ScheduleSuggestionChip
        outcome="no_answer"
        onAccept={vi.fn()}
        onSkip={onSkip}
        nowMs={NOW}
      />
    );
    fireEvent.click(screen.getByText("Ignorer"));
    expect(onSkip).toHaveBeenCalledOnce();
  });
});

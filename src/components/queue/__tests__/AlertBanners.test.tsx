import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { AlertBanners } from "../OrderDetailPanel/AlertBanners";

function renderBanners(props: Partial<React.ComponentProps<typeof AlertBanners>> = {}) {
  const onResolveCity = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AlertBanners
        locale="fr"
        editBlocked={false}
        callbackScheduledAt={null}
        dispatchScheduledAt={null}
        dispatchScheduledAuto={false}
        cancelingSchedule={false}
        onCancelSchedule={vi.fn()}
        cityUnmatched={false}
        onResolveCity={onResolveCity}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onResolveCity };
}

describe("AlertBanners — delivery blockers", () => {
  beforeEach(() => vi.clearAllMocks());

  test("says what is blocked, not just what is missing", () => {
    // The reason the city was empty previously reached the user only as an
    // English developer string at the bottom of the history timeline.
    renderBanners({ cityUnmatched: true });

    expect(screen.getByText(/ville non reconnue/i)).toBeInTheDocument();
    expect(screen.getByText(/bloqué/i)).toBeInTheDocument();
  });

  test("carries the action that fixes it", async () => {
    const user = userEvent.setup();
    const { onResolveCity } = renderBanners({ cityUnmatched: true });

    await user.click(screen.getByRole("button", { name: /résoudre/i }));

    expect(onResolveCity).toHaveBeenCalled();
  });

  test("stays silent when the city is set", () => {
    renderBanners({ cityUnmatched: false });
    expect(screen.queryByText(/ville non reconnue/i)).not.toBeInTheDocument();
  });

  test("does not rely on colour alone", () => {
    renderBanners({ cityUnmatched: true });
    // A warning that reads only as "amber" disappears in greyscale.
    const banner = screen.getByRole("status");
    expect(banner.querySelector("svg")).not.toBeNull();
  });

  test("leads, so a blocked order is obvious before anything else", () => {
    renderBanners({ cityUnmatched: true, editBlocked: true });
    const banners = screen.getAllByRole("status");
    expect(banners[0]).toHaveTextContent(/ville non reconnue/i);
  });
});

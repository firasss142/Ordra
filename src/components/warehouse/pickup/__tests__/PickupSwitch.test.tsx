import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import arMessages from "@/messages/ar.json";
import { PickupSwitch } from "../PickupSwitch";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSwitch() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="ar" messages={arMessages} timeZone="Africa/Tripoli">
        <PickupSwitch variant="bench" />
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });

/*
 * The card sits at the top of the agent's Aujourd'hui and Sortir. It used to render nothing
 * while its state loaded, then arrive and push the whole page down under the agent's thumb.
 */
describe("PickupSwitch", () => {
  it("holds its place while the pickup state is on its way", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderSwitch();
    expect(screen.getByTestId("wh-pickup-switch-wait")).toHaveAttribute("aria-busy", "true");
  });

  it("gives the place back when the building has no Darb pickup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ sites: [] })));
    const { container } = renderSwitch();
    await waitFor(() => expect(screen.queryByTestId("wh-pickup-switch-wait")).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });
});

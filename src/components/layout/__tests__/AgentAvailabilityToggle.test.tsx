import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { AgentAvailabilityToggle } from "@/components/layout/AgentAvailabilityToggle";

type State = { is_available: boolean; receiving_orders: boolean };

let state: State;

function renderToggle(live = true) {
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        fetcher: () => ({
          data: { ...state, available_since: null, last_seen_at: null },
        }),
      }}
    >
      <NextIntlClientProvider locale="fr" messages={fr}>
        <AgentAvailabilityToggle live={live} />
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

/** The one geometry rule the shell redesign measured: the trailing cluster
 *  must not move when the state changes (Arabic shifted 13px). */
function widthClasses(el: HTMLElement) {
  return el.className.split(/\s+/).filter((c) => /(^|:)w-/.test(c)).sort().join(" ");
}

describe("AgentAvailabilityToggle", () => {
  beforeEach(() => {
    state = { is_available: false, receiving_orders: false };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { changed: true, released: 0 } }) })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is a real switch whose checked state follows the agent's declaration", async () => {
    renderToggle();
    const sw = await screen.findByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toHaveTextContent(/En pause/);

    state = { is_available: true, receiving_orders: true };
    renderToggle();
    await waitFor(() => {
      expect(screen.getAllByRole("switch").at(-1)).toHaveAttribute("aria-checked", "true");
    });
  });

  it("carries a visible track and knob, not a bare status dot", async () => {
    state = { is_available: true, receiving_orders: true };
    renderToggle();
    const sw = await screen.findByRole("switch");
    const knob = sw.querySelector("[data-knob]");
    const track = sw.querySelector("[data-track]");
    expect(track).not.toBeNull();
    expect(knob).not.toBeNull();
    // ON parks the knob at the far end of the track; OFF at the near end.
    // Logical `start-*` rather than translate, so Arabic mirrors for free.
    expect(knob!.className).toMatch(/start-\[/);
  });

  it("separates « I paused myself » from « my session went quiet »", async () => {
    state = { is_available: true, receiving_orders: false };
    renderToggle();
    const sw = await screen.findByRole("switch");
    expect(sw).toHaveTextContent(/Session inactive/);
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("keeps one fixed width across all three states", async () => {
    const seen = new Set<string>();
    for (const s of [
      { is_available: false, receiving_orders: false },
      { is_available: true, receiving_orders: true },
      { is_available: true, receiving_orders: false },
    ]) {
      state = s;
      const { unmount } = renderToggle();
      seen.add(widthClasses(await screen.findByRole("switch")));
      unmount();
    }
    expect(seen.size).toBe(1);
    expect([...seen][0]).not.toBe("");
  });

  it("marks itself busy while the toggle is in flight", async () => {
    let release!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((res) => { release = () => res({ ok: true, json: async () => ({ data: { changed: true, released: 0 } }) }); })),
    );
    renderToggle();
    const sw = await screen.findByRole("switch");
    expect(sw).toHaveAttribute("aria-busy", "false");

    await userEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-busy", "true"));

    await act(async () => { release(); });
    await waitFor(() => expect(sw).toHaveAttribute("aria-busy", "false"));
  });

  it("says how many orders went back to the pool when the agent stands down", async () => {
    state = { is_available: true, receiving_orders: true };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { changed: true, released: 4 } }) })));
    renderToggle();
    const sw = await screen.findByRole("switch");
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));

    await userEvent.click(sw);
    expect(await screen.findByRole("status")).toHaveTextContent(/4/);
  });
});

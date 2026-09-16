import { render, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { DarbAssabilDispatchModal } from "../DarbAssabilDispatchModal";
import { resolveOrderPreferences } from "@/lib/carriers/order-preferences";

vi.mock("swr", () => ({ default: vi.fn() }));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

import useSWR from "swr";

const SERVICES = [
  {
    service_id: "svc-male",
    title: "توصيل رجالي",
    attribute: "male",
    surcharge: 0,
    currency: "lyd",
    is_default: true,
  },
];

const DESTINATIONS = [{ id: 4, city: "طرابلس", area: "جنزور" }];

/**
 * Mount the modal with a given order-preference policy in place.
 *
 * Only the policy endpoint varies; everything else returns the same shape the
 * existing modal suite uses.
 */
function mockWithPolicy(
  policy: Parameters<typeof resolveOrderPreferences>[0],
  modes: { home: boolean; carrier: boolean } = { home: true, carrier: true },
  opts: { warehouseAvailable?: boolean } = {},
) {
  (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
    if (typeof key !== "string") return { data: undefined, isLoading: false };

    if (key.includes("/order-preferences")) {
      return {
        data: { data: resolveOrderPreferences(policy), fulfilmentModes: modes },
        isLoading: false,
      };
    }
    if (key.includes("/warehouse-availability")) {
      return {
        data: {
          available: opts.warehouseAvailable ?? true,
          reason: null,
          lines: [],
        },
        isLoading: false,
      };
    }
    if (key.includes("/api/darb/services")) {
      return { data: { services: SERVICES }, isLoading: false };
    }
    if (key.includes("/api/darb/destinations")) {
      return { data: { destinations: DESTINATIONS }, isLoading: false };
    }
    if (key.includes("/api/carriers/rates")) {
      return {
        data: { data: { recommended_carrier_id: null, reason: "", rates: [] } },
        isLoading: false,
      };
    }
    return { data: undefined, isLoading: false };
  });
}

/**
 * The fulfilment radiogroup of ONE render.
 *
 * Scoped twice over, and both scopes are load-bearing:
 *   - to `view` because src/test/setup.ts installs no RTL `cleanup`, so every
 *     render in this file stays in document.body and a bare screen query sees
 *     each previous modal too;
 *   - to the radiogroup because "Entrepôt Darb Assabil" also names a Darb
 *     *service* tile in the other radiogroup of the same modal.
 */
function fulfilmentGroup(view: ReturnType<typeof mount>) {
  return within(view.container).getByRole("radiogroup", {
    name: /Source d'expédition/i,
  });
}

/**
 * One fulfilment tile, by its TITLE.
 *
 * A ChoiceTile's accessible name is title + hint run together, so « Notre
 * entrepôt » carries the name "Notre entrepôtDarb Assabil récupère le colis
 * chez nous" — which a loose /Entrepôt Darb Assabil/i matches as well as the
 * tile actually named that. Anchoring on the start of the name keeps the two
 * apart.
 */
function tile(view: ReturnType<typeof mount>, title: "Notre entrepôt" | "Entrepôt Darb Assabil") {
  return within(fulfilmentGroup(view)).queryByRole("radio", {
    name: new RegExp("^" + title),
  });
}

function mount() {
  return render(
    <DarbAssabilDispatchModal
      orderId="o-1"
      carrierId="c-tripoli"
      customerAddress="Rue de Tripoli"
      customerCity="طرابلس"
      totalPrice={100}
      darbDestinationId={4}
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { tracking_number: "TN1" } }),
  }) as unknown as typeof fetch;
});

describe("DarbAssabilDispatchModal — politique d'options", () => {
  it("shows every option when the policy leaves them all overridable", async () => {
    mockWithPolicy([]);
    const view = mount();

    await waitFor(() => {
      expect(within(view.container).getByLabelText(/Autoriser l'essai/i)).toBeInTheDocument();
    });
  });

  it("hides an option the policy locks", async () => {
    mockWithPolicy([
      {
        carrier_id: "c-tripoli",
        option_key: "allow_testing",
        default_value: false,
        can_override: false,
      },
    ]);
    const view = mount();

    // The unlocked neighbour still renders, so absence is the policy and not a
    // failure to mount.
    await waitFor(() => {
      expect(within(view.container).getByLabelText(/Ouvrir le colis/i)).toBeInTheDocument();
    });
    expect(within(view.container).queryByLabelText(/Autoriser l'essai/i)).not.toBeInTheDocument();
  });

  it("offers both fulfilment modes by default", async () => {
    mockWithPolicy([]);
    const view = mount();

    await waitFor(() => {
      expect(tile(view, "Notre entrepôt")).toBeInTheDocument();
    });
    expect(tile(view, "Entrepôt Darb Assabil")).toBeInTheDocument();
  });

  it("hides the Darb warehouse tile when the policy turns that mode off", async () => {
    mockWithPolicy([], { home: true, carrier: false });
    const view = mount();

    await waitFor(() => {
      expect(tile(view, "Notre entrepôt")).toBeInTheDocument();
    });
    expect(tile(view, "Entrepôt Darb Assabil")).not.toBeInTheDocument();
  });

  it("hides our own warehouse tile when that mode is turned off", async () => {
    mockWithPolicy([], { home: false, carrier: true });
    const view = mount();

    await waitFor(() => {
      expect(tile(view, "Entrepôt Darb Assabil")).toBeInTheDocument();
    });
    expect(tile(view, "Notre entrepôt")).not.toBeInTheDocument();
  });

  // The modal opens on "home"; with home disabled it must move off it rather
  // than sit on a mode the policy excludes.
  it("selects the carrier warehouse when our own is disabled", async () => {
    mockWithPolicy([], { home: false, carrier: true });
    const view = mount();

    await waitFor(() => {
      expect(tile(view, "Entrepôt Darb Assabil")).toHaveAttribute("aria-checked", "true");
    });
  });

  it("applies a configured default to the checkbox on open", async () => {
    mockWithPolicy([
      {
        carrier_id: "c-tripoli",
        option_key: "allow_inspection",
        default_value: true,
        can_override: true,
      },
    ]);
    const view = mount();

    await waitFor(() => {
      expect(within(view.container).getByLabelText(/Ouvrir le colis/i)).toBeChecked();
    });
  });
});

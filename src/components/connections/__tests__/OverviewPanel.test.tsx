import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import arMessages from "@/messages/ar.json";
import frMessages from "@/messages/fr.json";

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown> }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => "fr",
  };
});
const overview = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("swr", () => ({ default: () => ({ data: overview.current, isLoading: false }) }));

import { OverviewPanel } from "../OverviewPanel";

/**
 * Vue d'ensemble — only the WhatsApp row is under test here: it must say how
 * many markets are wired, in the reader's language.
 */
function withWhatsApp(whatsapp: { connected: number; active: number; markets: number }) {
  overview.current = {
    data: {
      storefronts: [],
      carriers: [],
      services: { meta_accounts: 0, whatsapp },
      automations: [],
      kpis: { events_24h: 0, errors_24h: 0, error_rate: 0, webhooks_24h: 0, mappings_total: 0, mappings_products: 0, mappings_cities: 0, mappings_warehouse: 0 },
    },
  };
}

beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
});

describe("OverviewPanel — WhatsApp row", () => {
  it("counts the connected markets and says Connecté when one is active", () => {
    withWhatsApp({ connected: 1, active: 1, markets: 2 });
    render(<OverviewPanel onNavigate={vi.fn()} />);
    const row = screen.getByText("WhatsApp Business").closest("div")!;
    expect(row).toHaveTextContent("Cloud API · 1/2 marché(s) relié(s)");
    expect(row).toHaveTextContent("Connecté");
    expect(row).toHaveTextContent("temps réel");
  });

  it("is translated in Arabic", () => {
    intl.messages = arMessages as Record<string, unknown>;
    withWhatsApp({ connected: 0, active: 0, markets: 2 });
    render(<OverviewPanel onNavigate={vi.fn()} />);
    const row = screen.getByText("WhatsApp Business").closest("div")!;
    expect(row).toHaveTextContent("Cloud API · 0/2 سوق موصول");
    expect(row).toHaveTextContent("غير موصول");
  });
});

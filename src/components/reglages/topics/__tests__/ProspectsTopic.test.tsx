import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";
import type { AuthUser } from "@/types";

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown> }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => "fr",
  };
});
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
const swr = vi.hoisted(() => ({ byKey: {} as Record<string, unknown>, mutate: vi.fn() }));
vi.mock("swr", () => ({ default: (key: string | null) => ({ data: key ? swr.byKey[key] : undefined, isLoading: false, mutate: swr.mutate }) }));

import { ReglagesFormProvider } from "../../form-context";
import { SaveBar } from "../../kit/SaveBar";
import { ProspectsTopic } from "../ProspectsTopic";

const TN = "00000000-0000-0000-0000-000000000001";
const manager: AuthUser = { id: "m", email: "m@x", full_name: "M", avatar_url: null, role: "market_manager", market_id: TN, locale: "fr", direction: "ltr" };
const fetchMock = vi.fn();

beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  swr.byKey = { [`/api/settings/${TN}`]: { data: [] } };
  swr.mutate.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("Réglages › Prospects", () => {
  it("shows the two rules the code already used, with their old values", () => {
    render(
      <ReglagesFormProvider>
        <ProspectsTopic user={manager} marketId={TN} marketCode="tn" />
      </ReglagesFormProvider>,
    );
    expect(screen.getByRole("spinbutton", { name: "Appels avant d’abandonner un prospect" })).toHaveValue(3);
    expect(screen.getByRole("spinbutton", { name: "Prospect «\u202fchaud\u202f»" })).toHaveValue(60);
    expect(screen.getByText(/Au 3ᵉ appel sans réponse, le prospect/)).toBeInTheDocument();
  });

  it("a manager saves them for their market", async () => {
    render(
      <ReglagesFormProvider>
        <SaveBar />
        <ProspectsTopic user={manager} marketId={TN} marketCode="tn" />
      </ReglagesFormProvider>,
    );
    const attempts = screen.getByRole("spinbutton", { name: "Appels avant d’abandonner un prospect" });
    await userEvent.clear(attempts);
    await userEvent.type(attempts, "5");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/settings/${TN}`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ max_lead_attempts: 5 });
  });
});

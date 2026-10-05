import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { AuthUser } from "@/types";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/fr/investor" }));
vi.mock("swr", () => ({ default: () => ({ data: undefined, mutate: vi.fn() }) }));
vi.mock("@/lib/client/image", async (orig) => ({
  ...(await orig<typeof import("@/lib/client/image")>()),
  decodeImageFile: async () => ({ ok: true, dataUrl: "data:image/png;base64,AAA" }),
}));

import { AccountClient } from "../AccountClient";
import { InvestorShell } from "../InvestorShell";

const INV: AuthUser = { id: "i1", email: "inv@x.tn", full_name: "Sami Trabelsi", avatar_url: null, role: "investor", market_id: "m", locale: "fr", direction: "ltr" };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ avatar_url: "https://cdn/i.png?v=1" }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("investor — own photo", () => {
  test("the account page lets the investor set their photo", async () => {
    render(<AccountClient user={INV} locale="fr" />);
    fireEvent.change(screen.getByTestId("photo-input"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/me/avatar", expect.objectContaining({ method: "PUT", body: JSON.stringify({ avatar: "data:image/png;base64,AAA" }) })),
    );
  });

  test("the portal header shows the photo instead of the initials", () => {
    const { container } = render(<InvestorShell user={{ ...INV, avatar_url: "https://cdn/i.png" }} locale="fr"><p>x</p></InvestorShell>);
    expect(container.querySelector('header img[src="https://cdn/i.png"]')).not.toBeNull();
    expect(screen.queryByText("ST")).toBeNull();
  });
});

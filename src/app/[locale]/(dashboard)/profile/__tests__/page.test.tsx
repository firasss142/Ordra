import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthUser } from "@/types";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
  }),
}));
// jsdom has no createImageBitmap: the downscale is PhotoPicker's own test.
vi.mock("@/lib/client/image", async (orig) => ({
  ...(await orig<typeof import("@/lib/client/image")>()),
  decodeImageFile: async () => ({ ok: true, dataUrl: "data:image/png;base64,AAA" }),
}));

import { AuthProvider } from "@/context/auth";
import ProfilePage from "../page";

const ME: AuthUser = { id: "u1", email: "amel@oms.local", full_name: "Amel Haddad", avatar_url: null, role: "market_manager", market_id: null, locale: "fr", direction: "ltr" };
const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset().mockImplementation(async (_u: string, init?: RequestInit) =>
    new Response(JSON.stringify({ avatar_url: JSON.parse(String(init?.body)).avatar ? "https://cdn/me.png?v=1" : null }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const page = (user = ME) => render(<AuthProvider initialUser={user}><ProfilePage /></AuthProvider>);

describe("Mon profil — ma photo", () => {
  test("anyone can put their own photo, and it shows at once everywhere", async () => {
    const { container } = page();
    const card = screen.getByRole("region", { name: "Photo de profil" });
    await userEvent.upload(within(card).getByTestId("photo-input"), new File(["x"], "me.png", { type: "image/png" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/me/avatar", expect.objectContaining({ method: "PUT", body: JSON.stringify({ avatar: "data:image/png;base64,AAA" }) })),
    );
    await waitFor(() => expect(container.querySelector('img[src="https://cdn/me.png?v=1"]')).not.toBeNull());
    expect(refresh).toHaveBeenCalled();
  });

  test("can remove it", async () => {
    page({ ...ME, avatar_url: "https://cdn/old.png" });
    await userEvent.click(screen.getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/me/avatar", expect.objectContaining({ body: JSON.stringify({ avatar: null }) })));
  });

  test("a refused upload is shown, not swallowed", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Image too large" }), { status: 413 }));
    page();
    await userEvent.upload(screen.getByTestId("photo-input"), new File(["x"], "me.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La photo n'a pas pu être enregistrée");
  });
});

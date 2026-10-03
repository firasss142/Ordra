import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const mockSignIn = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword: (...a: unknown[]) => mockSignIn(...a) } }),
}));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

import LoginPage from "../page";
import fr from "@/messages/fr.json";

const fetchMock = vi.fn();
const originalLocation = window.location;

function submit(username = "admin", password = "pw") {
  fireEvent.change(screen.getByLabelText(fr.auth.username), { target: { value: username } });
  fireEvent.change(screen.getByLabelText(fr.auth.password), { target: { value: password } });
  fireEvent.submit(screen.getByLabelText(fr.auth.username).closest("form")!);
}

function loginEventCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === "/api/auth/login-event");
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: { href: "/fr/login" } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: originalLocation });
});

describe("LoginPage — the sign-in is journaled, fire-and-forget", () => {
  test("a refused sign-in reports ok:false with the resolved e-mail, and the error still shows", async () => {
    mockSignIn.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LoginPage />);
    submit("Manager TN");

    expect(await screen.findByText(fr.auth.invalidCredentials)).toBeInTheDocument();
    expect(loginEventCalls()).toHaveLength(1);
    const [, init] = loginEventCalls()[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ email: "manager.tn@oms.local", ok: false });
  });

  test("a successful sign-in reports ok:true with keepalive (it must outlive the navigation), then navigates", async () => {
    mockSignIn.mockResolvedValue({ error: null });
    render(<LoginPage />);
    submit("admin");

    await waitFor(() => expect(window.location.href).toBe("/"));
    expect(loginEventCalls()).toHaveLength(1);
    const [, init] = loginEventCalls()[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: "admin@oms.local", ok: true });
    expect(init.keepalive).toBe(true);
  });

  test("a journal call that never answers does not hold the sign-in", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    mockSignIn.mockResolvedValue({ error: null });
    render(<LoginPage />);
    submit("admin");

    await waitFor(() => expect(window.location.href).toBe("/"));
  });

  test("a journal call that rejects changes nothing on a refused sign-in", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    mockSignIn.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LoginPage />);
    submit("admin");

    expect(await screen.findByText(fr.auth.invalidCredentials)).toBeInTheDocument();
  });

  test("a fetch that throws synchronously changes nothing on a successful sign-in", async () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError("fetch is broken");
    });
    mockSignIn.mockResolvedValue({ error: null });
    render(<LoginPage />);
    submit("admin");

    await waitFor(() => expect(window.location.href).toBe("/"));
  });
});

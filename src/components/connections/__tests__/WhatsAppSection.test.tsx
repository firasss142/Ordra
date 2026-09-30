import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown>, locale: "fr" }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => intl.locale,
  };
});
vi.mock("next/navigation", () => ({ useParams: () => ({ locale: intl.locale }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} data-next-link="" {...rest}>
      {children}
    </a>
  ),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { WhatsAppSection } from "../WhatsAppSection";

/**
 * The card is what the owner sees while wiring Meta up. It must be honest
 * about the intermediate states (connected but unverified, never received a
 * webhook), never show a secret it was not asked for, and let a
 * market_manager look without touching. Prototype:
 * prototypes/whatsapp-manager-v1.html?screen=connexions.
 */
const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";
const MARKETS = [
  { id: TN, name: "Tunisie", code: "tn" },
  { id: LY, name: "Libye", code: "ly" },
];

const CFG_TN = {
  id: "cfg-tn",
  market_id: TN,
  waba_id: "102938475647382",
  phone_number_id: "564738291028374",
  app_id: "918273645564738",
  graph_version: "v26.0",
  display_phone: "+216 29 000 000",
  verified_name: "Ordra Tunisie",
  quality_rating: "GREEN",
  messaging_limit_tier: "TIER_1K",
  status: "active",
  status_reason: null,
  send_rate_per_sec: 3,
  last_webhook_at: new Date(Date.now() - 4 * 60_000).toISOString(),
  last_checked_at: null,
  last_error: null,
  token_masked: "••••••••",
  has_app_secret: true,
  has_verify_token: true,
  templates: { approved: 12, pending: 3, rejected: 1 },
};

const FIVE_STAGES = [
  { key: "credentials", status: "ok", code: "credentials_ok", detail: "déchiffrés" },
  { key: "phone", status: "ok", code: "phone_registered", params: { name: "Ordra Tunisie", phone: "+216 29 000 000" }, detail: "Ordra Tunisie · +216 29 000 000 · enregistré" },
  { key: "waba", status: "ok", code: "waba_counts", params: { total: 15, approved: 12, pending: 0, rejected: 0 }, detail: "15 modèles · 12 approuvés" },
  { key: "subscription", status: "warning", code: "subscription_fixed", detail: "abonnement absent — corrigé automatiquement" },
  { key: "webhook", status: "warning", code: "webhook_never", detail: "aucun événement reçu" },
];

const mutate = vi.fn();

function mockConfigs(rows: unknown[]) {
  (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string | null) => {
    if (key === "/api/whatsapp/config") return { data: { data: rows }, mutate, isLoading: false };
    return { data: undefined, mutate: vi.fn() };
  });
}

function mount(readOnly = false) {
  return render(
    <ToastProvider>
      <WhatsAppSection markets={MARKETS} readOnly={readOnly} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  intl.messages = frMessages as Record<string, unknown>;
  intl.locale = "fr";
  vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
});

describe("WhatsAppSection", () => {
  it("renders one card per market: connected TN with its facts, LY not connected", () => {
    mockConfigs([CFG_TN]);
    mount();
    const tn = screen.getByTestId(`wa-card-${TN}`);
    expect(within(tn).getByText("Connecté")).toBeInTheDocument();
    expect(within(tn).getByText(/Ordra Tunisie/)).toBeInTheDocument();
    expect(within(tn).getByText(/1 000 destinataires/)).toBeInTheDocument();
    const tpl = within(tn).getByRole("link", { name: /12 approuvés · 3 en attente · 1 refusé/ });
    // A client-side link to Modèles: no full reload.
    expect(tpl).toHaveAttribute("href", "/fr/messages/templates");
    expect(tpl).toHaveAttribute("data-next-link");
    expect(within(tn).getByText(/il y a 4 min/)).toBeInTheDocument();
    const ly = screen.getByTestId(`wa-card-${LY}`);
    expect(within(ly).getByText("Non connecté")).toBeInTheDocument();
    expect(within(ly).getByRole("button", { name: /Connecter/ })).toBeInTheDocument();
  });

  it("never shows a secret unasked — token, app secret and verify token are masked", () => {
    mockConfigs([CFG_TN]);
    mount();
    const tn = screen.getByTestId(`wa-card-${TN}`);
    expect(within(tn).getAllByText("••••••••").length).toBeGreaterThanOrEqual(3);
    expect(within(tn).queryByText(/EAA/)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("flags the intermediate states honestly: unverified tier, no webhook yet, auth failure, paused", () => {
    mockConfigs([
      { ...CFG_TN, messaging_limit_tier: "TIER_250", last_webhook_at: null },
      { ...CFG_TN, id: "cfg-ly", market_id: LY, status: "auth_failed", status_reason: "Jeton refusé (code 190)" },
    ]);
    mount();
    const tn = screen.getByTestId(`wa-card-${TN}`);
    expect(within(tn).getByText("Connecté · non vérifié")).toBeInTheDocument();
    expect(within(tn).getByText(/250 destinataires/)).toBeInTheDocument();
    expect(within(tn).getByText("jamais")).toBeInTheDocument();
    const ly = screen.getByTestId(`wa-card-${LY}`);
    expect(within(ly).getByText("Jeton invalide")).toBeInTheDocument();
    expect(within(ly).getByText(/code 190/)).toBeInTheDocument();
  });

  it("names the automatic sends' last pass as a clock time in the market's zone", () => {
    mockConfigs([
      {
        ...CFG_TN,
        automation: { enabled: true, queued: 2, sending: 1, last_run: { started_at: "2026-09-25T09:31:00Z", finished_at: null, status: "ok", sent: 3, failed: 0 }, cron: { schedule: "* * * * *", active: true } },
      },
    ]);
    mount();
    // Africa/Tunis is UTC+1.
    expect(within(screen.getByTestId(`wa-card-${TN}`)).getByText(/dernière passe 10:31 · 3 en file/)).toBeInTheDocument();
  });

  it("runs the staged test and renders the five stages as filled status circles", async () => {
    mockConfigs([CFG_TN]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true, stages: FIVE_STAGES } }), { status: 200 }),
    );
    mount();
    const tn = screen.getByTestId(`wa-card-${TN}`);
    await userEvent.click(within(tn).getByRole("button", { name: /Tester/ }));
    expect(global.fetch).toHaveBeenCalledWith(`/api/whatsapp/config/${TN}/test`, { method: "POST" });
    expect(await within(tn).findByText("Abonnement de l'app")).toBeInTheDocument();
    expect(within(tn).getByText(/corrigé automatiquement/)).toBeInTheDocument();
    expect(within(tn).getByText("Webhook")).toBeInTheDocument();
    const icons = within(tn).getAllByTestId("wa-stage-icon");
    expect(icons.map((i) => i.getAttribute("data-status"))).toEqual(["ok", "ok", "ok", "warning", "warning"]);
  });

  it("shows the persisted last test without re-running it — the checklist survives a reload", () => {
    mockConfigs([{ ...CFG_TN, last_test_at: new Date(Date.now() - 10 * 60_000).toISOString(), last_test_ok: true, last_test_stages: FIVE_STAGES }]);
    mount();
    const tn = screen.getByTestId(`wa-card-${TN}`);
    expect(within(tn).getByText("Abonnement de l'app")).toBeInTheDocument();
    expect(within(tn).getByText(/15 modèles · 12 approuvés/)).toBeInTheDocument();
    expect(within(tn).getByText(/Dernier test · il y a 10 min/)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits the credential form with the six fields, toasts « Vérifié… (chiffré) » and refreshes", async () => {
    mockConfigs([]);
    mount();
    const ly = screen.getByTestId(`wa-card-${LY}`);
    await userEvent.click(within(ly).getByRole("button", { name: /Connecter/ }));
    await userEvent.type(within(ly).getByLabelText("WABA ID"), "555");
    await userEvent.type(within(ly).getByLabelText("Phone number ID"), "222");
    await userEvent.type(within(ly).getByLabelText("App ID"), "777");
    await userEvent.type(within(ly).getByLabelText(/Jeton d'accès/), "EAAnew");
    await userEvent.type(within(ly).getByLabelText("App secret"), "s3cret");
    const save = within(ly).getByRole("button", { name: /Vérifier et enregistrer/ });
    expect(save).toBeEnabled();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(JSON.stringify({ data: CFG_TN }), { status: 201 }));
    await userEvent.click(save);
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(url).toBe("/api/whatsapp/config");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ market_id: LY, waba_id: "555", phone_number_id: "222", app_id: "777", access_token: "EAAnew", app_secret: "s3cret" });
    expect(body.verify_token).toMatch(/^ordra-ly-/);
    expect(await screen.findByText("Vérifié auprès de Meta et enregistré (chiffré)")).toBeInTheDocument();
  });

  it("keeps the form open with the server's message when Meta rejects the token", async () => {
    mockConfigs([]);
    mount();
    const ly = screen.getByTestId(`wa-card-${LY}`);
    await userEvent.click(within(ly).getByRole("button", { name: /Connecter/ }));
    await userEvent.type(within(ly).getByLabelText("WABA ID"), "555");
    await userEvent.type(within(ly).getByLabelText("Phone number ID"), "222");
    await userEvent.type(within(ly).getByLabelText("App ID"), "777");
    await userEvent.type(within(ly).getByLabelText(/Jeton d'accès/), "EAAbad");
    await userEvent.type(within(ly).getByLabelText("App secret"), "s3cret");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_token", message: "Invalid OAuth access token" }), { status: 400 }),
    );
    await userEvent.click(within(ly).getByRole("button", { name: /Vérifier et enregistrer/ }));
    expect(await within(ly).findByRole("alert")).toHaveTextContent(/Invalid OAuth access token/);
    expect(within(ly).getByLabelText(/Jeton d'accès/)).toHaveValue("EAAbad");
  });

  it("keeps « Modifier » in the action bar while the form is open", async () => {
    mockConfigs([CFG_TN]);
    mount();
    const tn = screen.getByTestId(`wa-card-${TN}`);
    await userEvent.click(within(tn).getByRole("button", { name: /Modifier/ }));
    expect(within(tn).getByLabelText("WABA ID")).toHaveValue(CFG_TN.waba_id);
    expect(within(tn).getByRole("button", { name: /Modifier/ })).toBeInTheDocument();
  });

  it("pauses through PATCH", async () => {
    mockConfigs([CFG_TN]);
    mount();
    const tn = screen.getByTestId(`wa-card-${TN}`);
    await userEvent.click(within(tn).getByRole("button", { name: /Mettre en pause/ }));
    expect(global.fetch).toHaveBeenCalledWith(`/api/whatsapp/config/${TN}`, expect.objectContaining({ method: "PATCH" }));
    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ status: "paused" });
  });

  it("super_admin reveals the verify token on the card through its own route, and hides it again", async () => {
    mockConfigs([CFG_TN]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { verify_token: "ordra-tn-2b9e4d1c7a" } }), { status: 200 }),
    );
    mount();
    const tn = screen.getByTestId(`wa-card-${TN}`);
    await userEvent.click(within(tn).getByRole("button", { name: "Afficher" }));
    expect(global.fetch).toHaveBeenCalledWith(`/api/whatsapp/config/${TN}/verify-token`, expect.anything());
    // Shown on the card AND in the webhook block's row for Tunisie.
    expect(await screen.findAllByText("ordra-tn-2b9e4d1c7a")).toHaveLength(2);
    await userEvent.click(within(tn).getByRole("button", { name: "Masquer" }));
    expect(screen.queryByText("ordra-tn-2b9e4d1c7a")).not.toBeInTheDocument();
  });

  it("the webhook block has one « Verify token · marché » row per market; an unconnected market has nothing to reveal", () => {
    mockConfigs([CFG_TN]);
    mount();
    const block = screen.getByTestId("wa-webhook-block");
    expect(within(block).getByText("Verify token · Tunisie")).toBeInTheDocument();
    expect(within(block).getByText("Verify token · Libye")).toBeInTheDocument();
    expect(within(block).getAllByRole("button", { name: "Afficher" })).toHaveLength(1);
    expect(within(block).queryByText(/jamais réaffiché/)).not.toBeInTheDocument();
  });

  it("read-only (market_manager): no form, no actions, no reveal, no System User chip — still the facts and the webhook block", () => {
    mockConfigs([CFG_TN]);
    mount(true);
    const tn = screen.getByTestId(`wa-card-${TN}`);
    expect(within(tn).queryByRole("button", { name: /Modifier/ })).not.toBeInTheDocument();
    expect(within(tn).queryByRole("button", { name: /Mettre en pause/ })).not.toBeInTheDocument();
    expect(within(tn).queryByText(/System User · permanent/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Afficher" })).not.toBeInTheDocument();
    expect(within(tn).getByText(/Ordra Tunisie/)).toBeInTheDocument();
    expect(screen.getByText("/api/webhooks/whatsapp", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("message_template_status_update")).toBeInTheDocument();
  });

  it("shows the webhook block with the callback URL and the fields to subscribe", () => {
    mockConfigs([CFG_TN]);
    mount();
    expect(screen.getByText(/Webhook — à coller dans l'app Meta/)).toBeInTheDocument();
    for (const f of ["messages", "message_template_status_update", "phone_number_quality_update", "account_update"]) {
      expect(screen.getByText(f)).toBeInTheDocument();
    }
    expect(screen.getByText(/401/)).toBeInTheDocument();
  });

  it("speaks Arabic: headings, badges and the stage details all come from the ar catalogue", () => {
    intl.messages = arMessages as Record<string, unknown>;
    intl.locale = "ar";
    mockConfigs([{ ...CFG_TN, last_test_at: new Date().toISOString(), last_test_ok: true, last_test_stages: FIVE_STAGES }]);
    mount();
    expect(screen.getByText("واتساب للأعمال — Cloud API")).toBeInTheDocument();
    const tn = screen.getByTestId(`wa-card-${TN}`);
    expect(within(tn).getByText("موصول")).toBeInTheDocument();
    expect(within(tn).getByText("اشتراك التطبيق")).toBeInTheDocument();
    expect(within(tn).getByText(/الاشتراك كان غائباً — صُحّح تلقائياً/)).toBeInTheDocument();
    expect(within(screen.getByTestId(`wa-card-${LY}`)).getByText("غير موصول")).toBeInTheDocument();
  });
});

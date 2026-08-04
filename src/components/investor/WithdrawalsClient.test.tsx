import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import { WithdrawalsClient } from "./WithdrawalsClient";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
    let val: unknown = frMessages;
    for (const p of parts) val = (val as Record<string, unknown>)?.[p];
    return typeof val === "string" ? val : key;
  },
  useLocale: () => "fr",
}));

const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (key: string) => mockUseSWR(key),
  mutate: vi.fn(),
}));

const t = (key: string) => {
  let val: unknown = frMessages;
  for (const p = key.split("."), i = { v: 0 }; i.v < p.length; i.v++) {
    val = (val as Record<string, unknown>)?.[p[i.v]];
  }
  return val as string;
};

const EXCEEDS = t("investor.withdrawals.exceeds");

/** available from the ledger, plus whatever open requests already claim. */
function mount(available: number, claimed: { amount: number; status: string }[]) {
  mockUseSWR.mockImplementation((key: string) => {
    if (key === "/api/investor/withdrawals") {
      return {
        data: {
          data: claimed.map((c, i) => ({
            id: `w-${i}`,
            amount: c.amount,
            status: c.status,
            requested_at: "2026-08-02T10:00:00.000Z",
            decided_at: null,
            paid_at: null,
            payout_reference: null,
          })),
        },
        error: undefined,
        isLoading: false,
        mutate: vi.fn(),
      };
    }
    if (key === "/api/investor/portfolio") {
      return { data: { data: { balance: { available } } } };
    }
    return { data: undefined };
  });

  return render(<WithdrawalsClient available={available} market="TN" />);
}

beforeEach(() => {
  mockUseSWR.mockReset();
  vi.restoreAllMocks();
});

/**
 * The withdrawable figure. It is now the hero of the screen rather than a
 * caption, so the label and the amount are separate elements.
 */
const spendable = () =>
  screen.getByText(frMessages.investor.withdrawals.available).nextElementSibling!;

describe("WithdrawalsClient — spendable balance", () => {
  test("is exactly zero when open requests consume the balance", () => {
    // 605.34 - (300 + 305.34). In float this leaves 1.1368683772161603e-13,
    // which is neither <= 0 nor a sane `max`, so the form stayed live at a
    // displayed balance of zero and native validation swallowed every submit.
    mount(605.34, [
      { amount: 300, status: "requested" },
      { amount: 305.34, status: "requested" },
    ]);

    expect(spendable()).toHaveTextContent("0,000");
    expect(screen.getByRole("button", { name: /Envoyer la demande/ })).toBeDisabled();
  });

  test("counts approved requests as claimed too", () => {
    mount(1000, [
      { amount: 400, status: "approved" },
      { amount: 100, status: "requested" },
    ]);
    expect(spendable()).toHaveTextContent("500,000");
  });

  test("ignores rejected and paid requests", () => {
    mount(1000, [
      { amount: 400, status: "rejected" },
      { amount: 250, status: "paid" },
    ]);
    expect(spendable()).toHaveTextContent("1 000,000");
  });

  test("sums many claims without float drift", () => {
    mount(100, Array.from({ length: 10 }, () => ({ amount: 10.001, status: "requested" })));
    // 100 - 100.010 clamps to 0, and must not leave a residue.
    expect(spendable()).toHaveTextContent("0,000");
  });
});

describe("WithdrawalsClient — submitting more than is available", () => {
  test("shows the error instead of silently doing nothing", async () => {
    // The regression: `max={spendable}` made the browser block submit before
    // onSubmit ran, so this message was unreachable and the investor saw no
    // feedback at all.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount(500, []);

    fireEvent.change(screen.getByLabelText(/Montant/), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: /Envoyer la demande/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(EXCEEDS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("does not cap the input with a max attribute", () => {
    mount(500, []);
    expect(screen.getByLabelText(/Montant/)).not.toHaveAttribute("max");
  });

  test("surfaces the server's rejection when it disagrees", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "AMOUNT_EXCEEDS_AVAILABLE" }), { status: 422 })
    );
    mount(500, []);

    fireEvent.change(screen.getByLabelText(/Montant/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /Envoyer la demande/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(EXCEEDS);
  });
});

describe("WithdrawalsClient — a valid request", () => {
  test("posts the amount and confirms", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: { id: "w-1" } }), { status: 201 }));
    mount(500, []);

    fireEvent.change(screen.getByLabelText(/Montant/), { target: { value: "120.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Envoyer la demande/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({ amount: 120.5 });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("investor.withdrawals.success")
    );
  });
});

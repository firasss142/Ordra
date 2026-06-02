import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { DarbAssabilDispatchModal } from "../DarbAssabilDispatchModal";

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

function mockActiveCarrier() {
  (useSWR as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { carrier: { id: "c-darb", is_active: true } },
    isLoading: false,
  });
}

const BASE = {
  orderId: "order-1",
  marketId: "m-ly",
  customerAddress: "test",
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockActiveCarrier();
});

describe("DarbAssabilDispatchModal — destination resolution", () => {
  it("single-area city (اجدابيا) shows a FIXED destination, not a free picker", () => {
    render(<DarbAssabilDispatchModal {...BASE} customerCity="اجدابيا" />);
    // The resolved destination اجدابيا is shown…
    expect(screen.getByText(/اجدابيا/)).toBeInTheDocument();
    // …and there is NO search box (nothing to misclick).
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("multi-area city (الجفرة) shows the picker scoped to its areas only", () => {
    render(<DarbAssabilDispatchModal {...BASE} customerCity="الجفرة" />);
    // Picker present and الجفرة's areas listed…
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByText("الجفرة — سوكنة")).toBeInTheDocument();
    // …but a different city's area (طرابلس/عين زارة) is excluded by the scope.
    expect(screen.queryByText(/عين زارة/)).not.toBeInTheDocument();
  });

  it("unknown city shows the full picker", () => {
    render(<DarbAssabilDispatchModal {...BASE} customerCity="ضواحي طرابلس" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    // Full list → areas from multiple distinct cities available.
    expect(screen.getByText("الجفرة — سوكنة")).toBeInTheDocument();
    expect(screen.getByText("طرابلس — عين زارة")).toBeInTheDocument();
  });
});

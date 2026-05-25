import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

const mockHook = vi.fn();
vi.mock("@/hooks/useDexpressStatus", () => ({
  useDexpressStatus: (...args: unknown[]) => mockHook(...args),
}));

import { DexpressStatusSection } from "../DexpressStatusSection";

const okSnapshot = {
  kind: "ok" as const,
  trackingNumber: "1343188",
  slug: "IN_COMPANY" as const,
  statusId: 3,
  rawLabel: "فى الشركة",
  isAccepted: true,
};

beforeEach(() => {
  mockHook.mockReset();
});

describe("DexpressStatusSection — enabled gate", () => {
  it("renders nothing when enabled is false", () => {
    mockHook.mockReturnValue({
      snapshot: null,
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    const { container } = render(
      <DexpressStatusSection orderId="o-1" enabled={false} role="agent" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("passes enabled=true and orderId through to the hook when eligible", () => {
    mockHook.mockReturnValue({
      snapshot: okSnapshot,
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <DexpressStatusSection orderId="o-1" enabled={true} role="agent" />,
    );

    expect(mockHook).toHaveBeenCalledWith("o-1", true);
  });
});

describe("DexpressStatusSection — loading state", () => {
  it("renders a skeleton while loading", () => {
    mockHook.mockReturnValue({
      snapshot: null,
      isLoading: true,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <DexpressStatusSection orderId="o-1" enabled={true} role="agent" />,
    );

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });
});

describe("DexpressStatusSection — role-specific rendering for kind:ok", () => {
  beforeEach(() => {
    mockHook.mockReturnValue({
      snapshot: okSnapshot,
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  it("agent role shows raw Arabic label only — no SLUG prefix", () => {
    render(
      <DexpressStatusSection orderId="o-1" enabled={true} role="agent" />,
    );
    expect(screen.getByText("فى الشركة")).toBeInTheDocument();
    expect(screen.queryByText(/IN_COMPANY/)).not.toBeInTheDocument();
  });

  it("market_manager role shows SLUG (Arabic) prefix", () => {
    render(
      <DexpressStatusSection
        orderId="o-1"
        enabled={true}
        role="market_manager"
      />,
    );
    expect(screen.getByText(/IN_COMPANY/)).toBeInTheDocument();
    expect(screen.getByText(/فى الشركة/)).toBeInTheDocument();
  });

  it("super_admin role shows SLUG (Arabic) prefix", () => {
    render(
      <DexpressStatusSection
        orderId="o-1"
        enabled={true}
        role="super_admin"
      />,
    );
    expect(screen.getByText(/IN_COMPANY/)).toBeInTheDocument();
  });
});

describe("DexpressStatusSection — unknown status ID (slug:null)", () => {
  const unknownSnapshot = {
    kind: "ok" as const,
    trackingNumber: "1343188",
    slug: null,
    statusId: 9999,
    rawLabel: "حالة جديدة",
    isAccepted: true,
  };

  it("agent role: raw label only, no Unrecognized chip", () => {
    mockHook.mockReturnValue({
      snapshot: unknownSnapshot,
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <DexpressStatusSection orderId="o-1" enabled={true} role="agent" />,
    );

    expect(screen.getByText("حالة جديدة")).toBeInTheDocument();
    expect(screen.queryByText(/non reconnu/i)).not.toBeInTheDocument();
  });

  it("market_manager role: raw label + Unrecognized chip", () => {
    mockHook.mockReturnValue({
      snapshot: unknownSnapshot,
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <DexpressStatusSection
        orderId="o-1"
        enabled={true}
        role="market_manager"
      />,
    );

    expect(screen.getByText("حالة جديدة")).toBeInTheDocument();
    expect(screen.getByText(/non reconnu/i)).toBeInTheDocument();
  });
});

describe("DexpressStatusSection — kind:not_found", () => {
  it("shows the not-found message and NO retry button", () => {
    mockHook.mockReturnValue({
      snapshot: { kind: "not_found", trackingNumber: "99999999" },
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <DexpressStatusSection orderId="o-1" enabled={true} role="agent" />,
    );

    expect(
      screen.getByText(/inconnu chez le transporteur/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /réessayer/i }),
    ).not.toBeInTheDocument();
  });
});

describe("DexpressStatusSection — error state", () => {
  it("shows load-error message with a Retry button", async () => {
    const refresh = vi.fn();
    mockHook.mockReturnValue({
      snapshot: null,
      isLoading: false,
      error: new Error("DEXPRESS_FETCH_FAILED"),
      refresh,
    });

    render(
      <DexpressStatusSection orderId="o-1" enabled={true} role="agent" />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Impossible de charger/i,
    );

    const retryBtn = screen.getByRole("button", { name: /réessayer/i });
    await userEvent.click(retryBtn);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

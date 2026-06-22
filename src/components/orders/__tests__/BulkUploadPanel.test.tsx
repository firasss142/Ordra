import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BulkUploadPanel } from "../BulkUploadPanel";

vi.mock("@/hooks/useCarriers", () => ({
  useCarriers: () => ({
    carriers: [
      { id: "c-darb2", name: "Darb Assabil — Compte 2", code: "darb_assabil", is_active: true },
    ],
    error: undefined,
    isLoading: false,
  }),
}));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

function jsonResp(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

/** fetch stub that branches on the request body's dry_run flag. */
function stubFetch(dry: unknown, exec: unknown) {
  const fetchMock = vi.fn((_url: string, opts: { body: string }) => {
    const body = JSON.parse(opts.body);
    return Promise.resolve(jsonResp(body.dry_run ? dry : exec));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const BASE = {
  selectedIds: ["o-1", "o-2", "o-3"],
  marketId: "m-ly",
  onClose: vi.fn(),
  onDone: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("BulkUploadPanel", () => {
  it("pick → dry-run preview shows ready + skipped grouped by reason", async () => {
    stubFetch(
      { dry_run: true, eligible: ["o-1", "o-2"], skipped: [{ order_id: "o-3", reason: "no_destination" }] },
      null,
    );
    render(<BulkUploadPanel {...BASE} />);

    fireEvent.click(screen.getByRole("button", { name: /Compte 2/ }));

    await waitFor(() => expect(screen.getByText(/2 prête/)).toBeInTheDocument());
    expect(screen.getByText(/1 ignorée/)).toBeInTheDocument();
    // skip reason label rendered
    expect(screen.getByText(/Destination à choisir manuellement/)).toBeInTheDocument();
    // upload button reflects the eligible count
    expect(screen.getByRole("button", { name: /Uploader 2/ })).toBeEnabled();
  });

  it("disables the upload button when nothing is eligible", async () => {
    stubFetch(
      { dry_run: true, eligible: [], skipped: [{ order_id: "o-1", reason: "wrong_status" }] },
      null,
    );
    render(<BulkUploadPanel {...BASE} />);
    fireEvent.click(screen.getByRole("button", { name: /Compte 2/ }));
    await waitFor(() => expect(screen.getByText(/0 prête/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Uploader 0/ })).toBeDisabled();
  });

  it("confirm → execute shows succeeded with tracking numbers", async () => {
    const fetchMock = stubFetch(
      { dry_run: true, eligible: ["o-1", "o-2"], skipped: [] },
      {
        dry_run: false,
        succeeded: [{ order_id: "o-1", tracking_number: "SH-1" }],
        failed: [],
        skipped: [],
        needs_confirmation: [],
      },
    );
    render(<BulkUploadPanel {...BASE} />);

    fireEvent.click(screen.getByRole("button", { name: /Compte 2/ }));
    await waitFor(() => screen.getByRole("button", { name: /Uploader 2/ }));
    fireEvent.click(screen.getByRole("button", { name: /Uploader 2/ }));

    await waitFor(() => expect(screen.getByText(/1 réussie/)).toBeInTheDocument());
    expect(screen.getByText(/SH-1/)).toBeInTheDocument();
    // execute call carried the full selection (server is authoritative)
    const execCall = fetchMock.mock.calls.find((c) => !JSON.parse(c[1].body).dry_run)!;
    const execBody = JSON.parse(execCall[1].body);
    expect(execBody).toMatchObject({ carrier_id: "c-darb2", confirm_duplicates: false });
  });

  it("retry failed re-posts execute with only the failed ids", async () => {
    const fetchMock = stubFetch(
      { dry_run: true, eligible: ["o-1", "o-2"], skipped: [] },
      {
        dry_run: false,
        succeeded: [],
        failed: [{ order_id: "o-2", error: "carrier rejected" }],
        skipped: [],
        needs_confirmation: [],
      },
    );
    render(<BulkUploadPanel {...BASE} />);
    fireEvent.click(screen.getByRole("button", { name: /Compte 2/ }));
    await waitFor(() => screen.getByRole("button", { name: /Uploader 2/ }));
    fireEvent.click(screen.getByRole("button", { name: /Uploader 2/ }));
    await waitFor(() => screen.getByRole("button", { name: /Réessayer/ }));

    fireEvent.click(screen.getByRole("button", { name: /Réessayer/ }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
      const retry = calls.filter((b) => !b.dry_run).at(-1);
      expect(retry.order_ids).toEqual(["o-2"]);
    });
  });

  it("needs_confirmation → 'upload anyway' re-posts with confirm_duplicates=true", async () => {
    const fetchMock = stubFetch(
      { dry_run: true, eligible: ["o-1"], skipped: [] },
      {
        dry_run: false,
        succeeded: [],
        failed: [],
        skipped: [],
        needs_confirmation: [{ order_id: "o-1", duplicate_external_id: "EXT-9" }],
      },
    );
    render(<BulkUploadPanel {...BASE} />);
    fireEvent.click(screen.getByRole("button", { name: /Compte 2/ }));
    await waitFor(() => screen.getByRole("button", { name: /Uploader 1/ }));
    fireEvent.click(screen.getByRole("button", { name: /Uploader 1/ }));
    await waitFor(() => screen.getByRole("button", { name: /Uploader quand même/ }));

    fireEvent.click(screen.getByRole("button", { name: /Uploader quand même/ }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
      const anyway = calls.filter((b) => !b.dry_run).at(-1);
      expect(anyway).toMatchObject({ order_ids: ["o-1"], confirm_duplicates: true });
    });
  });
});

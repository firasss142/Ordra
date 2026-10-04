import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

const mockDecode = vi.fn();
vi.mock("@/lib/client/image", () => ({
  decodeImageFile: (...a: unknown[]) => mockDecode(...a),
}));

import { PhotoPicker } from "../PhotoPicker";

const file = new File(["x"], "me.png", { type: "image/png" });
const pick = (f: File) => fireEvent.change(screen.getByTestId("photo-input"), { target: { files: [f] } });

describe("PhotoPicker", () => {
  beforeEach(() => {
    mockDecode.mockReset().mockResolvedValue({ ok: true, dataUrl: "data:image/png;base64,AAA" });
  });

  test("offers to add a photo when there is none, and no remove", () => {
    render(<PhotoPicker hasPhoto={false} onChange={vi.fn()}><span>AB</span></PhotoPicker>);
    expect(screen.getAllByRole("button", { name: "Ajouter une photo" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Retirer" })).toBeNull();
  });

  test("offers to change or remove an existing photo", () => {
    render(<PhotoPicker hasPhoto onChange={vi.fn()}><span>AB</span></PhotoPicker>);
    expect(screen.getAllByRole("button", { name: "Changer la photo" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Retirer" })).toBeInTheDocument();
  });

  test("a picked file is downscaled and handed over as a data URL", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<PhotoPicker hasPhoto={false} onChange={onChange}><span>AB</span></PhotoPicker>);
    pick(file);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("data:image/png;base64,AAA"));
    expect(mockDecode).toHaveBeenCalledWith(file, 512);
  });

  test("remove hands over null", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<PhotoPicker hasPhoto onChange={onChange}><span>AB</span></PhotoPicker>);
    fireEvent.click(screen.getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  test("a file that is not readable is refused on the spot, nothing is sent", async () => {
    mockDecode.mockResolvedValue({ ok: false, error: "too-large" });
    const onChange = vi.fn();
    render(<PhotoPicker hasPhoto={false} onChange={onChange}><span>AB</span></PhotoPicker>);
    pick(file);
    expect(await screen.findByRole("alert")).toHaveTextContent("Image trop volumineuse (max 5 Mo)");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a failed save says so", async () => {
    const onChange = vi.fn().mockRejectedValue(new Error("boom"));
    render(<PhotoPicker hasPhoto={false} onChange={onChange}><span>AB</span></PhotoPicker>);
    pick(file);
    expect(await screen.findByRole("alert")).toHaveTextContent("La photo n'a pas pu être enregistrée");
  });

  test("read-only shows the visual and no controls", () => {
    render(<PhotoPicker hasPhoto onChange={vi.fn()} readOnly><span>AB</span></PhotoPicker>);
    expect(screen.getByText("AB")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("compact: the visual alone is the control — no text links, errors still shown", async () => {
    mockDecode.mockResolvedValue({ ok: false, error: "not-image" });
    render(<PhotoPicker hasPhoto onChange={vi.fn()} compact><span>AB</span></PhotoPicker>);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Changer la photo" })).toBeInTheDocument();
    pick(file);
    expect(await screen.findByRole("alert")).toHaveTextContent("Fichier image requis");
  });
});

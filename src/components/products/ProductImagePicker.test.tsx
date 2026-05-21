import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      return typeof val === "string" ? val : key;
    };
    return resolve;
  },
}));

// decodeImageFile relies on canvas/createImageBitmap which jsdom lacks — mock it.
const mockDecode = vi.fn();
vi.mock("@/lib/client/image", () => ({
  decodeImageFile: (...args: unknown[]) => mockDecode(...args),
}));

import { ProductImagePicker } from "./ProductImagePicker";

beforeEach(() => {
  vi.clearAllMocks();
});

function file(name = "p.png", type = "image/png") {
  return new File(["x"], name, { type });
}

describe("ProductImagePicker", () => {
  it("shows the add label when no image is set", () => {
    render(<ProductImagePicker value={null} onChange={vi.fn()} />);
    expect(screen.getByText("Ajouter une image")).toBeInTheDocument();
  });

  it("shows the change label when an image is already set", () => {
    render(<ProductImagePicker value="https://cdn/x.png" onChange={vi.fn()} />);
    expect(screen.getByText("Changer l'image")).toBeInTheDocument();
  });

  it("emits the decoded data URL when a valid image is picked", async () => {
    mockDecode.mockResolvedValue({ ok: true, dataUrl: "data:image/png;base64,AAA" });
    const onChange = vi.fn();
    render(<ProductImagePicker value={null} onChange={onChange} />);

    const input = screen.getByTestId("product-image-input") as HTMLInputElement;
    await userEvent.upload(input, file());

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("data:image/png;base64,AAA"),
    );
  });

  it("shows an error and does not emit when the file is not an image", async () => {
    mockDecode.mockResolvedValue({ ok: false, error: "not-image" });
    const onChange = vi.fn();
    render(<ProductImagePicker value={null} onChange={onChange} />);

    const input = screen.getByTestId("product-image-input") as HTMLInputElement;
    await userEvent.upload(input, file("bad.txt", "text/plain"), {
      applyAccept: false,
    });

    expect(await screen.findByText("Fichier image requis.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits null when the user removes the image", async () => {
    const onChange = vi.fn();
    render(<ProductImagePicker value="https://cdn/x.png" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Supprimer l'image" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

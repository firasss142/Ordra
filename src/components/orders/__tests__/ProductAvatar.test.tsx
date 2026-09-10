import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ProductAvatar } from "../ProductAvatar";

const OBJ =
  "https://vshynigvgrlihngozuwb.supabase.co/storage/v1/object/public/product-images/mkt/prod/image.png?v=1";

describe("ProductAvatar", () => {
  it("downloads a thumbnail, not the full-resolution upload", () => {
    render(<ProductAvatar imageUrl={OBJ} productName="Livre" size={40} />);
    const img = screen.getByRole("img", { name: "Livre" });
    // Measured on production: the same PNG is 1,101,417 bytes at full size and
    // 2,088 bytes through the render endpoint once the browser asks for WebP.
    expect(img.getAttribute("src")).toContain("/render/image/public/");
    expect(img.getAttribute("src")).toContain("width=40");
  });

  it("asks for twice the pixels on a retina screen", () => {
    render(<ProductAvatar imageUrl={OBJ} productName="Livre" size={40} />);
    const img = screen.getByRole("img", { name: "Livre" });
    expect(img.getAttribute("srcset")).toContain("width=80");
    expect(img.getAttribute("srcset")).toContain("2x");
  });

  it("falls back to the full-size image before giving up on the picture", () => {
    render(<ProductAvatar imageUrl={OBJ} productName="Livre" size={40} />);
    const img = screen.getByRole("img", { name: "Livre" });
    fireEvent.error(img);
    // A resize failure (unsupported format, render quota) must not cost the
    // agent the photo they use to match the parcel to the carton.
    const after = screen.getByRole("img", { name: "Livre" });
    expect(after.getAttribute("src")).toBe(OBJ);
  });

  it("shows the initial only once the original has failed too", () => {
    render(<ProductAvatar imageUrl={OBJ} productName="Livre" size={40} />);
    fireEvent.error(screen.getByRole("img", { name: "Livre" }));
    fireEvent.error(screen.getByRole("img", { name: "Livre" }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("L")).toBeInTheDocument();
  });

  it("recovers when the row is reused for a different product", () => {
    // THE BUG: `errored` was never reset when imageUrl changed. Virtualised and
    // realtime-patched tables reuse a row for a different product, so one broken
    // image turned that slot into initials for every product that followed.
    const { rerender } = render(
      <ProductAvatar imageUrl={OBJ} productName="Livre" size={40} />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Livre" }));
    fireEvent.error(screen.getByRole("img", { name: "Livre" }));
    expect(screen.queryByRole("img")).toBeNull();

    const other = OBJ.replace("prod", "autre");
    rerender(<ProductAvatar imageUrl={other} productName="Cahier" size={40} />);
    expect(screen.getByRole("img", { name: "Cahier" })).toBeInTheDocument();
  });

  it("shows the initial when there is no image at all", () => {
    render(<ProductAvatar imageUrl={null} productName="مصحف" size={40} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("م")).toBeInTheDocument();
  });

  it("does not block the page on decorative images", () => {
    render(<ProductAvatar imageUrl={OBJ} productName="Livre" size={40} />);
    const img = screen.getByRole("img", { name: "Livre" });
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
  });
});

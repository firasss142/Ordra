// @vitest-environment node
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { XDeliveryLabelPdf, XDELIVERY_LABEL_FORMATS, type XDeliveryPrintLabel } from "./XDeliveryLabelPdf";

/** The two formats the owner kept (2026-10-06): A4 two per sheet, thermal 10×15 one each. */

// A 1×1 white PNG: the images' content is irrelevant to the layout under test.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

const label = (i: number): XDeliveryPrintLabel => ({
  orderId: `o-${i}`,
  barcode: `61179121770000${i}`,
  barcodeText: `6117 9121 7700 00${i}`,
  depot: "SH",
  governorate: "Sousse",
  delegation: "Sousse Jaouhara",
  name: "Client A.",
  phone: "22 123 456",
  address: "Rue de la Corniche",
  cod: "89,900 DT",
  open: "NON",
  items: ["1× Pantalon M"],
  qr: `o-${i}`,
  ref: "Commande #1042",
  sender: "Boutique Exemple · 71 000 000",
  date: "06/10/2026 14:20",
  barcodePng: PNG,
  qrPng: PNG,
});

async function pages(format: "a4x2" | "thermal", n: number) {
  const doc = React.createElement(XDeliveryLabelPdf, {
    labels: Array.from({ length: n }, (_, i) => label(i + 1)),
    format,
  }) as unknown as React.ReactElement<DocumentProps>;
  const pdf = (await renderToBuffer(doc)).toString("latin1");
  return {
    count: (pdf.match(/\/Type \/Page\b/g) ?? []).length,
    boxes: [...pdf.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number)),
  };
}

describe("XDeliveryLabelPdf", () => {
  it("offers exactly the two kept formats", () => {
    expect(Object.keys(XDELIVERY_LABEL_FORMATS).sort()).toEqual(["a4x2", "thermal"]);
  });

  it("A4: two labels per sheet, so three labels take two A4 pages", async () => {
    const { count, boxes } = await pages("a4x2", 3);
    expect(count).toBe(2);
    // A4 in points: 595.28 × 841.89.
    expect(Math.round(boxes[0][2])).toBe(595);
    expect(Math.round(boxes[0][3])).toBe(842);
  });

  it("thermal: one 10×15 cm page per label", async () => {
    const { count, boxes } = await pages("thermal", 3);
    expect(count).toBe(3);
    // 100 × 150 mm in points.
    expect(Math.round(boxes[0][2])).toBe(283);
    expect(Math.round(boxes[0][3])).toBe(425);
  }, 20_000);
});

import bwipjs from "bwip-js/node";
import QRCode from "qrcode";
import type { XDeliveryLabelFormat } from "./XDeliveryLabelPdf";

/**
 * Bar height per format, in mm at the PNG's own scale. @react-pdf keeps an image's aspect
 * ratio, so this is what makes the barcode span its box: ~15 mm tall across a 10×15 label,
 * ~25 mm across half an A4.
 */
const BAR_MM: Readonly<Record<XDeliveryLabelFormat, number>> = { thermal: 9, a4x2: 13 };

/**
 * The two codes of an X-Delivery label, as PNG data URLs for @react-pdf.
 *
 * Their Code-128 carries no text (the label prints the number itself, grouped by four)
 * and keeps a quiet zone on each side: the box border sits close to the bars, and a
 * scanner that reads the border as a bar fails the whole parcel at their depot.
 */
export async function xdeliveryLabelImages(
  barcode: string,
  orderId: string,
  format: XDeliveryLabelFormat,
): Promise<{ barcodePng: string; qrPng: string }> {
  // Their scanners read plain ASCII; an accented or blank code would print, then fail at their depot.
  if (!/^[\x21-\x7E]+$/.test(barcode)) throw new Error(`Numéro de colis illisible en Code-128 : « ${barcode} »`);
  const [bars, qrPng] = await Promise.all([
    bwipjs.toBuffer({
      bcid: "code128",
      text: barcode,
      scale: 4,
      height: BAR_MM[format],
      includetext: false,
      paddingwidth: 12,
      paddingheight: 0,
      backgroundcolor: "FFFFFF",
    }),
    QRCode.toDataURL(orderId, { width: 320, margin: 1, errorCorrectionLevel: "M" }),
  ]);
  return { barcodePng: `data:image/png;base64,${Buffer.from(bars).toString("base64")}`, qrPng };
}

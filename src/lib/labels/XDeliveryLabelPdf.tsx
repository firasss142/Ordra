import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, Font } from "@react-pdf/renderer";
import type { XDeliveryLabelData } from "./xdelivery-label";
import { TAJAWAL_BOLD_DATA_URL } from "./fonts/tajawal-bold";

/**
 * The Ordra label of an X-Delivery parcel, as a PDF (prototypes/xdelivery-label-v1.html).
 *
 * Two formats, both kept by the owner (2026-10-06): A4 with two wide labels per sheet for
 * an office printer, and 10×15 cm thermal, one label per page. Same content, two
 * arrangements. Pure black on white throughout: a thermal head prints no grey.
 */

Font.register({ family: "Tajawal", src: TAJAWAL_BOLD_DATA_URL });

export type XDeliveryLabelFormat = "a4x2" | "thermal";

const MM = 72 / 25.4;

export const XDELIVERY_LABEL_FORMATS: Readonly<Record<XDeliveryLabelFormat, { perPage: number; size: "A4" | [number, number] }>> = {
  a4x2: { perPage: 2, size: "A4" },
  thermal: { perPage: 1, size: [100 * MM, 150 * MM] },
};

export interface XDeliveryPrintLabel extends XDeliveryLabelData {
  /** Code-128 of `barcode`, without text: the number is printed under it by us. */
  barcodePng: string;
  qrPng: string;
}

const LINE = "1pt solid #000000";
const ARABIC_NOTICE = "هذه الشركة لا تتحمل مسؤولية التكسير";

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", color: "#000000", backgroundColor: "#FFFFFF" },
  // Portrait (thermal)
  tall: { width: "100%", height: "100%", padding: "4mm", flexDirection: "column" },
  // Wide (half an A4)
  wide: { width: "100%", height: "148.5mm", padding: "5mm 6mm", flexDirection: "row" },
  cutBelow: { borderBottom: "0.5pt dashed #9A9A9A" },
  colL: { flex: 1.2, flexDirection: "column", justifyContent: "space-between", paddingRight: "4mm" },
  colR: { flex: 1, flexDirection: "column" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2mm" },
  xd: { fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  bcBox: { border: LINE, padding: "1.5mm 2mm 1mm", alignItems: "center", marginBottom: "2mm" },
  // Full width, height from the PNG: xdeliveryLabelImages draws it at this format's proportions.
  bcImg: { width: "100%" },
  bcNum: { fontFamily: "Helvetica-Bold", letterSpacing: 1.5, marginTop: "0.5mm" },
  dest: { flexDirection: "row", border: LINE, marginBottom: "2mm" },
  depot: { backgroundColor: "#000000", color: "#FFFFFF", fontFamily: "Helvetica-Bold", textAlign: "center", justifyContent: "center", padding: "1mm 2mm" },
  place: { padding: "1.5mm 2.5mm", justifyContent: "center", flex: 1 },
  gov: { fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  del: { fontFamily: "Helvetica-Bold" },
  k: { fontFamily: "Helvetica-Bold", fontSize: 6.5, letterSpacing: 0.6, textTransform: "uppercase" },
  bold: { fontFamily: "Helvetica-Bold" },
  cod: { flexDirection: "row", border: LINE, marginTop: "2mm", marginBottom: "2mm" },
  codAmt: { flex: 1, padding: "1.2mm 2.5mm", borderRight: LINE },
  codOpen: { padding: "1.2mm 2.5mm", justifyContent: "center", minWidth: "24mm" },
  items: { borderTop: "0.7pt solid #000000", paddingTop: "1.2mm" },
  foot: { flexDirection: "row", marginTop: "auto", borderTop: "0.7pt solid #000000", paddingTop: "1.8mm" },
  ours: { flex: 1, paddingLeft: "2.5mm", justifyContent: "space-between" },
  ar: { fontFamily: "Tajawal", textAlign: "right" },
});

/** Type sizes per format: the wide label has room to be read from further away. */
const SIZE = {
  thermal: { xd: 8.5, date: 7, num: 12, depot: 28, depotW: "19mm", gov: 15, del: 9.5, name: 11, tel: 15, addr: 8.5, money: 17, open: 12, item: 8.2, qr: "19mm", ref: 9, sender: 8, ar: 7 },
  a4x2: { xd: 11, date: 9, num: 16, depot: 45, depotW: "32mm", gov: 22, del: 13, name: 16, tel: 25, addr: 11, money: 25, open: 17, item: 12.5, qr: "30mm", ref: 12, sender: 9.5, ar: 8.5 },
} as const;

type Sz = (typeof SIZE)[XDeliveryLabelFormat];

function Head({ l, z }: { l: XDeliveryPrintLabel; z: Sz }) {
  return (
    <View style={s.head}>
      <Text style={[s.xd, { fontSize: z.xd }]}>X-DELIVERY</Text>
      <Text style={{ fontSize: z.date }}>{l.date}</Text>
    </View>
  );
}

function Barcode({ l, z }: { l: XDeliveryPrintLabel; z: Sz }) {
  return (
    <View style={s.bcBox}>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={l.barcodePng} style={s.bcImg} />
      <Text style={[s.bcNum, { fontSize: z.num }]}>{l.barcodeText}</Text>
    </View>
  );
}

function Destination({ l, z }: { l: XDeliveryPrintLabel; z: Sz }) {
  return (
    <View style={s.dest}>
      {l.depot ? (
        <View style={[s.depot, { minWidth: z.depotW }]}>
          <Text style={{ fontSize: z.depot }}>{l.depot}</Text>
        </View>
      ) : null}
      <View style={s.place}>
        <Text style={[s.gov, { fontSize: z.gov }]}>{l.governorate}</Text>
        {l.delegation ? <Text style={[s.del, { fontSize: z.del }]}>{l.delegation}</Text> : null}
      </View>
    </View>
  );
}

function Recipient({ l, z }: { l: XDeliveryPrintLabel; z: Sz }) {
  return (
    <View>
      <Text style={s.k}>Destinataire</Text>
      <Text style={[s.bold, { fontSize: z.name }]}>{l.name}</Text>
      <Text style={[s.bold, { fontSize: z.tel, letterSpacing: 0.5 }]}>{l.phone}</Text>
      {l.address ? <Text style={{ fontSize: z.addr }}>{l.address}</Text> : null}
    </View>
  );
}

function Cod({ l, z }: { l: XDeliveryPrintLabel; z: Sz }) {
  return (
    <View style={s.cod}>
      <View style={s.codAmt}>
        <Text style={s.k}>À encaisser</Text>
        <Text style={[s.bold, { fontSize: z.money }]}>{l.cod}</Text>
      </View>
      <View style={s.codOpen}>
        <Text style={s.k}>Ouvrir le colis</Text>
        <Text style={[s.bold, { fontSize: z.open }]}>{l.open}</Text>
      </View>
    </View>
  );
}

function Items({ l, z }: { l: XDeliveryPrintLabel; z: Sz }) {
  return (
    <View style={s.items}>
      {l.items.map((item, i) => (
        <Text key={i} style={{ fontSize: z.item }}>
          {item}
        </Text>
      ))}
    </View>
  );
}

function Foot({ l, z }: { l: XDeliveryPrintLabel; z: Sz }) {
  return (
    <View style={s.foot}>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={l.qrPng} style={{ width: z.qr, height: z.qr }} />
      <View style={s.ours}>
        <Text style={[s.bold, { fontSize: z.ref }]}>Ordra · {l.ref}</Text>
        {l.sender ? <Text style={{ fontSize: z.sender }}>Exp. {l.sender}</Text> : null}
        <Text style={[s.ar, { fontSize: z.ar }]}>{ARABIC_NOTICE}</Text>
      </View>
    </View>
  );
}

function TallLabel({ l }: { l: XDeliveryPrintLabel }) {
  const z = SIZE.thermal;
  return (
    <View style={s.tall}>
      <Head l={l} z={z} />
      <Barcode l={l} z={z} />
      <Destination l={l} z={z} />
      <Recipient l={l} z={z} />
      <Cod l={l} z={z} />
      <Items l={l} z={z} />
      <Foot l={l} z={z} />
    </View>
  );
}

function WideLabel({ l, cut }: { l: XDeliveryPrintLabel; cut: boolean }) {
  const z = SIZE.a4x2;
  return (
    <View style={cut ? [s.wide, s.cutBelow] : s.wide} wrap={false}>
      <View style={s.colL}>
        <View>
          <Head l={l} z={z} />
          <Barcode l={l} z={z} />
        </View>
        <Destination l={l} z={z} />
        <Recipient l={l} z={z} />
      </View>
      <View style={s.colR}>
        <Cod l={l} z={z} />
        <Items l={l} z={z} />
        <Foot l={l} z={z} />
      </View>
    </View>
  );
}

export function XDeliveryLabelPdf({ labels, format }: { labels: XDeliveryPrintLabel[]; format: XDeliveryLabelFormat }) {
  const { perPage, size } = XDELIVERY_LABEL_FORMATS[format];
  const pages: XDeliveryPrintLabel[][] = [];
  for (let i = 0; i < labels.length; i += perPage) pages.push(labels.slice(i, i + perPage));

  return (
    <Document title="Étiquettes X-Delivery" author="Ordra">
      {pages.map((chunk, i) => (
        <Page key={i} size={size} style={s.page}>
          {format === "thermal"
            ? chunk.map((l) => <TallLabel key={l.orderId} l={l} />)
            : chunk.map((l, j) => <WideLabel key={l.orderId} l={l} cut={j === 0} />)}
        </Page>
      ))}
    </Document>
  );
}

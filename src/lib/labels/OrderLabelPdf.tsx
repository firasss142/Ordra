import React from "react";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";

export interface OrderLabelLineItem {
  designation: string;
  quantity: number;
  amount: string;
}

export interface OrderLabelData {
  orderId: string;
  shortId: string;
  blNumber: string;
  blDateLabel: string;
  destinationCity: string;
  senderName: string;
  senderAddress: string;
  senderPhone: string;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
  items: OrderLabelLineItem[];
  instructions: string;
  openPackage: "Oui" | "Non";
  qrDataUrl: string;
  barcodeDataUrl: string;
}

const BORDER = "1pt solid #1A1A1A";

const styles = StyleSheet.create({
  page: {
    padding: "8mm",
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1A1A1A",
    backgroundColor: "#FFFFFF",
  },
  label: {
    width: "100%",
    height: "138mm",
    marginBottom: "4mm",
    paddingBottom: "2mm",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: "2mm",
  },
  topBarText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  cityHeader: {
    textAlign: "center",
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    paddingBottom: "2mm",
  },
  barcodeWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: "3mm",
  },
  barcodeImg: {
    width: "80%",
    height: "14mm",
    objectFit: "contain",
  },
  senderBox: {
    border: BORDER,
    padding: "3mm",
    marginBottom: 0,
  },
  senderLine: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: "1mm",
  },
  bandRow: {
    border: BORDER,
    borderTopWidth: 0,
    padding: "2mm 3mm",
    alignItems: "center",
  },
  bandText: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },
  recipientRow: {
    flexDirection: "row",
    border: BORDER,
    borderTopWidth: 0,
  },
  recipientLeft: {
    width: "35%",
    padding: "3mm",
    borderRight: BORDER,
    justifyContent: "space-between",
  },
  recipientRight: {
    width: "65%",
    padding: "3mm",
    justifyContent: "space-between",
  },
  recipientLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginBottom: "1mm",
  },
  recipientValue: {
    fontSize: 10,
    marginBottom: "2mm",
  },
  phoneBig: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    marginTop: "1mm",
  },
  itemsTable: {
    borderLeft: BORDER,
    borderRight: BORDER,
    borderBottom: BORDER,
  },
  itemsHeader: {
    flexDirection: "row",
    backgroundColor: "#F2F2F2",
    borderBottom: BORDER,
  },
  itemsHeaderCell: {
    padding: "2mm",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },
  itemsRow: {
    flexDirection: "row",
    borderBottom: "0.5pt solid #C9CCCF",
  },
  itemsRowLast: {
    flexDirection: "row",
  },
  itemsCell: {
    padding: "2mm",
    fontSize: 9,
  },
  colDesc: { width: "70%" },
  colQty: { width: "15%", textAlign: "center" },
  colAmount: { width: "15%", textAlign: "right" },
  openRow: {
    borderLeft: BORDER,
    borderRight: BORDER,
    borderBottom: BORDER,
    padding: "2mm 3mm",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  instructionsRow: {
    flexDirection: "row",
    borderLeft: BORDER,
    borderRight: BORDER,
    borderBottom: BORDER,
    minHeight: "18mm",
  },
  instructionsBody: {
    flex: 1,
    padding: "3mm",
    fontSize: 9,
  },
  instructionsQr: {
    width: "28mm",
    padding: "2mm",
    borderLeft: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  qrImg: {
    width: "22mm",
    height: "22mm",
  },
  instructionsLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginBottom: "1mm",
  },
});

function Label({ data }: { data: OrderLabelData }) {
  return (
    <View style={styles.label} wrap={false}>
      <View style={styles.topBar}>
        <Text style={styles.topBarText}>Date : {data.blDateLabel}</Text>
        <Text style={styles.topBarText}>{data.destinationCity}</Text>
      </View>

      <Text style={styles.cityHeader}>{data.destinationCity}</Text>

      <View style={styles.barcodeWrap}>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={data.barcodeDataUrl} style={styles.barcodeImg} />
      </View>

      <View style={styles.senderBox}>
        <Text style={styles.senderLine}>Nom de l&apos;expéditeur : {data.senderName}</Text>
        <Text style={styles.senderLine}>Adresse : {data.senderAddress || "—"}</Text>
        <Text style={[styles.senderLine, { marginBottom: 0 }]}>
          Téléphone : {data.senderPhone || "—"}
        </Text>
      </View>

      <View style={styles.bandRow}>
        <Text style={styles.bandText}>BON DE LIVRAISON N° {data.blNumber}</Text>
      </View>

      <View style={styles.bandRow}>
        <Text style={styles.bandText}>&gt;&gt;---dispatch---&gt;&gt; {data.destinationCity}</Text>
      </View>

      <View style={styles.recipientRow}>
        <View style={styles.recipientLeft}>
          <View>
            <Text style={styles.recipientLabel}>Date BLF :</Text>
            <Text style={styles.recipientValue}>{data.blDateLabel}</Text>
          </View>
          <View>
            <Text style={styles.recipientLabel}>Destination :</Text>
            <Text style={styles.recipientValue}>{data.destinationCity}</Text>
          </View>
        </View>
        <View style={styles.recipientRight}>
          <View>
            <Text style={styles.recipientLabel}>NOM DE DESTINATAIRE :</Text>
            <Text style={styles.recipientValue}>{data.customerName}</Text>
          </View>
          <View>
            <Text style={styles.recipientLabel}>ADRESSE :</Text>
            <Text style={styles.recipientValue}>
              {[data.customerCity, data.customerAddress].filter(Boolean).join(" ") || "—"}
            </Text>
          </View>
          <View>
            <Text style={styles.recipientLabel}>Téléphone :</Text>
            <Text style={styles.phoneBig}>{data.customerPhone}</Text>
          </View>
        </View>
      </View>

      <View style={styles.itemsTable}>
        <View style={styles.itemsHeader}>
          <Text style={[styles.itemsHeaderCell, styles.colDesc, { textAlign: "left" }]}>
            Désignation-Contenu du colis
          </Text>
          <Text style={[styles.itemsHeaderCell, styles.colQty]}>Quantité</Text>
          <Text style={[styles.itemsHeaderCell, styles.colAmount]}>Montant TTC</Text>
        </View>
        {data.items.map((item, idx) => {
          const isLast = idx === data.items.length - 1;
          return (
            <View key={idx} style={isLast ? styles.itemsRowLast : styles.itemsRow}>
              <Text style={[styles.itemsCell, styles.colDesc]}>{item.designation}</Text>
              <Text style={[styles.itemsCell, styles.colQty]}>{item.quantity}</Text>
              <Text style={[styles.itemsCell, styles.colAmount]}>{item.amount}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.openRow}>
        <Text>Ouvrir le colis : {data.openPackage}</Text>
      </View>

      <View style={styles.instructionsRow}>
        <View style={styles.instructionsBody}>
          <Text style={styles.instructionsLabel}>Instructions diverses :</Text>
          <Text>{data.instructions || " "}</Text>
        </View>
        <View style={styles.instructionsQr}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={data.qrDataUrl} style={styles.qrImg} />
        </View>
      </View>
    </View>
  );
}

export function OrderLabelPdf({ labels }: { labels: OrderLabelData[] }) {
  // 2 labels per A4 page (portrait). Each label ~138mm tall.
  const chunks: OrderLabelData[][] = [];
  for (let i = 0; i < labels.length; i += 2) {
    chunks.push(labels.slice(i, i + 2));
  }
  if (chunks.length === 0) chunks.push([]);

  return (
    <Document>
      {chunks.map((chunk, idx) => (
        <Page key={idx} size="A4" style={styles.page}>
          {chunk.map((label) => (
            <Label key={label.orderId} data={label} />
          ))}
        </Page>
      ))}
    </Document>
  );
}

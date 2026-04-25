import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export interface PicklistLine {
  shortId: string;
  customerName: string;
  customerCity: string;
  productLabel: string;
  quantity: number;
}

export interface PicklistGroup {
  heading: string;
  count: number;
  totalQuantity: number;
  lines: PicklistLine[];
}

export interface PicklistPdfProps {
  title: string;
  subtitle: string;
  generatedAtLabel: string;
  groupingLabel: string;
  groups: PicklistGroup[];
}

const styles = StyleSheet.create({
  page: {
    padding: "12mm",
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1A1A1A",
    backgroundColor: "#FFFFFF",
  },
  header: {
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1A1A1A",
    paddingBottom: 6,
  },
  title: { fontSize: 14, fontWeight: 700 },
  subtitle: { fontSize: 9, color: "#6D7175", marginTop: 2 },
  group: { marginTop: 14 },
  groupHeading: {
    fontSize: 11,
    fontWeight: 700,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#E1E3E5",
    marginBottom: 4,
  },
  groupMeta: { fontSize: 9, color: "#6D7175", marginBottom: 4 },
  row: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E1E3E5",
  },
  colId: { width: "15%", fontFamily: "Courier" },
  colCustomer: { width: "25%" },
  colCity: { width: "20%" },
  colProduct: { width: "30%" },
  colQty: { width: "10%", textAlign: "right" },
  checkbox: {
    width: 10,
    height: 10,
    borderWidth: 1,
    borderColor: "#1A1A1A",
    marginRight: 6,
  },
  lineWrap: { flexDirection: "row", alignItems: "center" },
});

export function PicklistPdf({
  title,
  subtitle,
  generatedAtLabel,
  groupingLabel,
  groups,
}: PicklistPdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {subtitle} · {groupingLabel} · {generatedAtLabel}
          </Text>
        </View>
        {groups.map((g) => (
          <View key={g.heading} style={styles.group} wrap={false}>
            <Text style={styles.groupHeading}>{g.heading}</Text>
            <Text style={styles.groupMeta}>
              {g.count} orders · {g.totalQuantity} units
            </Text>
            {g.lines.map((l, idx) => (
              <View key={`${g.heading}-${idx}`} style={styles.row}>
                <View style={[styles.colId, styles.lineWrap]}>
                  <View style={styles.checkbox} />
                  <Text>{l.shortId}</Text>
                </View>
                <Text style={styles.colCustomer}>{l.customerName}</Text>
                <Text style={styles.colCity}>{l.customerCity}</Text>
                <Text style={styles.colProduct}>{l.productLabel}</Text>
                <Text style={styles.colQty}>×{l.quantity}</Text>
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

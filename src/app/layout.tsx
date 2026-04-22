import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ordra",
  description: "Manage your orders efficiently",
};

export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params?: { locale?: string };
}) {
  const locale = params?.locale ?? "fr";
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <body>{children}</body>
    </html>
  );
}

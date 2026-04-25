import type { Metadata } from "next";
import { Inter, Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  adjustFontFallback: true,
});

const notoArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  display: "swap",
  variable: "--font-sans-arabic",
  weight: ["400", "500", "600"],
});

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
    <html lang={locale} dir={dir} className={`${inter.variable} ${notoArabic.variable}`}>
      <body>{children}</body>
    </html>
  );
}

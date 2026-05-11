import type { Metadata } from "next";
import { Inter, Noto_Sans_Arabic, Cairo } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, unstable_setRequestLocale as setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import "../globals.css";

import { AuthProvider } from "@/context/auth";
import { MarketScopeProvider } from "@/context/market-scope";
import { PresenceTracker } from "@/components/layout/PresenceTracker";
import { SWRProvider } from "@/components/providers/SWRProvider";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { routing } from "@/i18n/routing";
import { getDirectionForLocale } from "@/lib/locale-routing";

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

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  display: "swap",
  variable: "--font-cairo",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Ordra",
  description: "Manage your orders efficiently",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const { locale } = params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  setRequestLocale(locale as (typeof routing.locales)[number]);

  const dir = getDirectionForLocale(locale as "fr" | "ar");
  const skipLinkLabel =
    locale === "ar" ? "تخطي إلى المحتوى الرئيسي" : "Aller au contenu principal";

  const [messages, initialUser] = await Promise.all([
    getMessages({ locale }),
    getServerUser(),
  ]);

  const initialScope = initialUser
    ? (await getActiveMarketScope(initialUser)).scope
    : "tn";

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${inter.variable} ${notoArabic.variable} ${cairo.variable}`}
    >
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <SWRProvider>
            <AuthProvider initialUser={initialUser}>
              <MarketScopeProvider initialScope={initialScope}>
                <a href="#main-content" className="skip-link">
                  {skipLinkLabel}
                </a>
                <PresenceTracker />
                {children}
              </MarketScopeProvider>
            </AuthProvider>
          </SWRProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

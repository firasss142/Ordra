import { AuthProvider } from "@/context/auth";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { PresenceTracker } from "@/components/layout/PresenceTracker";
import { SWRProvider } from "@/components/providers/SWRProvider";
import { getServerUser } from "@/lib/auth/server-user";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const { locale } = params;
  const [messages, initialUser] = await Promise.all([
    getMessages(),
    getServerUser(),
  ]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <SWRProvider>
        <AuthProvider initialUser={initialUser}>
          <a href="#main-content" className="skip-link">
            Aller au contenu principal
          </a>
          <PresenceTracker />
          {children}
        </AuthProvider>
      </SWRProvider>
    </NextIntlClientProvider>
  );
}

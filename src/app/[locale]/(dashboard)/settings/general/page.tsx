import { redirect } from "next/navigation";

/**
 * Legacy route — Paramètres became Réglages. /system/settings maps a
 * deep-linked ?tab= onto its topic.
 */
export default function GeneralSettingsPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { tab?: string };
}) {
  const tab = searchParams?.tab ? `?tab=${encodeURIComponent(searchParams.tab)}` : "";
  redirect(`/${params.locale}/system/settings${tab}`);
}

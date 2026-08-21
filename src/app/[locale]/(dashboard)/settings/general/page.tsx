import { redirect } from "next/navigation";

/**
 * Legacy route — the settings workspace moved to /system/settings in the
 * Système redesign. Redirect, preserving a deep-linked tab.
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

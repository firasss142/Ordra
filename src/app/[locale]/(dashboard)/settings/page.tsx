import { redirect } from "next/navigation";

export default function SettingsPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { section?: string };
}) {
  const section = searchParams.section ?? "general";

  if (section === "markets") {
    redirect(`/${params.locale}/markets`);
  }

  const allowed = new Set(["general", "carriers", "storefronts", "statuses"]);
  const target = allowed.has(section) ? section : "general";
  redirect(`/${params.locale}/settings/${target}`);
}

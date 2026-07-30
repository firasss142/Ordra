import { redirect } from "next/navigation";

// Legacy URL — ad-spend is a finance surface, not a settings page.
export default async function LegacyAdSpendPage({
  params,
}: {
  params: { locale: string };
}) {
  redirect(`/${params.locale}/finance/ad-spend`);
}

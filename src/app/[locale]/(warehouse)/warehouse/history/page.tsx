import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Le journal est la preuve derrière les chiffres du stock : il est un onglet
 * de Stock, pas une entrée de navigation à lui seul.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/warehouse/stock`);
}

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * La préparation EST le banc : elle est le premier onglet de /warehouse.
 * Garder l'URL évite de casser les liens et les favoris des managers.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/warehouse`);
}

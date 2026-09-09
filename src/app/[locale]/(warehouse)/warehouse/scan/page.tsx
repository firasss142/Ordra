import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Le mode scan était un troisième rendu de la même file et du même scanner,
 * atteignable par un seul bouton. La station de scan vit dans le banc.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/warehouse`);
}

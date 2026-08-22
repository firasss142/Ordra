import { redirect } from "next/navigation";

/**
 * Correspondances is now a tab inside Système › Connexions — the standalone
 * page was folded in during the Système redesign. The editor UI lives on in
 * `MappingsPageClient`, reused by the Connexions workspace; this route just
 * forwards old bookmarks. Auth is enforced by the destination page.
 */
export default function MappingsRedirect({
  params,
}: {
  params: { locale: string };
}) {
  redirect(`/${params.locale}/system/connections?tab=mappings`);
}

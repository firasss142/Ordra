import { redirect } from "next/navigation";

/** Legacy route — product and city matching lives in Réglages › Boutiques. */
export default function MappingsRedirect({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/system/settings/shops`);
}

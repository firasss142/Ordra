import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProductsPageClient } from "./ProductsPageClient";

export default async function ProductsPage({
  params,
}: {
  params: { locale: string };
}) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect(`/${params.locale}/login`);

  const { data: profile } = await supabase
    .from("users")
    .select("role, market_id")
    .eq("id", authUser.id)
    .single();

  if (!profile) redirect(`/${params.locale}/login`);

  // The h1 and subtitle moved into the client component so they can sit on the
  // same row as the header actions, matching /orders. This shell now only does
  // auth + role resolution; the hardcoded #F6F6F7 / #1A1A1A hexes and the
  // 24px/700 title (the design system calls for 20–22/600) are gone with it.
  return (
    <div className="min-h-screen bg-surface-page px-6 pb-16 pt-6 md:px-8">
      <ProductsPageClient
        role={profile.role}
        marketId={profile.market_id ?? ""}
        locale={params.locale}
      />
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MappingsPageClient } from "./MappingsPageClient";

export default async function MappingsPage({
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

  // Mappings are a super_admin / market_manager surface only.
  if (profile.role !== "super_admin" && profile.role !== "market_manager") {
    redirect(`/${params.locale}/dashboard`);
  }

  const t = await getTranslations({ locale: params.locale, namespace: "mappings" });

  return (
    <div style={{ padding: 24, backgroundColor: "#F6F6F7", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1A1A1A", margin: "0 0 4px 0" }}>
        {t("title")}
      </h1>
      <p style={{ fontSize: 14, color: "#6D7175", margin: "0 0 24px 0" }}>
        {t("subtitle")}
      </p>
      <MappingsPageClient
        role={profile.role}
        marketId={profile.market_id ?? ""}
        locale={params.locale}
      />
    </div>
  );
}

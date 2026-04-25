import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProductCreateForm } from "@/components/products/ProductCreateForm";

interface Market {
  id: string;
  name: string;
}

export default async function NewProductPage({
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

  if (profile.role !== "super_admin") {
    redirect(`/${params.locale}/products`);
  }

  const { data: marketsData } = await supabase
    .from("markets")
    .select("id, name")
    .order("name", { ascending: true });

  const markets: Market[] = (marketsData ?? []) as Market[];
  const defaultMarketId = markets[0]?.id ?? "";

  return (
    <div style={{ padding: 24, backgroundColor: "#F6F6F7", minHeight: "100vh" }}>
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "0.5rem",
          border: "1px solid #E1E3E5",
          padding: 32,
          maxWidth: 640,
        }}
      >
        <ProductCreateForm
          role={profile.role}
          markets={markets}
          defaultMarketId={defaultMarketId}
          locale={params.locale}
        />
      </div>
    </div>
  );
}

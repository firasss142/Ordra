import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getServerUser } from "@/lib/auth/server-user";
import { createClient } from "@/lib/supabase/server";
import { OrderTimelineDetail } from "./OrderTimelineDetail";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent") redirect(`/${params.locale}/queue`);
  if (user.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, market_id, customer_name, external_id")
    .eq("id", params.id)
    .single();

  if (!order) notFound();
  if (user.role === "market_manager" && order.market_id !== user.market_id) {
    redirect(`/${params.locale}/in-delivery`);
  }

  const t = await getTranslations({ locale: params.locale, namespace: "inDelivery.detail" });

  return (
    <div
      style={{ backgroundColor: "#F6F6F7", minHeight: "100vh", padding: "32px 32px 64px" }}
    >
      <div style={{ marginBlockEnd: 16 }}>
        <Link
          href={`/${params.locale}/in-delivery`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "#6D7175",
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          <ChevronLeft size={14} aria-hidden="true" />
          {t("back")}
        </Link>
      </div>

      <header style={{ marginBlockEnd: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {order.customer_name || t("anonymous")}
        </h1>
        {order.external_id && (
          <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
            #{order.external_id}
          </p>
        )}
      </header>

      <OrderTimelineDetail orderId={params.id} />
    </div>
  );
}

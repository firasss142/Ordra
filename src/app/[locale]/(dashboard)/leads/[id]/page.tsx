"use client";

import { useAuth } from "@/context/auth";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import Link from "next/link";
import { LeadDetailCard } from "@/components/crm/LeadDetailCard";

export default function LeadDetailPage() {
  const { user } = useAuth();
  const params = useParams<{ locale: string; id: string }>();
  const t = useTranslations("crm.leads");

  if (!user) return null;
  const id = params?.id as string;
  const locale = (params?.locale as string) ?? user.locale;

  return (
    <div style={{ padding: 24, backgroundColor: "#F6F6F7", minHeight: "100vh" }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/${locale}/leads`}
          style={{ color: "#6B7280", fontSize: 13, textDecoration: "none" }}
        >
          ← {t("title")}
        </Link>
      </div>
      <LeadDetailCard
        leadId={id}
        role={user.role}
        locale={locale}
        actorId={user.id}
      />
    </div>
  );
}

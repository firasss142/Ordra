import { getTranslations } from "next-intl/server";
import { TeamTable } from "@/components/team/TeamTable";

export default async function TeamPage() {
  const t = await getTranslations("nav.items");
  return (
    <div style={{ backgroundColor: "#F6F6F7", minHeight: "100vh", padding: "32px 32px 64px" }}>
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "#1A1A1A",
          margin: "0 0 24px 0",
        }}
      >
        {t("performanceLive")}
      </h1>
      <div style={{ backgroundColor: "white", border: "1px solid #E1E3E5", borderRadius: "0.5rem" }}>
        <TeamTable />
      </div>
    </div>
  );
}

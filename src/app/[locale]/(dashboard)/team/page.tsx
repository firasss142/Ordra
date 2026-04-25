import { getTranslations } from "next-intl/server";
import { getServerUser } from "@/lib/auth/server-user";
import { TeamWorkspace } from "@/components/team/TeamWorkspace";

export default async function TeamPage() {
  const t = await getTranslations("teamPerf");
  const user = await getServerUser();

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
        {t("title")}
      </h1>
      {user && (
        <TeamWorkspace role={user.role} marketId={user.market_id ?? null} />
      )}
    </div>
  );
}

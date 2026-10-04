import { canManageCarriers } from "@/lib/settings-permissions";
import { makeLogoPUT } from "@/lib/logos-route";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const handlePUT = makeLogoPUT({ owner: "carrier", table: "carriers", canManage: canManageCarriers });

export const PUT = withRouteErrors("/api/carriers/[id]/logo", "PUT", handlePUT);

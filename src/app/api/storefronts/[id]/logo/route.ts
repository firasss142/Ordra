import { canManageStorefronts } from "@/lib/settings-permissions";
import { makeLogoPUT } from "@/lib/logos-route";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const handlePUT = makeLogoPUT({ owner: "storefront", table: "storefronts", canManage: canManageStorefronts });

export const PUT = withRouteErrors("/api/storefronts/[id]/logo", "PUT", handlePUT);

import { RouteSkeleton } from "@/components/layout/RouteSkeleton";

export default function LogsLoading() {
  return <RouteSkeleton tiles={4} rows={6} ground="plain" />;
}

import { RouteSkeleton } from "@/components/layout/RouteSkeleton";

export default function ProductNewLoading() {
  return <RouteSkeleton tiles={0} toolbar={false} body="cards" cards={2} />;
}

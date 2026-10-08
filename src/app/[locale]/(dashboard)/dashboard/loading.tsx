import { RouteSkeleton } from "@/components/layout/RouteSkeleton";

export default function HomeLoading() {
  return <RouteSkeleton tiles={3} toolbar={false} body="cards" cards={3} />;
}

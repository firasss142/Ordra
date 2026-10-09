import { RouteSkeleton } from "@/components/layout/RouteSkeleton";

export default function TeamLoading() {
  return <RouteSkeleton body="cards" cards={6} />;
}

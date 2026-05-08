import statesData from "./states-data.json";

export interface DexpressState {
  id: number;
  name: string;
  routeId: number;
}

export const DEXPRESS_STATES: DexpressState[] = statesData;

const BY_ID = new Map<number, DexpressState>(
  DEXPRESS_STATES.map((s) => [s.id, s])
);

export function resolveDestination(stateId: number): {
  to_state: number;
  route_id: number;
} {
  const state = BY_ID.get(stateId);
  if (!state) {
    throw new Error(`Unknown Dexpress state_id: ${stateId}`);
  }
  return { to_state: state.id, route_id: state.routeId };
}

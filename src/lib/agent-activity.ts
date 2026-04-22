export interface AgentActivityState {
  label: string;
  color: string;
}

export function getAgentActivityState(isActive: boolean, isActiveToday: boolean): AgentActivityState {
  if (!isActive) {
    return { label: "Désactivé", color: "#9CA3AF" };
  }
  if (isActiveToday) {
    return { label: "Actif", color: "#10B981" };
  }
  return { label: "Inactif", color: "#9CA3AF" };
}

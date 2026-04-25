interface Agent {
  agent_id: string;
  confirmation_rate: number;
}

export function computePercentileRanks(agents: Agent[]): Record<string, number> {
  if (agents.length === 0) return {};
  if (agents.length === 1) return { [agents[0].agent_id]: 100 };

  const n = agents.length;
  const result: Record<string, number> = {};

  for (const agent of agents) {
    const below = agents.filter((a) => a.confirmation_rate < agent.confirmation_rate).length;
    result[agent.agent_id] = Math.round((below / (n - 1)) * 100);
  }

  return result;
}

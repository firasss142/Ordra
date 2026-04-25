export type CoachingPrompt = "schedule_1on1" | "review_rejections" | null;

interface CurrAgent {
  agent_id: string;
  confirmation_rate: number;
  rejected: number;
  actioned: number;
}

interface PrevAgent {
  agent_id: string;
  confirmation_rate: number;
}

export function computeCoachingPrompts(
  curr: CurrAgent[],
  prev: PrevAgent[]
): Record<string, CoachingPrompt> {
  const prevMap = new Map(prev.map((p) => [p.agent_id, p.confirmation_rate]));
  const result: Record<string, CoachingPrompt> = {};

  for (const agent of curr) {
    if (agent.actioned === 0) {
      result[agent.agent_id] = null;
      continue;
    }

    const prevRate = prevMap.get(agent.agent_id);
    if (prevRate !== undefined && prevRate - agent.confirmation_rate > 10) {
      result[agent.agent_id] = "schedule_1on1";
      continue;
    }

    if (agent.actioned >= 3 && agent.rejected / agent.actioned > 0.5) {
      result[agent.agent_id] = "review_rejections";
      continue;
    }

    result[agent.agent_id] = null;
  }

  return result;
}

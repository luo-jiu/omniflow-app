import type { AgentRunSnapshot } from './agent.types';

export function buildAgentRunContinuationGroups(runs: AgentRunSnapshot[]) {
  const byId = new Map(runs.map(run => [run.id, run]));
  const rootById = new Map<string, string>();
  const groups = new Map<string, AgentRunSnapshot[]>();
  for (const run of runs) {
    let root = run;
    const visited = new Set<string>();
    while (root.resumesRunId && !visited.has(root.id)) {
      visited.add(root.id);
      const parent = byId.get(root.resumesRunId);
      if (!parent || parent.sessionId !== run.sessionId || parent.status !== 'cancelled') break;
      root = parent;
      const knownRoot = rootById.get(parent.id);
      if (knownRoot && byId.has(knownRoot)) { root = byId.get(knownRoot)!; break; }
    }
    rootById.set(run.id, root.id);
    const group = groups.get(root.id) || [];
    group.push(run);
    groups.set(root.id, group);
  }
  return { groups, rootById };
}

export function getResumableAgentRun(runs: AgentRunSnapshot[]): AgentRunSnapshot | undefined {
  const latest = runs.at(-1);
  return latest?.status === 'cancelled' ? latest : undefined;
}

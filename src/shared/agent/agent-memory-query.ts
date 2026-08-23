export const MAX_AGENT_MEMORY_QUERY_CHARACTERS = 120;

export function normalizeAgentMemoryQuery(value: unknown): string {
  return String(value || '').trim().slice(0, MAX_AGENT_MEMORY_QUERY_CHARACTERS);
}

function foldSQLiteLikeAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, character => character.toLowerCase());
}

export function agentMemoryFieldMatchesQuery(
  field: string,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  return foldSQLiteLikeAsciiCase(field).includes(
    foldSQLiteLikeAsciiCase(normalizedQuery),
  );
}

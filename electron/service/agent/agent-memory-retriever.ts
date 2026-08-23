import type {
  AgentMemoryItem,
  AgentOwnerScope,
} from '@/shared/agent/agent.types';
import type { AgentMemoryStore } from './agent-memory-store';

const MAX_RECALLED_MEMORIES = 5;
const MAX_RECALLED_CHARACTERS = 6_000;
const MAX_QUERY_TERMS = 20;
const SKIP_MEMORY_RECALL_PATTERNS = [
  /(?:忽略|不要使用|不使用|别用|不要参考|暂时不看).{0,12}(?:长期)?记忆/u,
  /(?:ignore|do\s+not\s+use|don't\s+use|without).{0,20}(?:long[- ]term\s+)?memor(?:y|ies)/iu,
];

export interface AgentMemoryRetrievalInput {
  libraryId: number;
  ownerScope: AgentOwnerScope;
  query: string;
}

export interface AgentMemoryRetriever {
  retrieve: (input: AgentMemoryRetrievalInput) => Promise<AgentMemoryItem[]>;
}

interface ScoredMemory {
  item: AgentMemoryItem;
  score: number;
}

function memoryCharacters(item: AgentMemoryItem): number {
  return item.title.length
    + item.content.length
    + item.reason.length
    + item.application.length;
}

function queryTerms(query: string): string[] {
  const normalized = String(query || '').normalize('NFKC').toLocaleLowerCase();
  const latin = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) || [];
  const hanCharacters = normalized.match(/\p{Script=Han}/gu) || [];
  const hanBigrams = hanCharacters.slice(0, -1).map((value, index) => (
    `${value}${hanCharacters[index + 1]}`
  ));
  return Array.from(new Set([
    ...latin.filter(value => value.length >= 2),
    ...hanBigrams,
  ])).slice(0, MAX_QUERY_TERMS);
}

function fieldMatches(field: string, term: string): boolean {
  return field.normalize('NFKC').toLocaleLowerCase().includes(term);
}

function scoreMemory(item: AgentMemoryItem, terms: string[]): number {
  let score = item.kind === 'preference'
    ? item.scope === 'global' ? 8 : 6
    : 0;
  terms.forEach((term) => {
    if (fieldMatches(item.title, term)) score += 8;
    if (fieldMatches(item.content, term)) score += 4;
    if (fieldMatches(item.application, term)) score += 3;
    if (fieldMatches(item.reason, term)) score += 2;
  });
  return score;
}

function compareScoredMemories(left: ScoredMemory, right: ScoredMemory): number {
  if (left.score !== right.score) return right.score - left.score;
  const updatedOrder = right.item.updatedAt.localeCompare(left.item.updatedAt);
  if (updatedOrder !== 0) return updatedOrder;
  return left.item.id.localeCompare(right.item.id);
}

function memoryIdentity(item: AgentMemoryItem): string {
  return [item.kind, item.scope, item.title, item.content, item.application]
    .map(value => value.normalize('NFKC').trim().toLocaleLowerCase())
    .join('\u0000');
}

export function shouldSkipAgentMemoryRecall(query: string): boolean {
  const normalized = String(query || '').normalize('NFKC');
  return SKIP_MEMORY_RECALL_PATTERNS.some(pattern => pattern.test(normalized));
}

export function rankAgentMemoryCandidates(
  candidates: AgentMemoryItem[],
  query: string,
): AgentMemoryItem[] {
  const terms = queryTerms(query);
  const ranked = candidates
    .map(item => ({ item, score: scoreMemory(item, terms) }))
    .filter(candidate => candidate.score > 0)
    .sort(compareScoredMemories);
  const identities = new Set<string>();
  const selected: AgentMemoryItem[] = [];
  let characters = 0;
  for (const candidate of ranked) {
    const identity = memoryIdentity(candidate.item);
    if (identities.has(identity)) continue;
    const nextCharacters = characters + memoryCharacters(candidate.item);
    if (selected.length > 0 && nextCharacters > MAX_RECALLED_CHARACTERS) continue;
    selected.push(candidate.item);
    identities.add(identity);
    characters = nextCharacters;
    if (selected.length >= MAX_RECALLED_MEMORIES) break;
  }
  return selected;
}

export function createStructuredAgentMemoryRetriever(
  store: Pick<AgentMemoryStore, 'listCandidates'>,
): AgentMemoryRetriever {
  return {
    async retrieve(input) {
      if (shouldSkipAgentMemoryRecall(input.query)) return [];
      const candidates = await store.listCandidates(input.ownerScope, input.libraryId);
      return rankAgentMemoryCandidates(candidates, input.query);
    },
  };
}

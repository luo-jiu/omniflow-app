import type { AgentToolResult } from '../../../../src/shared/agent/agent.types';
import type { AgentProviderToolResultProjection } from '../agent-tool-result-projection';
import { estimateAgentTextTokens } from '../agent-token-estimator';

/** Covers the bounded native AX summary, 128 controls, or 64 window labels. */
export const AGENT_COMPUTER_PROVIDER_RESULT_TOKENS = 40_000;
export type AgentComputerProviderProjectionMode = 'computer-observe' | 'computer-windows';

const OBSERVATION_FIELDS = ['captureScope', 'targetId', 'applicationLabel', 'windowLabel', 'imageId',
  'observationId', 'screenshotWidth', 'screenshotHeight', 'capturedAt', 'expiresInMs', 'clickReady',
  'textReady', 'scrollReady', 'operations', 'coordinateClickReady', 'candidateScanComplete', 'clickMethod', 'observationSource', 'mode',
  'elementsScope', 'searchScope', 'totalMatched', 'offset', 'limit', 'hasMore', 'changeSummary', 'notice'] as const;

function invalidScope(): Error { return new Error('应用窗口观察范围无效'); }
function ownValue(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw invalidScope();
  return descriptor.value;
}

/** Validate the new public scope before either the full or budgeted Provider path. */
export function normalizeAgentComputerObservationScopeForProvider(result: AgentToolResult): AgentToolResult {
  if (result.ok !== true || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return result;
  const data = result.data as Record<string, unknown>;
  const hasScope = Object.prototype.hasOwnProperty.call(data, 'scope');
  if (!hasScope) {
    if (Object.prototype.hasOwnProperty.call(data, 'scopeScanComplete')) throw invalidScope();
    return result;
  }
  const raw = ownValue(data, 'scope');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw invalidScope();
  const keys = Reflect.ownKeys(raw);
  if (keys.some(key => typeof key !== 'string' || !['kind', 'ancestorLevels'].includes(key))) throw invalidScope();
  const kind = ownValue(raw, 'kind');
  const scopeScanComplete = ownValue(data, 'scopeScanComplete');
  if (typeof scopeScanComplete !== 'boolean') throw invalidScope();
  let scope: { kind: 'window' } | { kind: 'element-ancestor'; ancestorLevels: number };
  if (kind === 'window' && keys.length === 1) scope = { kind };
  else if (kind === 'element-ancestor' && keys.length === 2) {
    const ancestorLevels = ownValue(raw, 'ancestorLevels');
    if (typeof ancestorLevels !== 'number' || !Number.isSafeInteger(ancestorLevels) || ancestorLevels < 0 || ancestorLevels > 3
      || ownValue(data, 'candidateScanComplete') !== false || ownValue(data, 'coordinateClickReady') !== false) throw invalidScope();
    scope = { kind, ancestorLevels };
  } else throw invalidScope();
  if (!Array.isArray(ownValue(data, 'elements'))) throw invalidScope();
  if (Object.prototype.hasOwnProperty.call(data, 'changeSummary')) {
    const summary = ownValue(data, 'changeSummary');
    if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
      for (const field of ['scopeScanComplete', 'previousScopeScanComplete']) {
        if (!Object.prototype.hasOwnProperty.call(summary, field)) continue;
        const value = ownValue(summary, field);
        if (typeof value !== 'boolean' || field === 'scopeScanComplete' && value !== scopeScanComplete) throw invalidScope();
      }
    }
  }
  return { ...result, data: { ...data, scope, scopeScanComplete } };
}

/** Shorten lists only between complete records so IDs and labels remain exact. */
export function projectAgentComputerResultForProvider(
  result: AgentToolResult,
  tokenBudget: number,
  mode: AgentComputerProviderProjectionMode,
): AgentProviderToolResultProjection | null {
  if (result.ok !== true || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return null;
  const source = (mode === 'computer-observe' ? normalizeAgentComputerObservationScopeForProvider(result) : result).data as Record<string, unknown>;
  const observing = mode === 'computer-observe';
  const rawRecords = source[observing ? 'elements' : 'windows'];
  if (!Array.isArray(rawRecords)) return null;
  const records: unknown[] = rawRecords;
  const identity = observing ? Object.fromEntries(OBSERVATION_FIELDS
    .filter(field => Object.prototype.hasOwnProperty.call(source, field)).map(field => [field, source[field]])) : {};
  if (observing && Object.prototype.hasOwnProperty.call(source, 'scope')) {
    Object.assign(identity, { scope: source.scope, scopeScanComplete: source.scopeScanComplete });
  }
  const axCharacters = observing && typeof source.axTree === 'string' ? Array.from(source.axTree) : [];

  function projection(recordCount: number, axCount: number): AgentProviderToolResultProjection {
    const omittedRecords = records.length - recordCount;
    const shortenedAx = axCount < axCharacters.length;
    const data = observing ? {
      ...identity,
      elements: records.slice(0, recordCount),
      elementsTruncated: omittedRecords > 0,
      omittedElements: omittedRecords,
      ...(Object.prototype.hasOwnProperty.call(source, 'changes') ? { changesOmittedForContext: true } : {}),
      ...(axCharacters.length ? {
        ...(axCount > 0 ? { axTree: axCharacters.slice(0, axCount).join('') } : {}),
        axTreeTruncated: source.axTreeTruncated === true || shortenedAx,
        axTreeOmittedForContext: axCount === 0,
      } : {}),
    } : {
      windows: records.slice(0, recordCount),
      truncated: source.truncated === true || omittedRecords > 0,
      omittedWindows: omittedRecords,
    };
    const content = JSON.stringify({ ok: true, ...(result.message === undefined ? {} : { message: result.message }), data,
      _omniflowProjection: { reason: 'provider_context_budget', truncated: true, version: 1 } });
    return { content, estimatedTokens: estimateAgentTextTokens(content), truncated: true };
  }

  const minimum = projection(0, 0);
  if (minimum.estimatedTokens > tokenBudget) {
    throw new Error('当前上下文不足以交付应用窗口观察身份；已停止，未把不完整的标识作为可用结果');
  }
  // Controls/window references take priority over the optional readable AX summary.
  let lower = 0, upper = records.length, retainedRecords = 0;
  while (lower <= upper) {
    const count = Math.floor((lower + upper) / 2);
    if (projection(count, 0).estimatedTokens <= tokenBudget) {
      retainedRecords = count;
      lower = count + 1;
    } else upper = count - 1;
  }
  lower = 0;
  upper = axCharacters.length;
  let retainedAx = 0;
  while (lower <= upper) {
    const count = Math.floor((lower + upper) / 2);
    if (projection(retainedRecords, count).estimatedTokens <= tokenBudget) {
      retainedAx = count;
      lower = count + 1;
    } else upper = count - 1;
  }
  return projection(retainedRecords, retainedAx);
}

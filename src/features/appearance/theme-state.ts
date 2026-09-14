import type { ResolvedThemeMode, ThemeMode } from '@/contexts/theme.context';
import { resolveAppearanceTheme } from './appearance-theme';
import { isThemeRecord, validateColorOverrides, type ColorTokenOverrides } from './color-theme';
import { validateThemeEffects, type EffectOverrides } from './theme-effects';

export interface ThemeSelection {
  readonly mode: ThemeMode;
  readonly colorThemeId: string;
  readonly iconThemeId: string;
  readonly overrides?: { readonly colors?: ColorTokenOverrides; readonly effects?: EffectOverrides };
}
export interface ThemeOperationToken {
  readonly ownerEpoch: string;
  readonly accountScope: string;
  readonly scopeGeneration: number;
  readonly operation: number;
}
export interface ThemeState {
  readonly ownerEpoch: string;
  readonly accountScope: string;
  readonly scopeGeneration: number;
  readonly revision: number;
  readonly nextOperation: number;
  readonly interactionRevision: number;
  readonly systemMode: ResolvedThemeMode;
  readonly committed: ThemeSelection;
  readonly preview: { readonly token: ThemeOperationToken; readonly selection: ThemeSelection } | null;
  readonly pendingSave: { readonly token: ThemeOperationToken; readonly selection: ThemeSelection } | null;
  readonly pendingLoad: { readonly token: ThemeOperationToken; readonly interactionRevision: number } | null;
}
export type ThemeAction =
  | { type: 'preview'; selection: ThemeSelection }
  | { type: 'update-preview'; token: ThemeOperationToken; selection: ThemeSelection }
  | { type: 'cancel' | 'confirm'; token: ThemeOperationToken }
  | { type: 'save-result'; token: ThemeOperationToken; success: boolean }
  | { type: 'begin-load' }
  | { type: 'catalog-changed' }
  | { type: 'load-failed'; token: ThemeOperationToken }
  | { type: 'load-result'; token: ThemeOperationToken; selection: ThemeSelection }
  | { type: 'scope'; accountScope: string; selection: ThemeSelection }
  | { type: 'system'; mode: ResolvedThemeMode };

function scope(value: string) {
  if (value !== 'anonymous' && (!/^user:[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value.slice(5))))) throw new Error('Invalid account scope');
  return value;
}
function selection(input: ThemeSelection): ThemeSelection {
  if (!['light', 'dark', 'system'].includes(input.mode)
    || ![input.colorThemeId, input.iconThemeId].every(id => typeof id === 'string' && id.length <= 128 && /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id))) throw new Error('Invalid theme selection');
  // Validate the transaction using the same contract as the eventual host owner.
  if (resolveAppearanceTheme({ mode: 'light', overrides: input.overrides }).errors.length) throw new Error('Invalid theme overrides');
  const colors = validateColorOverrides(input.overrides?.colors ?? {}).value!;
  const effects = validateThemeEffects(input.overrides?.effects ?? {}).value!;
  return Object.freeze({ mode: input.mode, colorThemeId: input.colorThemeId, iconThemeId: input.iconThemeId,
    overrides: Object.freeze({ colors, effects }) });
}
function increment(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) throw new Error('Theme counter exhausted');
  return value + 1;
}
function token(state: ThemeState): ThemeOperationToken {
  return Object.freeze({ ownerEpoch: state.ownerEpoch, accountScope: state.accountScope, scopeGeneration: state.scopeGeneration, operation: state.nextOperation });
}
function same(a: ThemeOperationToken | undefined, b: ThemeOperationToken) {
  return Boolean(a && a.ownerEpoch === b.ownerEpoch && a.accountScope === b.accountScope && a.scopeGeneration === b.scopeGeneration && a.operation === b.operation);
}
function change(state: ThemeState, patch: Partial<ThemeState>): ThemeState {
  return Object.freeze({ ...state, ...patch, revision: increment(state.revision) });
}
export function createThemeState(input: { ownerEpoch: string; accountScope: string; systemMode: ResolvedThemeMode; selection: ThemeSelection }): ThemeState {
  if (!input.ownerEpoch.trim() || input.ownerEpoch.trim() !== input.ownerEpoch || input.ownerEpoch.length > 128 || !['light', 'dark'].includes(input.systemMode)) throw new Error('Invalid theme owner or system mode');
  return Object.freeze({ ownerEpoch: input.ownerEpoch, accountScope: scope(input.accountScope), systemMode: input.systemMode,
    scopeGeneration: 0, revision: 0, nextOperation: 1, interactionRevision: 0, committed: selection(input.selection), preview: null, pendingSave: null, pendingLoad: null });
}
export interface ThemeTransition {
  readonly state: ThemeState;
  readonly write?: { readonly token: ThemeOperationToken; readonly selection: ThemeSelection };
  readonly error?: 'save-pending';
}

// Pure reducer, never instantiated as a singleton. Future ThemeContext owns this state.
export function transitionTheme(state: ThemeState, action: ThemeAction): ThemeTransition {
  switch (action.type) {
    case 'preview': {
      const preview = Object.freeze({ token: token(state), selection: selection(action.selection) });
      return { state: change(state, { preview, nextOperation: increment(state.nextOperation), interactionRevision: increment(state.interactionRevision) }) };
    }
    case 'cancel':
      return { state: same(state.preview?.token, action.token) ? change(state, { preview: null }) : state };
    case 'update-preview':
      return { state: same(state.preview?.token, action.token) ? change(state, { preview: Object.freeze({ token: state.preview!.token, selection: selection(action.selection) }), interactionRevision: increment(state.interactionRevision) }) : state };
    case 'confirm': {
      if (!same(state.preview?.token, action.token)) return { state };
      if (state.pendingSave) return { state, error: 'save-pending' };
      const write = state.preview!;
      return { state: change(state, { preview: null, pendingSave: write }), write };
    }
    case 'save-result': {
      if (!same(state.pendingSave?.token, action.token)) return { state };
      return { state: change(state, { committed: action.success ? state.pendingSave!.selection : state.committed, pendingSave: null }) };
    }
    case 'begin-load':
      if (state.preview || state.pendingSave) return { state };
      return { state: change(state, { pendingLoad: Object.freeze({ token: token(state), interactionRevision: state.interactionRevision }), nextOperation: increment(state.nextOperation) }) };
    case 'load-result': {
      if (!same(state.pendingLoad?.token, action.token)) return { state };
      const mayApply = state.pendingLoad!.interactionRevision === state.interactionRevision && !state.preview && !state.pendingSave;
      return { state: change(state, { pendingLoad: null, ...(mayApply ? { committed: selection(action.selection) } : {}) }) };
    }
    case 'load-failed':
      return { state: same(state.pendingLoad?.token, action.token) ? change(state, { pendingLoad: null }) : state };
    case 'scope':
      return { state: change(state, { accountScope: scope(action.accountScope), scopeGeneration: increment(state.scopeGeneration), committed: selection(action.selection), preview: null, pendingLoad: null, pendingSave: null, interactionRevision: increment(state.interactionRevision) }) };
    case 'system':
      if (action.mode !== 'light' && action.mode !== 'dark') throw new Error('Invalid system mode');
      return { state: state.systemMode === action.mode ? state : change(state, { systemMode: action.mode }) };
    case 'catalog-changed':
      return { state: change(state, {}) };
  }
}

export function createThemeSnapshot(state: ThemeState, findTheme: (id: string) => unknown) {
  const requested = state.preview?.selection ?? state.pendingSave?.selection ?? state.committed;
  const mode = requested.mode === 'system' ? state.systemMode : requested.mode;
  const definition = findTheme(requested.colorThemeId);
  if (isThemeRecord(definition) && typeof definition.id === 'string' && definition.id !== requested.colorThemeId) throw new Error('Theme catalog identity mismatch');
  const resolved = resolveAppearanceTheme({ mode, theme: definition, overrides: requested.overrides });
  return Object.freeze({ schemaVersion: 1 as const, ownerEpoch: state.ownerEpoch, accountScope: state.accountScope,
    scopeGeneration: state.scopeGeneration, revision: state.revision, requested, resolved,
    fallbackReason: definition === undefined && requested.colorThemeId !== 'omniflow.default' ? 'missing' : resolved.errors.length ? 'invalid' : null,
    phase: state.preview ? 'preview' : state.pendingSave ? 'saving' : 'committed' });
}
export type ThemeSnapshot = ReturnType<typeof createThemeSnapshot>;

// Ordering only. The transport must separately validate schema and bind the real sender.
export function isNewerThemeSnapshot(incoming: ThemeSnapshot, current: ThemeSnapshot | null,
  expected: Pick<ThemeSnapshot, 'ownerEpoch' | 'accountScope' | 'scopeGeneration'>): boolean {
  if (incoming.schemaVersion !== 1 || incoming.ownerEpoch !== expected.ownerEpoch || incoming.accountScope !== expected.accountScope
    || incoming.scopeGeneration !== expected.scopeGeneration || !Number.isSafeInteger(incoming.revision) || incoming.revision < 0) return false;
  return !current || current.ownerEpoch !== expected.ownerEpoch || current.accountScope !== expected.accountScope
    || current.scopeGeneration !== expected.scopeGeneration || incoming.revision > current.revision;
}

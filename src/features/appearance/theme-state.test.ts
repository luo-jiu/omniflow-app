import { describe, expect, it } from 'vitest';
import { createThemeSnapshot, createThemeState, isNewerThemeSnapshot, transitionTheme, type ThemeSelection } from './theme-state';

const initial: ThemeSelection = { mode: 'system', colorThemeId: 'omniflow.default', iconThemeId: 'omniflow.material' };
const blue: ThemeSelection = { ...initial, colorThemeId: 'example.blue', overrides: { colors: { 'text.primary': '#123456' } } };
const green: ThemeSelection = { ...initial, colorThemeId: 'example.green' };
const create = () => createThemeState({ ownerEpoch: 'epoch-a', accountScope: 'user:900001', systemMode: 'dark', selection: initial });
const snapshot = (state: ReturnType<typeof create>) => createThemeSnapshot(state, () => undefined);

describe('theme owner pure transitions', () => {
  it('previews without persistence and cancels back to committed selection', () => {
    const state = create();
    const preview = transitionTheme(state, { type: 'preview', selection: blue });
    expect(preview.write).toBeUndefined();
    expect(preview.state.committed).toBe(state.committed);
    expect(snapshot(preview.state).requested.colorThemeId).toBe(blue.colorThemeId);
    const cancelled = transitionTheme(preview.state, { type: 'cancel', token: preview.state.preview!.token });
    expect(snapshot(cancelled.state).requested).toBe(state.committed);
  });
  it('emits exactly one write request and commits only matching success', () => {
    const preview = transitionTheme(create(), { type: 'preview', selection: blue }).state;
    const confirmation = transitionTheme(preview, { type: 'confirm', token: preview.preview!.token });
    expect(confirmation.write?.selection.colorThemeId).toBe(blue.colorThemeId);
    expect(confirmation.state.committed.colorThemeId).toBe(initial.colorThemeId);
    expect(snapshot(confirmation.state).phase).toBe('saving');
    expect(transitionTheme(confirmation.state, { type: 'confirm', token: preview.preview!.token }).write).toBeUndefined();
    const saved = transitionTheme(confirmation.state, { type: 'save-result', token: confirmation.write!.token, success: true }).state;
    expect(saved.committed.colorThemeId).toBe(blue.colorThemeId);
    expect(saved.pendingSave).toBeNull();
  });
  it.each([true, false])('preserves a newer preview while an earlier save settles (%s)', success => {
    const first = transitionTheme(create(), { type: 'preview', selection: blue }).state;
    const saving = transitionTheme(first, { type: 'confirm', token: first.preview!.token });
    const second = transitionTheme(saving.state, { type: 'preview', selection: green }).state;
    expect(transitionTheme(second, { type: 'confirm', token: second.preview!.token }).error).toBe('save-pending');
    const settled = transitionTheme(second, { type: 'save-result', token: saving.write!.token, success }).state;
    expect(snapshot(settled).requested.colorThemeId).toBe(green.colorThemeId);
    const cancelled = transitionTheme(settled, { type: 'cancel', token: second.preview!.token }).state;
    expect(snapshot(cancelled).requested.colorThemeId).toBe(success ? blue.colorThemeId : initial.colorThemeId);
  });
  it('ignores callbacks from a previous preview and account visit', () => {
    const first = transitionTheme(create(), { type: 'preview', selection: blue }).state;
    const second = transitionTheme(first, { type: 'preview', selection: green }).state;
    expect(transitionTheme(second, { type: 'cancel', token: first.preview!.token }).state).toBe(second);
    const save = transitionTheme(second, { type: 'confirm', token: second.preview!.token });
    const switched = transitionTheme(save.state, { type: 'scope', accountScope: 'user:900002', selection: initial }).state;
    const returned = transitionTheme(switched, { type: 'scope', accountScope: 'user:900001', selection: initial }).state;
    expect(transitionTheme(returned, { type: 'save-result', token: save.write!.token, success: true }).state).toBe(returned);
  });
  it('does not let late initialization override a user interaction, even after cancel', () => {
    const loading = transitionTheme(create(), { type: 'begin-load' }).state;
    const preview = transitionTheme(loading, { type: 'preview', selection: blue }).state;
    const cancelled = transitionTheme(preview, { type: 'cancel', token: preview.preview!.token }).state;
    const loaded = transitionTheme(cancelled, { type: 'load-result', token: loading.pendingLoad!.token, selection: green }).state;
    expect(loaded.committed.colorThemeId).toBe(initial.colorThemeId);
    expect(loaded.pendingLoad).toBeNull();
  });
  it('uses only the newest load and does not start loading during a save', () => {
    const first = transitionTheme(create(), { type: 'begin-load' }).state;
    const second = transitionTheme(first, { type: 'begin-load' }).state;
    expect(transitionTheme(second, { type: 'load-result', token: first.pendingLoad!.token, selection: blue }).state).toBe(second);
    const loaded = transitionTheme(second, { type: 'load-result', token: second.pendingLoad!.token, selection: green }).state;
    expect(loaded.committed.colorThemeId).toBe(green.colorThemeId);
    const preview = transitionTheme(loaded, { type: 'preview', selection: blue }).state;
    const saving = transitionTheme(preview, { type: 'confirm', token: preview.preview!.token }).state;
    expect(transitionTheme(saving, { type: 'begin-load' }).state).toBe(saving);
  });
  it('clears a failed load without changing committed selection or clearing a newer request', () => {
    const first = transitionTheme(create(), { type: 'begin-load' }).state;
    const second = transitionTheme(first, { type: 'begin-load' }).state;
    expect(transitionTheme(second, { type: 'load-failed', token: first.pendingLoad!.token }).state).toBe(second);
    const failed = transitionTheme(second, { type: 'load-failed', token: second.pendingLoad!.token }).state;
    expect(failed.pendingLoad).toBeNull();
    expect(failed.committed).toBe(second.committed);
  });
  it('updates system projection without overwriting the selected mode', () => {
    const state = transitionTheme(create(), { type: 'system', mode: 'light' }).state;
    expect(state.committed.mode).toBe('system');
    expect(snapshot(state).resolved.mode).toBe('light');
    expect(state.revision).toBe(1);
  });
  it('preserves a missing package preference while returning a diagnostic default', () => {
    const state = transitionTheme(create(), { type: 'preview', selection: blue }).state;
    const projected = snapshot(state);
    expect(projected.requested.colorThemeId).toBe('example.blue');
    expect(projected.resolved.themeId).toBe('omniflow.default');
    expect(projected.fallbackReason).toBe('missing');
    expect(() => createThemeSnapshot(state, () => ({ schemaVersion: 1, id: 'example.wrong', variants: { light: {} } }))).toThrow('identity mismatch');
  });
  it('publishes a newer snapshot for package availability changes without losing selection', () => {
    const state = transitionTheme(create(), { type: 'preview', selection: blue }).state;
    const missing = snapshot(state);
    const updated = transitionTheme(state, { type: 'catalog-changed' }).state;
    const available = createThemeSnapshot(updated, () => ({ schemaVersion: 1, id: blue.colorThemeId, variants: { dark: { 'surface.app': '#00f' } } }));
    expect(available.fallbackReason).toBeNull();
    expect(available.requested).toBe(missing.requested);
    expect(isNewerThemeSnapshot(available, missing, missing)).toBe(true);
  });
  it('accepts a new epoch only when the transport explicitly expects that owner', () => {
    const current = snapshot(create());
    const newer = snapshot(transitionTheme(create(), { type: 'system', mode: 'light' }).state);
    expect(isNewerThemeSnapshot(newer, current, current)).toBe(true);
    expect(isNewerThemeSnapshot(current, current, current)).toBe(false);
    const restarted = snapshot(createThemeState({ ownerEpoch: 'epoch-b', accountScope: 'user:900001', systemMode: 'dark', selection: initial }));
    expect(isNewerThemeSnapshot(restarted, newer, current)).toBe(false);
    expect(isNewerThemeSnapshot(restarted, newer, restarted)).toBe(true);
  });
  it('detaches user overrides and rejects invalid transactions before changing state', () => {
    const mutable = { ...initial, overrides: { colors: { 'text.primary': '#123' } } };
    const next = transitionTheme(create(), { type: 'preview', selection: mutable }).state;
    mutable.overrides.colors['text.primary'] = '#fff';
    expect(next.preview!.selection.overrides!.colors!['text.primary']).toBe('#123');
    expect(() => transitionTheme(next, { type: 'preview', selection: { ...initial, overrides: { colors: { 'text.primary': 'url(x)' } } } })).toThrow();
    expect(next.preview!.selection.overrides!.colors!['text.primary']).toBe('#123');
  });
});

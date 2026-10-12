import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { randomUUID } from 'node:crypto';
import type { ComputerElementOperation } from '@/shared/computer-use/computer-use-contract';
import type { FirstPartyControlRequest, FirstPartyControlResponse, FirstPartyControlSnapshot, FirstPartyRegistrationInput } from '@/shared/computer-use/first-party-control-contract';
import { createAgentComputerLocalControls, isAgentComputerRunCurrent, sameAgentComputerScrollContent, useAgentComputerControls, type AgentComputerControlsInput } from './useAgentComputerControls';
import type { AgentComputerDraft } from './useAgentSession';
import type { AgentRunSnapshot } from '@/shared/agent/agent.types';

const instanceId = '11111111-1111-4111-8111-111111111111';
const context = { ownerScope: { accountScope: 'user:7', backendScope: 'http://127.0.0.1:8850/api' }, libraryId: 3, sessionId: '22222222-2222-4222-8222-222222222222' };
const runId = '33333333-3333-4333-8333-333333333333';
function request(snapshot: FirstPartyControlSnapshot, operation: ComputerElementOperation, text?: string): Extract<FirstPartyControlRequest, { kind: 'verify' | 'dispatch' }> {
  return { registrationId: '44444444-4444-4444-8444-444444444444', documentGeneration: '55555555-5555-4555-8555-555555555555',
    requestId: '66666666-6666-4666-8666-666666666666', context, runId, expiresAt: Date.now() + 5_000,
    kind: 'dispatch', snapshot, operation, ...(text !== undefined ? { text } : {}) };
}
function fixture() {
  let focused = false; let modal = false; let selected = false; let composing = false; let navigating = false; let revision = 1;
  const doc = { hasFocus: () => focused, activeElement: null as Element | null,
    querySelector: () => modal ? {} : null, getSelection: () => ({ isCollapsed: !selected }) } as unknown as Document;
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) });
  const bounds = { x: 10, y: 100, width: 800, height: 80, right: 810, bottom: 180 };
  const textarea = { isConnected: true, ownerDocument: doc, closest: () => null, getBoundingClientRect: () => bounds,
    value: '原文😀', selectionStart: 4, selectionEnd: 4, disabled: false, readOnly: false, focus: vi.fn(), blur: vi.fn(),
    setSelectionRange: vi.fn(), dispatchEvent: vi.fn() } as unknown as HTMLTextAreaElement;
  const scroll = { isConnected: true, ownerDocument: doc, closest: () => null, getBoundingClientRect: () => ({ ...bounds, height: 500, bottom: 600 }),
    scrollTop: 100, clientHeight: 500, scrollHeight: 2500 } as unknown as HTMLDivElement;
  let draft = { scopeKey: 'owner\u00003', sessionId: context.sessionId, revision: 1, value: textarea.value };
  const compareAndSetDraft = vi.fn((expected: AgentComputerDraft, value: string, beginApply: () => void) => {
    if (expected.revision !== draft.revision) return false;
    beginApply(); draft = { ...draft, revision: draft.revision + 1, value }; return true;
  });
  const applyScroll = vi.fn((top: number, beginApply: () => void) => { beginApply(); scroll.scrollTop = top; return true; });
  const input: AgentComputerControlsInput = { context, active: true, blocked: false, textareaRef: { current: textarea }, scrollRef: { current: scroll },
    readDraft: () => draft, compareAndSetDraft, compositionActive: () => composing, navigationActive: () => navigating,
    isRunCurrent: id => id === runId, applyScroll,
    scrollContentVersion: { messages: [], composerHeight: 120, composerDockHeight: 120 } };
  const controls = createAgentComputerLocalControls(() => input, instanceId, () => revision);
  return { input, controls, textarea, scroll, compareAndSetDraft, applyScroll, draft: () => draft,
    focus: () => { focused = true; Object.defineProperty(doc, 'activeElement', { configurable: true, value: textarea }); },
    background: () => { focused = false; }, modal: () => { modal = true; }, select: () => { selected = true; },
    compose: () => { composing = true; }, navigate: () => { navigating = true; }, changeContent: () => { revision += 1; } };
}
const renderers: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => { act(() => renderers.splice(0).forEach(renderer => renderer.unmount())); vi.unstubAllGlobals(); });

describe('Agent real control adapters', () => {
  it('observes metadata without copying draft text and updates only the React draft owner', () => {
    const f = fixture(); const snapshot = f.controls['agent-composer'].getSnapshot()!;
    expect(snapshot.operations).toEqual(['replaceText', 'insertText']);
    expect(JSON.stringify(snapshot)).not.toContain('原文');
    const begin = vi.fn();
    expect(f.controls['agent-composer'].apply(request(snapshot, 'replaceText', '中文😀\n第二行'), begin)).toBe(true);
    expect(begin).toHaveBeenCalledOnce(); expect(f.draft().value).toBe('中文😀\n第二行');
    expect(f.textarea.value).toBe('原文😀'); // DOM catches up via the existing controlled React render.
    expect(f.controls['agent-composer'].getSnapshot()).toBeNull();
    expect(f.textarea.focus).not.toHaveBeenCalled(); expect(f.textarea.blur).not.toHaveBeenCalled();
    expect(f.textarea.setSelectionRange).not.toHaveBeenCalled(); expect(f.textarea.dispatchEvent).not.toHaveBeenCalled();
  });
  it('allows inactive background input but refuses frontmost editing, IME and active selections', () => {
    const f = fixture(); f.focus(); expect(f.controls['agent-composer'].getSnapshot()).toBeNull();
    f.background(); expect(f.controls['agent-composer'].getSnapshot()).not.toBeNull();
    f.compose(); expect(f.controls['agent-composer'].getSnapshot()).toBeNull();
    const modal = fixture(); modal.modal(); expect(modal.controls['agent-composer'].getSnapshot()).toBeNull();
    const selected = fixture(); selected.select(); expect(selected.controls['agent-conversation'].getSnapshot()).toBeNull();
  });
  it('declares insert only at the frozen collapsed end and never changes the selection', () => {
    const f = fixture(); f.textarea.selectionStart = 1; f.textarea.selectionEnd = 1;
    expect(f.controls['agent-composer'].getSnapshot()!.operations).toEqual(['replaceText']);
    f.textarea.selectionStart = 4; f.textarea.selectionEnd = 4;
    const snapshot = f.controls['agent-composer'].getSnapshot()!;
    f.textarea.selectionStart = 3;
    expect(f.controls['agent-composer'].apply(request(snapshot, 'insertText', '＋插入'), vi.fn())).toBe(false);
    f.textarea.selectionStart = 4;
    expect(f.controls['agent-composer'].apply(request(snapshot, 'insertText', '＋插入'), vi.fn())).toBe(true);
    expect(f.draft().value).toBe('原文😀＋插入'); expect(f.textarea.setSelectionRange).not.toHaveBeenCalled();
  });
  it('refuses hidden, busy, disconnected, wrong-session, disabled and wrong-run targets before writing', () => {
    const f = fixture(); const snapshot = f.controls['agent-composer'].getSnapshot()!;
    f.input.blocked = true; expect(f.controls['agent-composer'].apply(request(snapshot, 'replaceText', ''), vi.fn())).toBe(false);
    f.input.blocked = false; f.input.active = false; expect(f.controls['agent-composer'].getSnapshot()).toBeNull();
    f.input.active = true; f.textarea.disabled = true; expect(f.controls['agent-composer'].getSnapshot()).toBeNull();
    f.textarea.disabled = false; f.input.context = { ...context, sessionId: '77777777-7777-4777-8777-777777777777' };
    expect(f.controls['agent-composer'].getSnapshot()).toBeNull();
    f.input.context = context;
    expect(f.controls['agent-composer'].apply({ ...request(snapshot, 'replaceText', ''), runId: 'wrong-run' }, vi.fn())).toBe(false);
    Object.defineProperty(f.textarea, 'isConnected', { value: false }); expect(f.controls['agent-composer'].getSnapshot()).toBeNull();
    expect(f.compareAndSetDraft).not.toHaveBeenCalled();
  });
  it('uses viewport Page, 40 CSS pixel Step and 10% actual range Fraction in the scroll owner', () => {
    for (const [operation, expected] of [['scrollDownPage', 600], ['scrollDownStep', 140], ['scrollDownFraction', 300], ['scrollUpFraction', 0]] as const) {
      const f = fixture(); const snapshot = f.controls['agent-conversation'].getSnapshot()!; const begin = vi.fn();
      expect(f.controls['agent-conversation'].apply(request(snapshot, operation), begin)).toBe(true);
      expect(f.applyScroll).toHaveBeenCalledWith(expected, expect.any(Function)); expect(begin).toHaveBeenCalledOnce();
    }
  });
  it('refuses a changed scroll top, extent, geometry, content or an active user navigation', () => {
    for (const change of [(f: ReturnType<typeof fixture>) => { f.scroll.scrollTop = 101; },
      (f: ReturnType<typeof fixture>) => { Object.defineProperty(f.scroll, 'scrollHeight', { value: 2501 }); },
      (f: ReturnType<typeof fixture>) => f.changeContent(), (f: ReturnType<typeof fixture>) => f.navigate()]) {
      const f = fixture(); const snapshot = f.controls['agent-conversation'].getSnapshot()!; change(f);
      expect(f.controls['agent-conversation'].apply(request(snapshot, 'scrollDownPage'), vi.fn())).toBe(false);
      expect(f.applyScroll).not.toHaveBeenCalled();
    }
  });
});

describe('conversation content invalidation', () => {
  const base = { composerHeight: 120, composerDockHeight: 120, messages: [
    { id: 'u1', role: 'user' as const, content: '问题' }, { id: 'a1', role: 'assistant' as const, content: '逐字回答' },
  ] };
  it('ignores tool anchors and same-content array projections without copying the strings', () => {
    expect(sameAgentComputerScrollContent(base, { ...base, messages: [...base.messages,
      { id: 'tool-new', role: 'tool', content: 'computer.scroll' }, { id: 'empty-a', role: 'assistant', content: '' }] })).toBe(true);
  });
  it('invalidates streaming text, visible message identity and Composer size changes', () => {
    expect(sameAgentComputerScrollContent(base, { ...base, messages: [base.messages[0], { ...base.messages[1], content: '逐字回答追加' }] })).toBe(false);
    expect(sameAgentComputerScrollContent(base, { ...base, messages: [{ ...base.messages[0], id: 'new-user' }, base.messages[1]] })).toBe(false);
    expect(sameAgentComputerScrollContent(base, { ...base, composerDockHeight: 140 })).toBe(false);
  });
});

describe('Agent control hook lifecycle', () => {
  it('verifies a stable scroll observation while its owning Run enters preparing, and rejects terminal or foreign Runs', async () => {
    const f = fixture(); vi.stubGlobal('crypto', { randomUUID });
    let status: AgentRunSnapshot['status'] = 'running';
    const run = (): AgentRunSnapshot => ({ id: runId, sessionId: context.sessionId, status, revision: 1, userPrompt: '向上滚动',
      model: 'model-a', profileId: 'profile-a', reasoningEffort: 'medium', createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z' });
    let listener!: (request: FirstPartyControlRequest) => void;
    const token = { registrationId: randomUUID(), documentGeneration: randomUUID() };
    const bridge = { register: vi.fn<(input: FirstPartyRegistrationInput) => Promise<typeof token>>(async () => token), unregister: vi.fn(async () => undefined),
      complete: vi.fn<(response: FirstPartyControlResponse) => Promise<void>>(async () => undefined),
      onRequest: vi.fn((callback: (request: FirstPartyControlRequest) => void) => { listener = callback; return () => undefined; }) };
    const props = { ...f.input, bridge, isRunCurrent: (id: string) => isAgentComputerRunCurrent([run()], context.sessionId, id) };
    function Probe(input: AgentComputerControlsInput) { useAgentComputerControls(input); return null; }
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, props)); renderers.push(renderer); });
    listener({ ...token, context, runId, expiresAt: Date.now() + 5000, requestId: randomUUID(), kind: 'observe' });
    const observed = bridge.complete.mock.calls[0][0];
    expect(observed.status).toBe('observed');
    if (observed.status !== 'observed') throw new Error('Missing observation');
    const snapshot = observed.controls.find(control => control.controlId === 'agent-conversation')!;
    status = 'preparing';
    await act(async () => { renderer.update(React.createElement(Probe, { ...props, scrollContentVersion: { ...props.scrollContentVersion,
      messages: [{ id: 'scroll-anchor', role: 'tool', content: '正在调用 computer.scroll' }] } })); });
    listener({ ...request(snapshot, 'scrollUpPage'), ...token, requestId: randomUUID(), kind: 'verify' });
    expect(bridge.complete).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'verified' }));
    expect(f.applyScroll).not.toHaveBeenCalled();
    status = 'completed';
    listener({ ...request(snapshot, 'scrollUpPage'), ...token, requestId: randomUUID(), kind: 'verify' });
    expect(bridge.complete).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'rejected' }));
    status = 'preparing';
    expect(isAgentComputerRunCurrent([run()], 'another-session', runId)).toBe(false);
    expect(isAgentComputerRunCurrent([run()], context.sessionId, 'another-run')).toBe(false);
  });
  it('releases hidden and changed-session controls with exactly one active request listener', async () => {
    const f = fixture(); vi.stubGlobal('crypto', { randomUUID });
    const listeners = new Set<(request: FirstPartyControlRequest) => void>();
    const bridge = {
      register: vi.fn(async () => ({ registrationId: randomUUID(), documentGeneration: randomUUID() })),
      unregister: vi.fn(async () => undefined), complete: vi.fn(async () => undefined),
      onRequest: vi.fn((listener: (request: FirstPartyControlRequest) => void) => { listeners.add(listener); return () => listeners.delete(listener); }),
    };
    const props = { ...f.input, bridge };
    function Probe(input: AgentComputerControlsInput) { useAgentComputerControls(input); return null; }
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, props)); renderers.push(renderer); });
    expect(listeners.size).toBe(1); expect(bridge.register).toHaveBeenCalledOnce();
    await act(async () => { renderer.update(React.createElement(Probe, { ...props, blocked: true })); });
    expect(listeners.size).toBe(1); expect(bridge.register).toHaveBeenCalledOnce();
    await act(async () => { renderer.update(React.createElement(Probe, { ...props, active: false })); });
    expect(listeners.size).toBe(0); expect(bridge.unregister).toHaveBeenCalledOnce();
    await act(async () => { renderer.update(React.createElement(Probe, props)); });
    expect(listeners.size).toBe(1); expect(bridge.register).toHaveBeenCalledTimes(2);
    await act(async () => { renderer.update(React.createElement(Probe, { ...props, context: { ...context, sessionId: randomUUID() } })); });
    expect(listeners.size).toBe(1); expect(bridge.unregister).toHaveBeenCalledTimes(2); expect(bridge.register).toHaveBeenCalledTimes(3);
    act(() => renderer.unmount()); expect(listeners.size).toBe(0); expect(bridge.unregister).toHaveBeenCalledTimes(3);
  });
});

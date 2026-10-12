import React from 'react';
import type { ComputerElementOperation } from '@/shared/computer-use/computer-use-contract';
import type { FirstPartyControlContext, FirstPartyControlRect, FirstPartyControlSnapshot } from '@/shared/computer-use/first-party-control-contract';
import { registerFirstPartyLocalControls, type FirstPartyLocalControl } from '@/modules/computer-use/first-party-controls';
import type { FirstPartyControlsBridge } from '@/service/computer-use/first-party-controls.api';
import type { AgentComputerDraft } from './useAgentSession';
import type { AgentMessage, AgentRunSnapshot } from '@/shared/agent/agent.types';
import { isAgentRunActive } from '../agent-run-presentation';

export function isAgentComputerRunCurrent(runs: readonly AgentRunSnapshot[], sessionId: string | null, runId: string): boolean {
  return !!sessionId && runs.some(run => run.id === runId && run.sessionId === sessionId && isAgentRunActive(run));
}

export interface AgentComputerScrollContent {
  messages: readonly Pick<AgentMessage, 'id' | 'role' | 'content'>[];
  composerHeight: number;
  composerDockHeight: number;
}

/** Compare existing source strings without serializing or copying the transcript. */
export function sameAgentComputerScrollContent(previous: AgentComputerScrollContent, current: AgentComputerScrollContent): boolean {
  if (previous.composerHeight !== current.composerHeight || previous.composerDockHeight !== current.composerDockHeight) return false;
  if (previous.messages === current.messages) return true;
  const relevant = (message: AgentComputerScrollContent['messages'][number]) => message.role === 'user'
    || (message.role === 'assistant' && !!message.content);
  let before = 0; let after = 0;
  while (before < previous.messages.length || after < current.messages.length) {
    while (before < previous.messages.length && !relevant(previous.messages[before])) before += 1;
    while (after < current.messages.length && !relevant(current.messages[after])) after += 1;
    if (before === previous.messages.length || after === current.messages.length) return before === previous.messages.length && after === current.messages.length;
    const old = previous.messages[before++]; const next = current.messages[after++];
    if (old.id !== next.id || old.role !== next.role || old.content !== next.content) return false;
  }
  return true;
}

export interface AgentComputerControlsInput {
  context: FirstPartyControlContext | null;
  active: boolean;
  blocked: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  scrollRef: React.RefObject<HTMLDivElement>;
  readDraft(): AgentComputerDraft;
  compareAndSetDraft(expected: AgentComputerDraft, value: string, beginApply: () => void): boolean;
  compositionActive(): boolean;
  navigationActive(): boolean;
  isRunCurrent(runId: string): boolean;
  /** The existing scroll owner applies an instant move and suspends automatic following. */
  applyScroll(top: number, beginApply: () => void): boolean;
  scrollContentVersion: AgentComputerScrollContent;
  bridge?: FirstPartyControlsBridge;
}

const SCROLL_OPERATIONS: ComputerElementOperation[] = [
  'scrollUpPage', 'scrollDownPage', 'scrollUpStep', 'scrollDownStep', 'scrollUpFraction', 'scrollDownFraction',
];

function controlBounds(element: HTMLElement): FirstPartyControlRect | null {
  if (!element.isConnected || element.ownerDocument !== document || element.closest('[inert]')) return null;
  const style = window.getComputedStyle(element);
  if (style.visibility !== 'visible' || style.display === 'none') return null;
  const rect = element.getBoundingClientRect();
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    || rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1
    || rect.right > window.innerWidth || rect.bottom > window.innerHeight) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function hasBlockingInteraction(): boolean {
  // Fixed local UI surfaces only; nothing supplied by a model chooses a DOM selector.
  return !!document.querySelector('[aria-modal="true"], .semi-modal-wrap, .semi-image-preview')
    || document.getSelection()?.isCollapsed === false;
}

export function createAgentComputerLocalControls(getInput: () => AgentComputerControlsInput, instanceId: string, getScrollRevision: () => number) {
  const available = () => {
    const input = getInput();
    return input.active && !input.blocked && !!input.context && !hasBlockingInteraction();
  };
  const textSnapshot = (): FirstPartyControlSnapshot | null => {
    const input = getInput();
    const element = input.textareaRef.current;
    if (!available() || !element || element.disabled || element.readOnly || input.compositionActive()
      || (document.hasFocus() && document.activeElement === element)) return null;
    const bounds = controlBounds(element);
    const draft = input.readDraft();
    if (!bounds || draft.sessionId !== input.context?.sessionId || element.value !== draft.value
      || draft.value.length > 128_000) return null;
    const selectionStart = element.selectionStart;
    const selectionEnd = element.selectionEnd;
    return { controlId: 'agent-composer', instanceId, revision: draft.revision, bounds,
      operations: ['replaceText', ...(selectionStart === draft.value.length && selectionEnd === draft.value.length ? ['insertText' as const] : [])],
      state: { kind: 'text', selectionStart, selectionEnd, textLength: draft.value.length } };
  };
  const scrollSnapshot = (): FirstPartyControlSnapshot | null => {
    const input = getInput();
    const element = input.scrollRef.current;
    if (!available() || !element || input.navigationActive()) return null;
    const bounds = controlBounds(element);
    if (!bounds || element.clientHeight < 1 || element.scrollHeight <= element.clientHeight || element.scrollTop < 0) return null;
    return { controlId: 'agent-conversation', instanceId, revision: getScrollRevision(), bounds,
      operations: [...SCROLL_OPERATIONS], state: { kind: 'scroll', top: element.scrollTop,
        clientHeight: element.clientHeight, scrollHeight: element.scrollHeight } };
  };
  const matches = (current: FirstPartyControlSnapshot | null, expected: FirstPartyControlSnapshot) => current && JSON.stringify(current) === JSON.stringify(expected);
  const controls: Record<'agent-composer' | 'agent-conversation', FirstPartyLocalControl> = {
    'agent-composer': {
      getSnapshot: textSnapshot,
      apply(request, beginApply) {
        const input = getInput();
        if (!input.isRunCurrent(request.runId) || !matches(textSnapshot(), request.snapshot)
          || (request.operation !== 'replaceText' && request.operation !== 'insertText') || typeof request.text !== 'string') return false;
        const draft = input.readDraft();
        const value = request.operation === 'replaceText' ? request.text : draft.value + request.text;
        if (value.length > 128_000) return false;
        return input.compareAndSetDraft(draft, value, beginApply);
      },
    },
    'agent-conversation': {
      getSnapshot: scrollSnapshot,
      apply(request, beginApply) {
        const input = getInput();
        if (!input.isRunCurrent(request.runId) || !matches(scrollSnapshot(), request.snapshot) || request.snapshot.state.kind !== 'scroll'
          || !SCROLL_OPERATIONS.includes(request.operation)) return false;
        const { top, clientHeight, scrollHeight } = request.snapshot.state;
        const range = scrollHeight - clientHeight;
        const distance = request.operation.endsWith('Page') ? clientHeight : request.operation.endsWith('Step') ? 40 : range * 0.1;
        const next = Math.max(0, Math.min(range, top + (request.operation.startsWith('scrollUp') ? -distance : distance)));
        return input.applyScroll(next, beginApply);
      },
    },
  };
  return controls;
}

/** Register only the currently rendered conversation, retaining no parallel draft or transcript. */
export function useAgentComputerControls(input: AgentComputerControlsInput) {
  const committed = React.useRef(input);
  const scrollRevision = React.useRef(1);
  const previousContent = React.useRef(input.scrollContentVersion);
  React.useLayoutEffect(() => {
    committed.current = input;
    if (!sameAgentComputerScrollContent(previousContent.current, input.scrollContentVersion)) {
      previousContent.current = input.scrollContentVersion;
      scrollRevision.current += 1;
    } else {
      previousContent.current = input.scrollContentVersion;
    }
  });
  const contextKey = input.context ? JSON.stringify([input.context.ownerScope.accountScope, input.context.ownerScope.backendScope,
    input.context.libraryId, input.context.sessionId]) : '';
  const registerable = input.active && !!input.context;
  React.useLayoutEffect(() => {
    if (!registerable || !committed.current.context) return;
    const context = committed.current.context;
    const instanceId = crypto.randomUUID();
    let mounted = true;
    const controls = createAgentComputerLocalControls(() => committed.current, instanceId, () => scrollRevision.current);
    const release = registerFirstPartyLocalControls({ context, instanceId, controls, bridge: input.bridge,
      isCurrent: runId => mounted && committed.current.active && !!committed.current.context
        && context.ownerScope.accountScope === committed.current.context.ownerScope.accountScope
        && context.ownerScope.backendScope === committed.current.context.ownerScope.backendScope
        && context.libraryId === committed.current.context.libraryId && context.sessionId === committed.current.context.sessionId
        && (!runId || committed.current.isRunCurrent(runId)) });
    return () => { mounted = false; release(); };
  }, [contextKey, registerable, input.bridge]);
}

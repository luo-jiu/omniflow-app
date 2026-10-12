import { describe, expect, it, vi } from 'vitest';

import {
  FIRST_PARTY_CONTROL_LABELS,
  normalizeFirstPartyControlContext,
  normalizeFirstPartyControlRequest,
  normalizeFirstPartyControlResponse,
  normalizeFirstPartyControlSnapshot,
  normalizeFirstPartyControlSnapshots,
  normalizeFirstPartyRegistration,
  normalizeFirstPartyRegistrationToken,
  type FirstPartyControlSnapshot,
} from './first-party-control-contract';

const ids = {
  requestId: '11111111-1111-4111-8111-111111111111',
  registrationId: '22222222-2222-4222-8222-222222222222',
  documentGeneration: '33333333-3333-4333-8333-333333333333',
  instanceId: '44444444-4444-4444-8444-444444444444',
  sessionId: '55555555-5555-4555-8555-555555555555',
  runId: '66666666-6666-4666-8666-666666666666',
};
const context = { ownerScope: { accountScope: 'qa-account', backendScope: 'qa-backend' }, libraryId: 3, sessionId: ids.sessionId };
const token = { registrationId: ids.registrationId, documentGeneration: ids.documentGeneration };

function textControl(): FirstPartyControlSnapshot {
  return {
    controlId: 'agent-composer', instanceId: ids.instanceId, revision: 1,
    bounds: { x: 1.5, y: 2.5, width: 500.25, height: 80.5 },
    operations: ['replaceText', 'insertText'],
    state: { kind: 'text', selectionStart: 3, selectionEnd: 3, textLength: 3 },
  };
}
function scrollControl(): FirstPartyControlSnapshot {
  return {
    controlId: 'agent-conversation', instanceId: ids.instanceId, revision: 2,
    bounds: { x: 0, y: 0, width: 500, height: 300 },
    operations: ['scrollUpPage', 'scrollDownPage', 'scrollUpStep', 'scrollDownStep', 'scrollUpFraction', 'scrollDownFraction'],
    state: { kind: 'scroll', top: 0, clientHeight: 300, scrollHeight: 1500 },
  };
}
function request(kind: 'observe' | 'verify' | 'dispatch', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...token, requestId: ids.requestId, context: structuredClone(context), runId: ids.runId,
    expiresAt: 1_800_000_000_000, kind,
    ...(kind === 'observe' ? {} : { snapshot: textControl(), operation: 'insertText' }),
    ...(kind === 'dispatch' ? { text: ' 中文😀\n\t尾 ' } : {}), ...extra,
  };
}

describe('first-party control registration boundary', () => {
  it('keeps fixed control names separate from AX and arbitrary DOM identities', () => {
    expect(Object.isFrozen(FIRST_PARTY_CONTROL_LABELS)).toBe(true);
    expect(Object.keys(FIRST_PARTY_CONTROL_LABELS)).toEqual(['agent-composer', 'agent-conversation']);
    const registration = { instanceId: ids.instanceId, context: structuredClone(context) };
    const normalized = normalizeFirstPartyRegistration(registration);
    expect(normalized).toEqual(registration);
    expect(normalized.context).not.toBe(registration.context);
    expect(normalized.context.ownerScope).not.toBe(registration.context.ownerScope);
    expect(normalizeFirstPartyRegistrationToken(token)).toEqual(token);
  });

  it.each(['AXTextArea', 'AXButton', '#composer', '[contenteditable]', 'constructor', '__proto__', 'other-control'])(
    'rejects an unregistered control name: %s', controlId => {
      expect(() => normalizeFirstPartyControlSnapshot({ ...textControl(), controlId })).toThrow();
    });

  it.each(['selector', 'script', 'webContentsId', 'frameId', 'pid', 'windowId', 'axPath'])(
    'rejects caller-chosen transport or node fields: %s', field => {
      expect(() => normalizeFirstPartyRegistration({ instanceId: ids.instanceId, context, [field]: 'untrusted' })).toThrow();
      expect(() => normalizeFirstPartyControlSnapshot({ ...textControl(), [field]: 'untrusted' })).toThrow();
    });

  it.each([null, '', '123', '00000000-0000-0000-0000-000000000000', '11111111-1111-4111-7111-111111111111', 123, true])(
    'rejects malformed opaque references without coercion: %j', invalid => {
      expect(() => normalizeFirstPartyRegistration({ instanceId: invalid, context })).toThrow();
      expect(() => normalizeFirstPartyRegistrationToken({ ...token, registrationId: invalid })).toThrow();
      expect(() => normalizeFirstPartyRegistrationToken({ ...token, documentGeneration: invalid })).toThrow();
      expect(() => normalizeFirstPartyControlContext({ ...context, sessionId: invalid })).toThrow();
    });

  it.each([0, -1, 3.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '3', true])('rejects invalid library identity: %j', libraryId => {
    expect(() => normalizeFirstPartyControlContext({ ...context, libraryId })).toThrow();
  });

  it.each(['', 'account\0secret', 'backend\nsecret', 'scope\u007fsecret', 'x'.repeat(513)])(
    'rejects malformed owner scopes without echoing the scope: %j', invalid => {
      for (const field of ['accountScope', 'backendScope']) {
        let rejectedError: unknown;
        try {
          normalizeFirstPartyControlContext({ ...context, ownerScope: { ...context.ownerScope, [field]: invalid } });
        } catch (error) {
          rejectedError = error;
        }
        expect(rejectedError).toBeInstanceOf(Error);
        expect((rejectedError as Error).message).not.toContain('secret');
        expect((rejectedError as Error).message).not.toContain('x'.repeat(513));
      }
    });

  it('rejects accessors, hidden fields, symbols and inherited records without executing a getter', () => {
    const getter = vi.fn(() => ids.instanceId);
    const ordinary = { instanceId: ids.instanceId, context };
    const accessor = Object.defineProperty({ ...ordinary }, 'instanceId', { enumerable: true, get: getter });
    const hidden = Object.defineProperty({ ...ordinary }, 'instanceId', { enumerable: false, value: ids.instanceId });
    const symbolic = { ...ordinary, [Symbol('capability')]: true };
    const inherited = Object.assign(Object.create(ordinary), { context });
    for (const input of [accessor, hidden, symbolic, inherited]) expect(() => normalizeFirstPartyRegistration(input)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const nullPrototype = Object.assign(Object.create(null), ordinary);
    expect(normalizeFirstPartyRegistration(nullPrototype)).toEqual(ordinary);
  });
});

describe('first-party control observation geometry and state', () => {
  it('retains CSS geometry, selection and distinct scroll units without caller-owned state', () => {
    const controls = [textControl(), scrollControl()];
    const normalized = normalizeFirstPartyControlSnapshots(controls);
    expect(normalized).toEqual(controls);
    expect(normalized).not.toBe(controls);
    expect(normalized[0].bounds).not.toBe(controls[0].bounds);
    expect(normalized[0].state).not.toBe(controls[0].state);
    expect(normalized[0].operations).not.toBe(controls[0].operations);
    normalized[0].bounds.width = 1;
    expect(controls[0].bounds.width).toBe(500.25);
    expect(normalizeFirstPartyControlSnapshots([])).toEqual([]);
  });

  it.each([-1, NaN, Infinity, -Infinity, 16_777_217, '0', true, null])('rejects invalid geometry numbers: %j', value => {
    for (const field of ['x', 'y', 'width', 'height']) {
      const snapshot = textControl();
      expect(() => normalizeFirstPartyControlSnapshot({ ...snapshot, bounds: { ...snapshot.bounds, [field]: value } })).toThrow();
    }
  });

  it.each([0, 0.5])('requires a positive usable control extent: %j', value => {
    for (const field of ['width', 'height']) {
      const snapshot = textControl();
      expect(() => normalizeFirstPartyControlSnapshot({ ...snapshot, bounds: { ...snapshot.bounds, [field]: value } })).toThrow();
    }
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', true])('rejects invalid revision counters: %j', revision => {
    expect(() => normalizeFirstPartyControlSnapshot({ ...textControl(), revision })).toThrow();
  });

  it.each([
    { kind: 'text', selectionStart: -1, selectionEnd: 3, textLength: 3 },
    { kind: 'text', selectionStart: 3, selectionEnd: 2, textLength: 3 },
    { kind: 'text', selectionStart: 3, selectionEnd: 4, textLength: 3 },
    { kind: 'text', selectionStart: 1.5, selectionEnd: 3, textLength: 3 },
    { kind: 'text', selectionStart: 3, selectionEnd: 3, textLength: 128_001 },
    { kind: 'text', selectionStart: 1, selectionEnd: 2, textLength: 3 },
    { kind: 'text', selectionStart: 2, selectionEnd: 2, textLength: 3 },
    { kind: 'text', selectionStart: 3, selectionEnd: 3, textLength: 3, value: 'private-draft' },
    { kind: 'scroll', top: 0, clientHeight: 300, scrollHeight: 1500 },
  ])('rejects text state that does not prove the declared text operation: %j', state => {
    expect(() => normalizeFirstPartyControlSnapshot({ ...textControl(), state })).toThrow();
  });

  it('allows replacement with a confirmed non-tail selection while refusing insert permission', () => {
    const snapshot = { ...textControl(), operations: ['replaceText'], state: { kind: 'text', selectionStart: 1, selectionEnd: 2, textLength: 3 } };
    expect(normalizeFirstPartyControlSnapshot(snapshot)).toEqual(snapshot);
  });

  it.each([
    { kind: 'scroll', top: -1, clientHeight: 300, scrollHeight: 1500 },
    { kind: 'scroll', top: 1201.01, clientHeight: 300, scrollHeight: 1500 },
    { kind: 'scroll', top: 0, clientHeight: 0, scrollHeight: 1500 },
    { kind: 'scroll', top: 0, clientHeight: 300, scrollHeight: 300 },
    { kind: 'scroll', top: 0, clientHeight: 300, scrollHeight: 299 },
    { kind: 'scroll', top: 0, clientHeight: 300, scrollHeight: Infinity },
    { kind: 'scroll', top: 0, clientHeight: 300, scrollHeight: 1500, content: 'private-conversation' },
  ])('rejects unknown or unusable scroll ranges: %j', state => {
    expect(() => normalizeFirstPartyControlSnapshot({ ...scrollControl(), state })).toThrow();
  });

  it.each(['press', 'scrollLeftPage', 'scrollRightStep', 'scrollLeftFraction', 'replaceText', 'insertText'])(
    'does not expand vertical conversation capability to %s', operation => {
      expect(() => normalizeFirstPartyControlSnapshot({ ...scrollControl(), operations: [operation] })).toThrow();
    });

  it.each(['press', 'scrollDownPage', 'scrollDownStep', 'scrollDownFraction'])('does not give the composer capability %s', operation => {
    expect(() => normalizeFirstPartyControlSnapshot({ ...textControl(), operations: [operation] })).toThrow();
  });

  it('rejects duplicate or extended control inventories', () => {
    expect(() => normalizeFirstPartyControlSnapshots([textControl(), textControl()])).toThrow();
    expect(() => normalizeFirstPartyControlSnapshots([textControl(), scrollControl(), textControl()])).toThrow();
    expect(() => normalizeFirstPartyControlSnapshots({ 0: textControl(), length: 1 })).toThrow();
  });

  it('rejects sparse, accessor, hidden, symbolic, extended and inherited inventories without executing getters', () => {
    const getter = vi.fn(textControl);
    const accessor = Object.defineProperty([textControl()], '0', { enumerable: true, get: getter });
    const hidden = Object.defineProperty([textControl()], '0', { enumerable: false, value: textControl() });
    const extended = Object.assign([textControl()], { registrationId: ids.registrationId });
    const symbolic = Object.assign([textControl()], { [Symbol('authority')]: true });
    const inherited = [textControl()];
    Object.setPrototypeOf(inherited, Object.create(Array.prototype));
    for (const input of [new Array(1), accessor, hidden, extended, symbolic, inherited]) {
      expect(() => normalizeFirstPartyControlSnapshots(input)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('first-party control command and receipt boundary', () => {
  it('carries full ownership, document, instance, revision, run and expiry binding', () => {
    for (const kind of ['observe', 'verify', 'dispatch'] as const) {
      expect(normalizeFirstPartyControlRequest(request(kind))).toEqual(request(kind));
    }
    const requestBody = request('dispatch');
    const normalized = normalizeFirstPartyControlRequest(requestBody);
    expect(normalized.context).not.toBe(requestBody.context);
    if (normalized.kind !== 'observe') expect(normalized.snapshot).not.toBe(requestBody.snapshot);
  });

  it.each(['snapshot', 'operation', 'text'])('rejects forbidden observe field %s even when undefined', field => {
    for (const value of [undefined, field === 'snapshot' ? textControl() : field === 'operation' ? 'insertText' : 'private-body']) {
      expect(() => normalizeFirstPartyControlRequest(request('observe', { [field]: value }))).toThrow();
    }
  });

  it('keeps verify read-only and forbids any text field', () => {
    for (const text of [undefined, '', 'private-body']) {
      expect(() => normalizeFirstPartyControlRequest(request('verify', { text }))).toThrow();
    }
  });

  it('requires explicit valid write text and permits an exact empty replacement', () => {
    const clear = request('dispatch', { operation: 'replaceText', text: '' });
    expect(normalizeFirstPartyControlRequest(clear)).toEqual(clear);
    for (const text of [undefined, '', '\0private-body', '\u202eprivate-body', '\ud800', 'a'.repeat(4097)]) {
      expect(() => normalizeFirstPartyControlRequest(request('dispatch', { text }))).toThrow();
    }
    const unicode = '😀'.repeat(4096);
    expect(normalizeFirstPartyControlRequest(request('dispatch', { text: unicode }))).toMatchObject({ text: unicode });
  });

  it('forbids any text body on a scroll request and refuses undeclared units', () => {
    const scroll = request('dispatch', { snapshot: scrollControl(), operation: 'scrollDownFraction' });
    delete scroll.text;
    expect(normalizeFirstPartyControlRequest(scroll)).toEqual(scroll);
    for (const text of [undefined, '', 'private-body']) {
      expect(() => normalizeFirstPartyControlRequest({ ...scroll, text })).toThrow();
    }
    expect(() => normalizeFirstPartyControlRequest({ ...scroll, snapshot: { ...scrollControl(), operations: ['scrollDownPage'] } })).toThrow();
  });

  it.each(['requestId', 'registrationId', 'documentGeneration', 'runId', 'context', 'expiresAt', 'kind'])(
    'rejects missing request binding %s', field => {
      const input = request('dispatch');
      delete input[field];
      expect(() => normalizeFirstPartyControlRequest(input)).toThrow();
    });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1800000000000', true])('rejects invalid expiry %j', expiresAt => {
    expect(() => normalizeFirstPartyControlRequest(request('observe', { expiresAt }))).toThrow();
  });

  it.each(['click', 'press', 'evaluate', 'script', 'AXPress', undefined, null])('rejects unsupported command kinds: %j', kind => {
    expect(() => normalizeFirstPartyControlRequest(request('dispatch', { kind }))).toThrow();
  });

  it('keeps unknown, rejected and applied outcomes distinct without adding retry instructions', () => {
    for (const status of ['verified', 'applied', 'rejected', 'unknown']) {
      const response = { ...token, requestId: ids.requestId, status };
      expect(normalizeFirstPartyControlResponse(response)).toEqual(response);
      expect(() => normalizeFirstPartyControlResponse({ ...response, retryAllowed: true })).toThrow();
      expect(() => normalizeFirstPartyControlResponse({ ...response, error: 'private-ui-data' })).toThrow();
      expect(() => normalizeFirstPartyControlResponse({ ...response, controls: undefined })).toThrow();
      expect(() => normalizeFirstPartyControlResponse({ ...response, controls: [] })).toThrow();
    }
    const observed = { ...token, requestId: ids.requestId, status: 'observed', controls: [textControl(), scrollControl()] };
    expect(normalizeFirstPartyControlResponse(observed)).toEqual(observed);
    expect(() => normalizeFirstPartyControlResponse({ ...token, requestId: ids.requestId, status: 'observed' })).toThrow();
    for (const status of ['success', 'pending', 'retry', 'commit_unknown', true, null]) {
      expect(() => normalizeFirstPartyControlResponse({ ...token, requestId: ids.requestId, status })).toThrow();
    }
  });
});

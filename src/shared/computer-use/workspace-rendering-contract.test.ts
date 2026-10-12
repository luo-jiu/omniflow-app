import { describe, expect, it, vi } from 'vitest';
import { normalizeWorkspaceRenderingRegistration, normalizeWorkspaceRenderingRegistrationToken } from './workspace-rendering-contract';

const instanceId = '11111111-1111-4111-8111-111111111111';
const input = { instanceId, ownerScope: { accountScope: 'qa-account', backendScope: 'qa-backend' }, libraryId: 3 };
const token = { registrationId: '22222222-2222-4222-8222-222222222222', documentGeneration: '33333333-3333-4333-8333-333333333333' };

describe('visible Workspace rendering contract', () => {
  it('normalizes ownership without requiring a Session or Run and copies caller-owned records', () => {
    const normalized = normalizeWorkspaceRenderingRegistration(input);
    expect(normalized).toEqual(input);
    expect(normalized).not.toBe(input);
    expect(normalized.ownerScope).not.toBe(input.ownerScope);
    expect(normalizeWorkspaceRenderingRegistrationToken(token)).toEqual(token);
  });

  it.each(['sessionId', 'runId', 'capture', 'input', 'pid', 'webContentsId', 'windowId', 'frameId'])(
    'refuses execution or transport fields: %s', field => {
      expect(() => normalizeWorkspaceRenderingRegistration({ ...input, [field]: true })).toThrow();
      expect(() => normalizeWorkspaceRenderingRegistrationToken({ ...token, [field]: true })).toThrow();
    });

  it.each([null, '', 1, true, '123', '00000000-0000-0000-0000-000000000000', '11111111-1111-4111-7111-111111111111'])(
    'rejects invalid opaque IDs without coercion: %j', value => {
      expect(() => normalizeWorkspaceRenderingRegistration({ ...input, instanceId: value })).toThrow();
      expect(() => normalizeWorkspaceRenderingRegistrationToken({ ...token, registrationId: value })).toThrow();
      expect(() => normalizeWorkspaceRenderingRegistrationToken({ ...token, documentGeneration: value })).toThrow();
    });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, '3', true])(
    'rejects invalid library IDs: %j', libraryId => {
      expect(() => normalizeWorkspaceRenderingRegistration({ ...input, libraryId })).toThrow();
    });

  it.each(['', 'private\0scope', 'private\nscope', 'private\u007fscope', 'private'.repeat(74), 1, null])(
    'rejects malformed owner scopes without echoing their contents: %j', value => {
      for (const field of ['accountScope', 'backendScope']) {
        let error: unknown;
        try { normalizeWorkspaceRenderingRegistration({ ...input, ownerScope: { ...input.ownerScope, [field]: value } }); }
        catch (caught) { error = caught; }
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain('private');
      }
    });

  it('requires every field and rejects nested extra fields', () => {
    for (const field of ['instanceId', 'ownerScope', 'libraryId']) {
      const missing = { ...input } as Record<string, unknown>;
      delete missing[field];
      expect(() => normalizeWorkspaceRenderingRegistration(missing)).toThrow();
    }
    expect(() => normalizeWorkspaceRenderingRegistration({ ...input, ownerScope: { accountScope: 'qa-account' } })).toThrow();
    expect(() => normalizeWorkspaceRenderingRegistration({ ...input, ownerScope: { ...input.ownerScope, sessionId: instanceId } })).toThrow();
    expect(() => normalizeWorkspaceRenderingRegistrationToken({ registrationId: token.registrationId })).toThrow();
  });

  it('rejects getters, hidden or symbolic fields and inherited records without executing accessors', () => {
    const getter = vi.fn(() => instanceId);
    const malformed = [
      Object.defineProperty({ ...input }, 'instanceId', { enumerable: true, get: getter }),
      Object.defineProperty({ ...input }, 'instanceId', { enumerable: false, value: instanceId }),
      { ...input, [Symbol('grant')]: true },
      Object.assign(Object.create(input), { libraryId: 3 }),
      { ...input, ownerScope: Object.defineProperty({ ...input.ownerScope }, 'accountScope', { enumerable: true, get: getter }) },
    ];
    for (const value of malformed) expect(() => normalizeWorkspaceRenderingRegistration(value)).toThrow();
    expect(() => normalizeWorkspaceRenderingRegistrationToken(Object.defineProperty({ ...token }, 'registrationId', { enumerable: true, get: getter }))).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(normalizeWorkspaceRenderingRegistration(Object.assign(Object.create(null), input))).toEqual(input);
  });
});

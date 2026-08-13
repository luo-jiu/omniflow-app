import { describe, expect, it } from 'vitest';
import {
  createDeviceViewerAccountScope,
  createUserViewerAccountScope,
  createViewerDraftKey,
  createViewerLiveInstanceKey,
  createViewerResourceKey,
  isViewerDraftKey,
  isViewerResourceKey,
  resolveViewerResourceIdentity,
  serializeViewerLiveDiagnosticKey,
  serializeViewerDraftKey,
  serializeViewerResourceKey,
} from './viewer-session-identity';
import { viewerSessionPolicies } from './viewer-session-policies';

describe('viewer session identity', () => {
  it('builds account-scoped node identities without using signed URLs', () => {
    const accountScope = createUserViewerAccountScope(42);
    const identity = createViewerResourceKey({
      accountScope: accountScope || '',
      libraryId: 7,
      nodeId: 99,
      viewerKind: 'pdf',
    });

    expect(accountScope).toBe('user:42');
    expect(identity).toEqual({
      accountScope: 'user:42',
      libraryId: 7,
      resourceIdentity: 'node:99',
      viewerKind: 'pdf',
    });
    expect(serializeViewerResourceKey(identity!)).toBe('["user:42",7,"node:99","pdf"]');
  });

  it('accepts opaque stable ids and rejects URLs or local paths as identities', () => {
    expect(resolveViewerResourceIdentity({ stableResourceId: 'sha256:abc-123' }))
      .toBe('stable:sha256:abc-123');
    expect(resolveViewerResourceIdentity({ stableResourceId: 'object:provider:item-1' }))
      .toBe('stable:object:provider:item-1');
    expect(resolveViewerResourceIdentity({ stableResourceId: 'https://example.com/file' }))
      .toBeNull();
    expect(resolveViewerResourceIdentity({ stableResourceId: 'blob:abc' })).toBeNull();
    expect(resolveViewerResourceIdentity({ stableResourceId: 'data:abc' })).toBeNull();
    expect(resolveViewerResourceIdentity({ stableResourceId: 'file:tmp' })).toBeNull();
    expect(resolveViewerResourceIdentity({ stableResourceId: 'custom:item-1' })).toBeNull();
    expect(resolveViewerResourceIdentity({ stableResourceId: '/tmp/private-file' }))
      .toBeNull();
  });

  it('rejects non-canonical resource keys at runtime boundaries', () => {
    const baseIdentity = {
      accountScope: 'user:1',
      libraryId: 1,
      resourceIdentity: 'node:1',
      viewerKind: 'pdf',
    };

    expect(isViewerResourceKey(baseIdentity)).toBe(true);
    expect(isViewerResourceKey({ ...baseIdentity, accountScope: 'user:01' })).toBe(false);
    expect(isViewerResourceKey({
      ...baseIdentity,
      accountScope: 'user:999999999999999999999',
    })).toBe(false);
    expect(isViewerResourceKey({ ...baseIdentity, resourceIdentity: 'node:0' })).toBe(false);
    expect(isViewerResourceKey({ ...baseIdentity, resourceIdentity: 'stable:blob:abc' })).toBe(false);
    expect(isViewerResourceKey({ ...baseIdentity, viewerKind: 'html' })).toBe(false);
  });

  it('requires valid runtime generations and explicit draft revisions', () => {
    const identity = createViewerResourceKey({
      accountScope: 'user:1',
      libraryId: 3,
      nodeId: 8,
      viewerKind: 'text',
    });

    const draftKey = createViewerDraftKey(identity!, 'etag:v2');
    expect(draftKey?.contentRevision).toBe('etag:v2');
    expect(isViewerDraftKey(draftKey)).toBe(true);
    expect(serializeViewerDraftKey(draftKey!)).toBe('["user:1",3,"node:8","text","etag:v2"]');
    expect(isViewerDraftKey({ ...draftKey, contentRevision: ' etag:v2' })).toBe(false);
    expect(createViewerDraftKey(identity!, '  ')).toBeNull();
    expect(createViewerLiveInstanceKey({
      runtimeSessionId: 'runtime-a',
      libraryId: 3,
      tabId: 'node:8',
      mountGeneration: 0,
    })).not.toBeNull();
    expect(createViewerLiveInstanceKey({
      runtimeSessionId: 'runtime-a',
      libraryId: 3,
      tabId: 'node:8',
      mountGeneration: -1,
    })).toBeNull();
    expect(resolveViewerResourceIdentity({ nodeId: 8.5 })).toBeNull();
  });

  it('keeps device scopes opaque and policies exhaustive at runtime', () => {
    expect(createDeviceViewerAccountScope('device_01')).toBe('device:device_01');
    expect(createDeviceViewerAccountScope('device/01')).toBeNull();
    expect(createDeviceViewerAccountScope('device:01')).toBeNull();
    expect(viewerSessionPolicies.text).toMatchObject({
      warm: 'memory',
      cold: 'device',
      closeBehavior: 'retain-reading-position',
      hasDraft: true,
    });
    expect(Object.keys(viewerSessionPolicies).sort()).toEqual([
      'asmr',
      'asmr_archive',
      'audio',
      'audio_archive',
      'comic',
      'comic_archive',
      'gallery',
      'gallery_archive',
      'image',
      'other',
      'pdf',
      'text',
      'video',
      'video_archive',
    ]);
  });

  it('uses resource identity instead of raw tab ids in live diagnostics', () => {
    const identity = createViewerResourceKey({
      accountScope: 'user:1',
      libraryId: 3,
      nodeId: 8,
      viewerKind: 'pdf',
    })!;
    const liveKey = createViewerLiveInstanceKey({
      runtimeSessionId: 'runtime-a',
      libraryId: 3,
      tabId: 'url:https://example.com/file?token=private',
      mountGeneration: 2,
    })!;

    const diagnosticKey = serializeViewerLiveDiagnosticKey(liveKey, identity);
    expect(diagnosticKey).toBe('["runtime-a","user:1",3,"node:8","pdf",2]');
    expect(diagnosticKey).not.toContain('example.com');
    expect(diagnosticKey).not.toContain('private');
  });
});

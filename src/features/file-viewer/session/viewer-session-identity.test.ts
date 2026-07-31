import { describe, expect, it } from 'vitest';
import {
  createDeviceViewerAccountScope,
  createUserViewerAccountScope,
  createViewerDraftKey,
  createViewerLiveInstanceKey,
  createViewerResourceKey,
  resolveViewerResourceIdentity,
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
    expect(resolveViewerResourceIdentity({ stableResourceId: 'https://example.com/file' }))
      .toBeNull();
    expect(resolveViewerResourceIdentity({ stableResourceId: '/tmp/private-file' }))
      .toBeNull();
  });

  it('requires valid runtime generations and explicit draft revisions', () => {
    const identity = createViewerResourceKey({
      accountScope: 'user:1',
      libraryId: 3,
      nodeId: 8,
      viewerKind: 'text',
    });

    expect(createViewerDraftKey(identity!, 'etag:v2')?.contentRevision).toBe('etag:v2');
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
});

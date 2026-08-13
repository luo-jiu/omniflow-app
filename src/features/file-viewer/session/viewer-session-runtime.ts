import { registerAuthSessionRuntime } from '@/service/auth-session-release';
import { runtimeLogger } from '@/utils/runtimeLogger';
import {
  createViewerResourceKey,
  createViewerLiveInstanceKey,
  createViewerRuntimeSessionId,
  serializeViewerResourceKey,
} from './viewer-session-identity';
import { ViewerSessionRegistry } from './viewer-session-registry';
import { viewerSessionColdStore } from './viewer-session-cold-store';
import { ViewerSessionColdRuntime } from './viewer-session-cold-runtime';
import type { ViewerResourceKey } from './viewer-session.types';
import { viewerSessionPolicies } from './viewer-session-policies';
import type { FileViewerFileType } from '@/shared/file-viewer-types';

export const viewerSessionRegistry = new ViewerSessionRegistry();
export const viewerSessionColdRuntime = new ViewerSessionColdRuntime(
  viewerSessionRegistry,
  viewerSessionColdStore,
);

interface ResourceReloadEntry {
  accountScope: string;
  libraryId: number;
  reloadToken: number;
}

function normalizeReloadToken(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export class ViewerSessionRuntime {
  private active = false;
  private readonly mountGenerations = new Map<string, number>();
  private readonly resourceReloadTokens = new Map<string, ResourceReloadEntry>();
  private runtimeSessionId = createViewerRuntimeSessionId();

  constructor(
    private readonly registry: ViewerSessionRegistry = viewerSessionRegistry,
    private readonly coldRuntime?: Pick<ViewerSessionColdRuntime, 'deleteResources'>,
  ) {}

  start = () => {
    if (this.active) return;
    this.active = true;
    this.runtimeSessionId = createViewerRuntimeSessionId();
    this.mountGenerations.clear();
    this.resourceReloadTokens.clear();
  };

  dispose = () => {
    this.registry.disposeSession();
    this.mountGenerations.clear();
    this.resourceReloadTokens.clear();
    if (!this.active) return;
    this.active = false;
    this.runtimeSessionId = createViewerRuntimeSessionId();
  };

  disposeLibrary(libraryId: number, accountScope?: string) {
    this.registry.disposeLibrary(libraryId, accountScope);
    this.resourceReloadTokens.forEach((entry, key) => {
      if (entry.libraryId !== libraryId) return;
      if (accountScope && entry.accountScope !== accountScope) return;
      this.resourceReloadTokens.delete(key);
    });
  }

  disposeResource(identity: ViewerResourceKey) {
    this.registry.disposeResource(identity, 'resource-closed');
    this.resourceReloadTokens.delete(serializeViewerResourceKey(identity));
    void this.coldRuntime?.deleteResources([identity]).catch((error: unknown) => {
      runtimeLogger.warn('delete discarded viewer Cold snapshot failed', { error });
    });
  }

  async disposeNodeResources(
    accountScope: string,
    libraryId: number,
    nodeIds: number[],
  ): Promise<void> {
    const viewerKinds = Object.keys(viewerSessionPolicies) as FileViewerFileType[];
    const identities = nodeIds.flatMap((nodeId) => viewerKinds.flatMap((viewerKind) => {
      const identity = createViewerResourceKey({
        accountScope,
        libraryId,
        nodeId,
        viewerKind,
      });
      return identity ? [identity] : [];
    }));
    identities.forEach((identity) => {
      this.registry.disposeResource(identity, 'node-deleted');
      this.resourceReloadTokens.delete(serializeViewerResourceKey(identity));
    });
    await this.coldRuntime?.deleteResources(identities);
  }

  createLiveInstanceKey(options: { libraryId: number; tabId: string }) {
    if (!this.active) return null;
    const slotKey = JSON.stringify([this.runtimeSessionId, options.libraryId, options.tabId]);
    const previous = this.mountGenerations.get(slotKey);
    const generation = previous == null ? 0 : previous + 1;
    const key = createViewerLiveInstanceKey({
      runtimeSessionId: this.runtimeSessionId,
      libraryId: options.libraryId,
      tabId: options.tabId,
      mountGeneration: generation,
    });
    if (key) {
      this.mountGenerations.set(slotKey, generation);
    }
    return key;
  }

  prepareResource(identity: ViewerResourceKey, reloadToken: number) {
    if (!this.active) return;
    const key = serializeViewerResourceKey(identity);
    const normalizedReloadToken = normalizeReloadToken(reloadToken);
    const previous = this.resourceReloadTokens.get(key);
    if (previous && previous.reloadToken !== normalizedReloadToken) {
      this.registry.invalidateSnapshot(identity, 'runtime-reload-generation-changed');
      void this.coldRuntime?.deleteResources([identity]).catch((error: unknown) => {
        runtimeLogger.warn('invalidate reloaded viewer Cold snapshot failed', { error });
      });
    }
    this.resourceReloadTokens.set(key, {
      accountScope: identity.accountScope,
      libraryId: identity.libraryId,
      reloadToken: normalizedReloadToken,
    });
  }

  getRuntimeSessionId() {
    return this.runtimeSessionId;
  }
}

export const viewerSessionRuntime = new ViewerSessionRuntime(
  viewerSessionRegistry,
  viewerSessionColdRuntime,
);

registerAuthSessionRuntime(viewerSessionRuntime);
registerAuthSessionRuntime(viewerSessionColdRuntime);

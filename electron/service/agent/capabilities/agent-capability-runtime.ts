import {
  resolveDesktopFfmpegPath,
  resolveDesktopFfprobePath,
} from '../../../platform/mediaExecutable';
import { createAgentCapabilityRegistry } from './agent-capability-registry';
import type {
  AgentCapabilityDefinition,
  AgentCapabilitySnapshotRequest,
} from './agent-capability.types';

export const AGENT_CAPABILITY_MEDIA_FFMPEG = 'media.ffmpeg' as const;
export const AGENT_CAPABILITY_MEDIA_FFPROBE = 'media.ffprobe' as const;

const MEDIA_CAPABILITY_TIMEOUT_MS = 2_000;
const MEDIA_CAPABILITY_CACHE_TTL_MS = 30_000;

export interface BuiltInAgentCapabilityDependencies {
  readonly resolveFfmpegPath?: () => Promise<string | null>;
  readonly resolveFfprobePath?: () => Promise<string | null>;
}

export function getBuiltInAgentCapabilityDefinitions(
  dependencies: BuiltInAgentCapabilityDependencies = {},
): AgentCapabilityDefinition[] {
  const resolveFfmpegPath = dependencies.resolveFfmpegPath || resolveDesktopFfmpegPath;
  const resolveFfprobePath = dependencies.resolveFfprobePath || resolveDesktopFfprobePath;
  return [
    {
      cacheTtlMs: MEDIA_CAPABILITY_CACHE_TTL_MS,
      id: AGENT_CAPABILITY_MEDIA_FFMPEG,
      async probe(context) {
        const executablePath = await resolveFfmpegPath();
        if (context.signal.aborted) throw new Error('aborted');
        return executablePath
          ? { state: 'available' }
          : { reasonCode: 'media.ffmpeg_not_found', state: 'unavailable' };
      },
      revision: 'builtin:media.ffmpeg@1',
      scope: 'machine',
      timeoutMs: MEDIA_CAPABILITY_TIMEOUT_MS,
    },
    {
      cacheTtlMs: MEDIA_CAPABILITY_CACHE_TTL_MS,
      id: AGENT_CAPABILITY_MEDIA_FFPROBE,
      async probe(context) {
        const executablePath = await resolveFfprobePath();
        if (context.signal.aborted) throw new Error('aborted');
        return executablePath
          ? { state: 'available' }
          : { reasonCode: 'media.ffprobe_not_found', state: 'unavailable' };
      },
      revision: 'builtin:media.ffprobe@1',
      scope: 'machine',
      timeoutMs: MEDIA_CAPABILITY_TIMEOUT_MS,
    },
  ];
}

export function createBuiltInAgentCapabilityRegistry(
  dependencies: BuiltInAgentCapabilityDependencies = {},
) {
  return createAgentCapabilityRegistry(getBuiltInAgentCapabilityDefinitions(dependencies));
}

export const builtInAgentCapabilityRegistry = createBuiltInAgentCapabilityRegistry();

export function createBuiltInAgentCapabilitySnapshot(
  request: AgentCapabilitySnapshotRequest,
) {
  return builtInAgentCapabilityRegistry.createSnapshot(request);
}

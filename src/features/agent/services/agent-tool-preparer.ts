import type { AgentToolPrepareRequest } from '@/shared/agent/agent.types';
import { fetchNodeDetailById } from '@/features/file-explorer/services/file.api';
import {
  fetchProviders,
  resolveTarget,
  testProvider,
} from '@/features/storage-config/services/storage-config.api';

interface MediaExtractAudioPrepareInput {
  fileSize: number;
  libraryId: number;
  mimeType?: string;
  nodeId: number;
  outputFormat: 'm4a' | 'mp3' | 'wav';
}

const OUTPUT_FORMATS = ['m4a', 'mp3', 'wav'] as const;
type OutputFormat = typeof OUTPUT_FORMATS[number];

function outputMimeType(format: OutputFormat): string {
  if (format === 'wav') return 'audio/wav';
  if (format === 'mp3') return 'audio/mpeg';
  return 'audio/mp4';
}

export interface AgentRendererToolPreparerDependencies {
  fetchNodeDetail?: typeof fetchNodeDetailById;
  listProviders?: typeof fetchProviders;
  resolveStorageTarget?: typeof resolveTarget;
  signal?: AbortSignal;
  verifyProvider?: typeof testProvider;
}

function abortError(): Error {
  const error = new Error('Agent Tool 准备已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function normalizeMediaExtractAudioPrepareInput(
  request: AgentToolPrepareRequest,
): MediaExtractAudioPrepareInput {
  if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) {
    throw new Error('音频提取准备参数无效');
  }
  const source = request.input as Record<string, unknown>;
  const libraryId = Number(source.libraryId);
  const nodeId = Number(source.nodeId);
  const fileSize = Number(source.fileSize || 0);
  const outputFormat = String(source.outputFormat || '').trim().toLowerCase();
  const mimeType = String(source.mimeType || '').trim() || undefined;
  if (
    !Number.isSafeInteger(libraryId)
    || libraryId <= 0
    || libraryId !== Number(request.appContext.libraryId)
    || !Number.isSafeInteger(nodeId)
    || nodeId <= 0
    || !Number.isFinite(fileSize)
    || fileSize < 0
    || (outputFormat !== 'm4a' && outputFormat !== 'mp3' && outputFormat !== 'wav')
  ) {
    throw new Error('音频提取准备参数无效');
  }
  return {
    fileSize,
    libraryId,
    ...(mimeType ? { mimeType } : {}),
    nodeId,
    outputFormat,
  };
}

export async function prepareAgentRendererTool(
  request: AgentToolPrepareRequest,
  dependencies: AgentRendererToolPreparerDependencies = {},
): Promise<unknown> {
  if (request.toolName !== 'media.extractAudio') {
    throw new Error(`不支持的 Renderer Agent Tool prepare：${request.toolName}`);
  }
  const input = normalizeMediaExtractAudioPrepareInput(request);
  const listProviders = dependencies.listProviders || fetchProviders;
  const fetchNodeDetail = dependencies.fetchNodeDetail || fetchNodeDetailById;
  const resolveStorageTarget = dependencies.resolveStorageTarget || resolveTarget;
  const verifyProvider = dependencies.verifyProvider || testProvider;
  throwIfAborted(dependencies.signal);

  try {
    const [providerData, nodeDetail] = await Promise.all([
      listProviders(),
      fetchNodeDetail(input.nodeId),
    ]);
    throwIfAborted(dependencies.signal);
    const providers = Array.isArray(providerData.providers) ? providerData.providers : [];
    const knownAliases = new Set(providers.map(provider => String(provider.alias || '').trim()));
    const sourceProvider = String(nodeDetail.storageProvider || '').trim();
    const inheritedAlias = knownAliases.has(sourceProvider) ? sourceProvider : '';
    const defaultAlias = String(providerData.defaultProvider || '').trim();
    const fallbackAlias = knownAliases.has(defaultAlias)
      ? defaultAlias
      : String(providers[0]?.alias || '').trim();
    if (inheritedAlias) {
      const inheritedHealthy = await verifyProvider(inheritedAlias)
        .then(result => result?.success === true)
        .catch(() => false);
      throwIfAborted(dependencies.signal);
      if (inheritedHealthy) {
        const provider = providers.find(item => item.alias === inheritedAlias);
        const binding = {
          providerAlias: inheritedAlias,
          providerLabel: String(provider?.label || inheritedAlias).trim().slice(0, 160),
        };
        return {
          providerBindings: Object.fromEntries(OUTPUT_FORMATS.map(format => [format, binding])),
        };
      }
    }
    const aliasesByFormat = new Map<OutputFormat, string[]>();
    await Promise.all(OUTPUT_FORMATS.map(async (format) => {
      let providerAlias = '';
      try {
        const routed = await resolveStorageTarget(
          input.fileSize,
          format,
          outputMimeType(format),
        );
        const routedAlias = String(routed.providerAlias || '').trim();
        if (knownAliases.has(routedAlias)) providerAlias = routedAlias;
      } catch {
        // The configured default remains the deterministic fallback for this format.
      }
      aliasesByFormat.set(
        format,
        Array.from(new Set([providerAlias, fallbackAlias].filter(Boolean))),
      );
    }));
    const uniqueAliases = Array.from(new Set(Array.from(aliasesByFormat.values()).flat()));
    const healthByAlias = new Map(await Promise.all(uniqueAliases.map(async alias => [
      alias,
      await verifyProvider(alias).then(result => result?.success === true).catch(() => false),
    ] as const)));
    throwIfAborted(dependencies.signal);
    const providerBindings = Object.fromEntries(OUTPUT_FORMATS.flatMap((format) => {
      const providerAlias = aliasesByFormat.get(format)
        ?.find(alias => healthByAlias.get(alias) === true);
      if (!providerAlias) return [];
      const provider = providers.find(item => item.alias === providerAlias);
      return [[format, {
        providerAlias,
        providerLabel: String(provider?.label || providerAlias).trim().slice(0, 160),
      }]];
    }));
    return {
      providerBindings,
    };
  } catch {
    throwIfAborted(dependencies.signal);
    return { providerBindings: {} };
  }
}

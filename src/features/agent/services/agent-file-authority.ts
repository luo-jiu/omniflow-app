import type {
  AgentFileAuthorityNodeSnapshotV1,
  AgentFileAuthorityRequestV1,
  AgentFileAuthorityResultV1,
} from '@/shared/agent/agent.types';
import {
  fetchNodeDetailById,
  getFileLink,
  type NodeDetailDTO,
} from '@/features/file-explorer/services/file.api';
import {
  fetchProviders,
  resolveTarget,
  testProvider,
} from '@/features/storage-config/services/storage-config.api';
import { auth } from '@/utils/auth';

function nodeSnapshot(detail: NodeDetailDTO): AgentFileAuthorityNodeSnapshotV1 {
  return {
    ...(detail.ext ? { ext: String(detail.ext).slice(0, 80) } : {}),
    fileSize: Math.max(0, Number(detail.fileSize || 0)),
    id: Number(detail.id),
    libraryId: Number(detail.libraryId),
    ...(detail.mimeType ? { mimeType: String(detail.mimeType).slice(0, 256) } : {}),
    name: String(detail.name || '').trim().slice(0, 512),
    parentId: Number(detail.parentId),
    ...(detail.storageKey ? { storageKey: String(detail.storageKey).slice(0, 2_048) } : {}),
    ...(detail.storageProvider
      ? { storageProvider: String(detail.storageProvider).slice(0, 256) }
      : {}),
    type: detail.type,
    ...(detail.updatedAt ? { updatedAt: String(detail.updatedAt).slice(0, 100) } : {}),
    version: 1,
  };
}

function fileExtension(fileName: string): string {
  const match = /\.([^.]+)$/u.exec(fileName);
  return String(match?.[1] || '').trim().slice(0, 80);
}

async function resolveHealthyProvider(request: Extract<
  AgentFileAuthorityRequestV1,
  { operation: 'publish-library-file' }
>): Promise<{ id: string; label: string }> {
  const providerData = await fetchProviders();
  const providers = Array.isArray(providerData.providers) ? providerData.providers : [];
  const byAlias = new Map(providers.map(provider => [String(provider.alias || '').trim(), provider]));
  const requested = String(request.providerId || '').trim();
  let routed = '';
  if (!requested) {
    routed = await resolveTarget(
      request.fileSize,
      fileExtension(request.fileName),
      String(request.contentType || 'application/octet-stream'),
    ).then(result => String(result.providerAlias || '').trim()).catch(() => '');
  }
  const candidates = Array.from(new Set([
    requested,
    routed,
    String(providerData.defaultProvider || '').trim(),
    String(providers[0]?.alias || '').trim(),
  ].filter(alias => alias && byAlias.has(alias))));
  for (const alias of candidates) {
    const healthy = await testProvider(alias)
      .then(result => result?.success === true)
      .catch(() => false);
    if (!healthy) continue;
    const provider = byAlias.get(alias);
    return {
      id: alias,
      label: String(provider?.label || alias).trim().slice(0, 160),
    };
  }
  throw new Error(requested ? '指定的存储服务当前不可用' : '没有可用的资料库存储服务');
}

export async function resolveAgentFileAuthority(
  request: AgentFileAuthorityRequestV1,
): Promise<AgentFileAuthorityResultV1> {
  if (request.operation === 'stage-library-node') {
    const detail = await fetchNodeDetailById(request.nodeId);
    if (
      detail.id !== request.nodeId
      || detail.libraryId !== request.libraryId
      || detail.type !== 'file'
      || !String(detail.name || '').trim()
      || !Number.isSafeInteger(Number(detail.fileSize))
      || Number(detail.fileSize) < 0
    ) {
      throw new Error('资料库来源文件已经变化或不可用');
    }
    return {
      ...(request.includeDownloadUrl
        ? { downloadUrl: await getFileLink(request.nodeId, request.libraryId, 60) }
        : {}),
      node: nodeSnapshot(detail),
      operation: request.operation,
      version: 1,
    };
  }

  const parentDetail = await fetchNodeDetailById(request.parentId);
  if (
    parentDetail.id !== request.parentId
    || parentDetail.libraryId !== request.libraryId
    || parentDetail.type !== 'dir'
    || !String(parentDetail.name || '').trim()
  ) {
    throw new Error('资料库目标目录已经变化或不可用');
  }
  const provider = await resolveHealthyProvider(request);
  const token = String(auth.getToken() || '').trim();
  const username = String(auth.getUsername() || '').trim();
  if (request.includeCredentials && (!token || !username)) {
    throw new Error('登录状态已失效，请重新登录');
  }
  return {
    ...(request.includeCredentials ? { credentials: { token, username } } : {}),
    operation: request.operation,
    parent: nodeSnapshot(parentDetail),
    providerId: provider.id,
    providerLabel: provider.label,
    version: 1,
  };
}

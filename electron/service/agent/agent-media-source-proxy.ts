import { getFileTransferDownloadUrlBroker } from '../fileTransferRuntime';

const AGENT_MEDIA_SOURCE_TTL_MS = 6 * 60 * 60 * 1_000;

export interface AgentMediaSourceProxy {
  release: () => void;
  url: string;
}

export function createAgentMediaSourceProxy(input: {
  fileName: string;
  mimeType?: string;
  sourceUrl: string;
}): AgentMediaSourceProxy {
  const broker = getFileTransferDownloadUrlBroker();
  if (!broker) throw new Error('本地媒体来源代理尚未就绪');
  const source = broker.createResolvedLoopbackSource(input, {
    ttlMs: AGENT_MEDIA_SOURCE_TTL_MS,
  });
  return {
    release: () => {
      broker.releaseClaim(source.claimId);
    },
    url: source.url,
  };
}

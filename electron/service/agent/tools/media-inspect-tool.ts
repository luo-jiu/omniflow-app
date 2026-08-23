import type { AgentTool } from '../agent-tool-registry';
import { buildAgentMediaFileName, resolveAgentMediaNode } from './media-tool-node';

export const mediaInspectTool: AgentTool = {
  assess() {
    return { behavior: 'allow', risk: 'read' };
  },
  createRendererRequest(input, context) {
    const node = resolveAgentMediaNode(input, context);
    return {
      fileName: buildAgentMediaFileName(node),
      libraryId: Number(context.appContext.libraryId),
      ...(node.mimeType ? { mimeType: node.mimeType } : {}),
      nodeId: node.id,
    };
  },
  description: '使用本机 ffprobe 读取当前可见单个媒体文件的容器、时长、码率以及音视频流信息。结果中的 codecProfile 表示编码档次（例如 AAC LC）。只返回清洗后的元数据，不返回文件内容或访问链接。',
  executor: 'renderer',
  inputSchema: {
    additionalProperties: false,
    properties: {
      nodeId: {
        description: '当前选中项或当前目录直属文件的节点 ID；只有一个选中节点时可以省略。',
        type: 'integer',
      },
    },
    type: 'object',
  },
  name: 'media.inspect',
  risk: 'read',
  timeoutMs: 60_000,
  validate(input, context) {
    const libraryId = Number(context.appContext.libraryId);
    if (!Number.isFinite(libraryId) || libraryId <= 0) {
      return { message: '当前没有可读取的资料库上下文', ok: false };
    }
    try {
      resolveAgentMediaNode(input, context);
      return { ok: true };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : '媒体节点无效',
        ok: false,
      };
    }
  },
};

export function getBuiltInMediaTools(): AgentTool[] {
  return [mediaInspectTool];
}

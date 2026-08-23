import type { AgentTool } from '../agent-tool-registry';

const MAX_DIRECTORY_NAME_LENGTH = 120;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INVALID_DIRECTORY_CHARACTERS = '<>:"/\\|?*';

function hasInvalidDirectoryCharacter(value: string): boolean {
  return Array.from(value).some(character => (
    character.charCodeAt(0) <= 0x1f || INVALID_DIRECTORY_CHARACTERS.includes(character)
  ));
}

export function normalizeAgentDirectoryName(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('创建文件夹需要提供名称');
  }
  const name = String((input as Record<string, unknown>).name || '').trim();
  if (!name) throw new Error('文件夹名称不能为空');
  if (name.length > MAX_DIRECTORY_NAME_LENGTH) {
    throw new Error(`文件夹名称不能超过 ${MAX_DIRECTORY_NAME_LENGTH} 个字符`);
  }
  if (name === '.' || name === '..' || hasInvalidDirectoryCharacter(name)) {
    throw new Error('文件夹名称包含无效字符');
  }
  if (/[. ]$/.test(name) || WINDOWS_RESERVED_NAME.test(name)) {
    throw new Error('文件夹名称不兼容 Windows 文件系统');
  }
  return name;
}

export const directoryCreateTool: AgentTool = {
  description: '在 OmniFlow 当前目录中创建一个文件夹。只接受文件夹名称，目标固定为当前目录；每次执行前必须由用户确认。',
  executor: 'renderer',
  inputSchema: {
    additionalProperties: false,
    properties: {
      name: {
        description: '要创建的文件夹名称，不包含路径。',
        maxLength: MAX_DIRECTORY_NAME_LENGTH,
        minLength: 1,
        type: 'string',
      },
    },
    required: ['name'],
    type: 'object',
  },
  name: 'directory.create',
  risk: 'write',
  timeoutMs: 30_000,
  validate(input, context) {
    try {
      normalizeAgentDirectoryName(input);
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : '文件夹名称无效',
        ok: false,
      };
    }
    const libraryId = Number(context.appContext.libraryId);
    const parentId = Number(context.appContext.currentDirectory?.id);
    if (!Number.isFinite(libraryId) || libraryId <= 0 || !Number.isFinite(parentId) || parentId <= 0) {
      return { message: '当前没有可写入的目录上下文', ok: false };
    }
    return { ok: true };
  },
  assess(input, context) {
    const name = normalizeAgentDirectoryName(input);
    const directoryName = String(context.appContext.currentDirectory?.name || '当前目录');
    return {
      behavior: 'ask',
      preview: {
        description: `将在“${directoryName}”中创建文件夹“${name}”。`,
        details: [
          { label: '位置', value: directoryName },
          { label: '名称', value: name },
        ],
        risk: 'write',
        title: '创建文件夹',
      },
      risk: 'write',
    };
  },
  createRendererRequest(input, context) {
    return {
      conflictPolicy: 'error',
      libraryId: Number(context.appContext.libraryId),
      name: normalizeAgentDirectoryName(input),
      parentId: Number(context.appContext.currentDirectory?.id),
    };
  },
};

export function getBuiltInActionTools(): AgentTool[] {
  return [directoryCreateTool];
}

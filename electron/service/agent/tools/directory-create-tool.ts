import type { AgentTool } from '../agent-tool-registry';
import { fileWriteTool } from './file-write-tool';
import { fileDeleteTool } from './file-delete-tool';
import { libraryActionTools } from './library-action-tools';
import { getAgentTagTools } from './tag-tools';
import { normalizeAgentLibraryAction } from '../../../../src/shared/agent/agent-library-actions';
import { libraryBatchTool } from './library-batch-tool';
import { nodeConfigureTool } from './node-configure-tool';

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
  description: '在资料库创建文件夹。提供完整新目录path，或name加parentPath/parentId指定父目录；仅提供name时使用当前目录，无当前目录则使用根目录。父目录须已存在，多级目录逐级创建。冲突默认error，可选择auto_rename，不覆盖。',
  executor: 'renderer',
  inputSchema: {
    additionalProperties: false,
    properties: {
      path: { type: 'string', minLength: 2, maxLength: 2048 },
      parentPath: { type: 'string', minLength: 1, maxLength: 2048 },
      parentId: { type: 'integer', minimum: 1 },
      conflictPolicy: { type: 'string', enum: ['error', 'auto_rename'] },
      name: {
        description: '要创建的文件夹名称，不包含路径。',
        maxLength: MAX_DIRECTORY_NAME_LENGTH,
        minLength: 1,
        type: 'string',
      },
    },
    oneOf: [{ properties: { name: {} }, required: ['name'] }, { properties: { path: {} }, required: ['path'] }],
    type: 'object',
  },
  name: 'directory.create',
  risk: 'write',
  timeoutMs: 30_000,
  validate(input, context) {
    try {
      normalizeAgentLibraryAction('directory.create', input);
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : '文件夹名称无效',
        ok: false,
      };
    }
    const libraryId = Number(context.appContext.libraryId);
    if (!Number.isSafeInteger(libraryId) || libraryId <= 0) {
      return { message: '当前没有可写入的资料库上下文', ok: false };
    }
    return { ok: true };
  },
  assess(input, context) {
    const query = normalizeAgentLibraryAction('directory.create', input);
    const name = query.name!;
    const directoryName = query.parentPath || (query.parentId ? `目录 ${query.parentId}` : context.appContext.currentDirectory?.name || '根目录');
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
    const query = normalizeAgentLibraryAction('directory.create', input);
    return {
      ...query,
      conflictPolicy: query.conflictPolicy || 'error',
      libraryId: Number(context.appContext.libraryId),
      ...(query.parentPath || query.parentId ? {} : context.appContext.currentDirectory?.id
        ? { parentId: context.appContext.currentDirectory.id } : { parentPath: '/' }),
    };
  },
};

export function getBuiltInActionTools(): AgentTool[] {
  return [directoryCreateTool, nodeConfigureTool, fileWriteTool, fileDeleteTool, ...libraryActionTools, ...getAgentTagTools(), libraryBatchTool];
}

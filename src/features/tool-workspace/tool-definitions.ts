export const BUILT_IN_TOOL_DEFINITIONS = [
  { id: 'ai-services', title: 'AI 服务配置', icon: 'claude' },
  { id: 'qqmusic-lyrics', title: 'QQ 音乐歌词', icon: 'music' },
  { id: 'subtitle-translation', title: 'AI 字幕翻译', icon: 'subtitle' },
  { id: 'media-file-processing', title: '媒体文件处理', icon: 'video' },
  { id: 'media-processing', title: '资源捕获处理', icon: 'capture' },
] as const;
export const TOOL_WORKSPACE_TOOL_IDS = Object.freeze(BUILT_IN_TOOL_DEFINITIONS.map(tool => tool.id));
export type BuiltInToolId = typeof BUILT_IN_TOOL_DEFINITIONS[number]['id'];
export type ToolWorkspaceToolId = BuiltInToolId | `${string}.${string}`;

export function isStoredToolId(value: unknown): value is ToolWorkspaceToolId {
  return typeof value === 'string' && (TOOL_WORKSPACE_TOOL_IDS.includes(value as BuiltInToolId)
    || (value.length <= 128 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value)));
}

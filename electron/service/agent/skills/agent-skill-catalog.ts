import type { AgentSkillDefinitionV1 } from './agent-skill.types';

/**
 * The first built-in Skill stays deliberately narrow.  It is a recipe for
 * composing the existing media Tools, not a second media executor.
 */
export const mediaExtractAudioSkill: AgentSkillDefinitionV1 = Object.freeze({
  description: '从一个明确的音视频文件中提取音轨，并把结果保存到当前目录。',
  id: 'media-extract-audio',
  instructions: [
    '只在用户明确要求从一个音视频文件提取音轨时使用本流程。',
    '先从当前感知中的选中节点和目录直属条目解析唯一输入；只有现有事实不足时才补充调用 file.list 或 file.stat，不要重复读取已经明确的节点。',
    '调用 media.inspect 确认目标是文件且包含音频流，不要只根据扩展名推断。',
    '目标缺失、存在多个候选，或用户明确要求了 m4a、mp3、wav 之外的格式时，使用 interaction.request 补齐必要信息；不要猜测 nodeId、路径或覆盖策略。',
    '调用 media.extractAudio 执行提取。输出格式仅使用 m4a、mp3 或 wav；用户未指定时直接使用 m4a，不为已有安全默认值额外询问。该 Tool 的确认、写入和错误边界由运行时处理。',
    '执行成功后根据 Tool 返回的节点事实，并在必要时重新用 file.list 或 file.stat 感知当前目录，确认输出条目后再向用户报告结果。',
    '不要直接运行 ffmpeg，不要访问本地路径或 URL，不要递归扫描目录，不要把文件夹当作媒体文件，也不要绕过 Tool 的权限和确认。',
  ].join('\n'),
  optionalTools: Object.freeze([
    'interaction.request',
  ]),
  requiredTools: Object.freeze([
    'file.list',
    'file.stat',
    'media.inspect',
    'media.extractAudio',
  ]),
  source: 'built-in',
  toolAllowlist: Object.freeze([
    'file.list',
    'file.stat',
    'media.inspect',
    'interaction.request',
    'media.extractAudio',
  ]),
  version: '1.0.0',
  whenToUse: '用户要求从当前已打开或选中的单个音视频文件提取音频时。',
});

const BUILT_IN_AGENT_SKILLS: readonly AgentSkillDefinitionV1[] = Object.freeze([
  mediaExtractAudioSkill,
]);

/** Return a fresh array so callers cannot mutate the catalog projection. */
export function getBuiltInAgentSkills(): AgentSkillDefinitionV1[] {
  return BUILT_IN_AGENT_SKILLS.map(skill => ({
    ...skill,
    optionalTools: [...skill.optionalTools],
    requiredTools: [...skill.requiredTools],
    toolAllowlist: [...skill.toolAllowlist],
  }));
}

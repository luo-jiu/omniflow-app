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
    '先用 file.list 读取当前目录；再用 file.stat 确认唯一的目标文件和类型，必要时用 media.inspect 检查媒体流。',
    '目标缺失、存在多个候选或输出格式未说明时，先用 interaction.request 询问；不要猜测 nodeId、路径或覆盖策略。',
    '调用 media.extractAudio 执行提取。输出格式仅使用 m4a、mp3 或 wav；未指定时使用 m4a。该 Tool 的确认、写入和错误边界由运行时处理。',
    '执行成功后重新用 file.list 或 file.stat 感知当前目录，确认输出条目，再向用户报告结果。',
    '不要直接运行 ffmpeg，不要访问本地路径或 URL，不要递归扫描目录，不要把文件夹当作媒体文件，也不要绕过 Tool 的权限和确认。',
  ].join('\n'),
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
    toolAllowlist: [...skill.toolAllowlist],
  }));
}


import type { AgentSkillDefinitionV1 } from './agent-skill.types';

/**
 * The first built-in Skill stays deliberately narrow.  It is a recipe for
 * composing the existing media Tools, not a second media executor.
 */
export const mediaExtractAudioSkill: AgentSkillDefinitionV1 = Object.freeze({
  description: '从一个明确的音视频文件中提取音轨，并保存到用户指定的资料库目录，缺省使用当前目录。',
  id: 'media-extract-audio',
  instructions: [
    '激活后立即在当前 Run 继续以下步骤，不要仅报告流程已加载，也不要要求用户再发送开始或重复授权。',
    '只在用户明确要求从一个音视频文件提取音轨时使用本流程。',
    '先从选中项或已经查询到的节点确定唯一输入；位置不明可用 file.search，完整资料库路径可用 file.resolve，旧节点信息可用 file.stat 刷新。不要重复读取已经明确的节点，不要求用户先展开 UI 目录。',
    '调用 media.inspect 确认目标是文件且包含音频流，不要只根据扩展名推断。',
    '用户指定 /音乐 等目标路径时，直接将 directoryPath 交给 media.extractAudio，由运行时精确解析和复验；也可使用已查询到的 parentId。不能因为不是当前目录而改成本机暂存、Shell 提取再发布。目标不存在时明确说明，不擅自创建。',
    '目标缺失、存在多个候选，或用户明确要求了 m4a、mp3、wav 之外的格式时，使用 interaction.request 补齐必要信息；不要猜测 nodeId、路径或覆盖策略。',
    '调用 media.extractAudio 执行提取，默认 destination=library 保存当前资料库目录；本机更合适或用户指定时可以选择 local。输出格式仅使用 m4a、mp3 或 wav；用户未指定时直接使用 m4a，不为已有安全默认值额外询问。确认由运行时权限处理，不要重复索取授权。源文件不可达时不能靠改变保存位置继续提取。',
    '执行成功后根据 Tool 返回的节点事实，并在必要时重新用 file.list 或 file.stat 感知当前目录，确认输出条目后再向用户报告结果。',
    '优先使用内置媒体流程；内置能力不适合时，可使用本 Run 已提供的 shell.run 和文件桥作为备选，不把内部优先当成禁止本机操作。不要猜测访问链接，不要把文件夹当作媒体文件；来源检查、权限与一次性执行约束对备选方案同样有效。',
  ].join('\n'),
  optionalTools: Object.freeze([
    'file.search', 'file.resolve',
    'interaction.request',
    'shell.run', 'file.stage', 'file.publish', 'file.upload',
  ]),
  requiredTools: Object.freeze([
    'file.list',
    'file.stat',
    'media.inspect',
    'media.extractAudio',
  ]),
  source: 'built-in',
  toolAllowlist: Object.freeze([
    'file.search', 'file.resolve',
    'file.list',
    'file.stat',
    'media.inspect',
    'interaction.request',
    'media.extractAudio',
    'shell.run', 'file.stage', 'file.publish', 'file.upload',
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

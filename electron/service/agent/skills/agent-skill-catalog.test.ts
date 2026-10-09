import { describe, expect, it } from 'vitest';

import { estimateAgentTextTokens } from '../agent-context-projection';
import { projectAgentToolResultForProvider } from '../agent-tool-result-projection';
import { getBuiltInAgentSkills, mediaExtractAudioSkill, resourceOrganizationSkill } from './agent-skill-catalog';
import {
  createAgentSkillRegistry,
  serializeAgentSkillActivationEnvelope,
} from './agent-skill-registry';

describe('built-in Agent Skill catalog', () => {
  it('contains media extraction and independently readable resource knowledge', () => {
    expect(getBuiltInAgentSkills()).toEqual([mediaExtractAudioSkill, resourceOrganizationSkill]);
    expect(resourceOrganizationSkill.requiredTools).toEqual([]);
    expect(resourceOrganizationSkill.optionalTools).toContain('node.configure');
    expect(mediaExtractAudioSkill.requiredTools).toEqual([
      'file.list',
      'file.stat',
      'media.inspect',
      'media.extractAudio',
    ]);
    expect(mediaExtractAudioSkill.optionalTools).toEqual([
      'file.search', 'file.resolve',
      'interaction.request',
      'file.delete',
      'shell.run', 'file.stage', 'file.publish', 'file.upload',
    ]);
    expect(mediaExtractAudioSkill.version).toBe('2.0.0');
    expect(mediaExtractAudioSkill).not.toHaveProperty('toolAllowlist');
    expect(mediaExtractAudioSkill.instructions).not.toMatch(/ffmpeg\s*[/：:]/iu);
    expect(mediaExtractAudioSkill.instructions).toContain('重新用 file.list 或 file.stat');
    expect(mediaExtractAudioSkill.instructions).toContain('继续完成完整目标');
    expect(mediaExtractAudioSkill.instructions).toContain('只有用户明确要求删除资料库源文件');
    expect(mediaExtractAudioSkill.instructions).toContain('提取成功、输出保存已核对后');
    expect(mediaExtractAudioSkill.instructions).toContain('提取失败、取消或保存结果未知时保留源文件');
  });

  it.each(getBuiltInAgentSkills())('$id fits the summary and activation budgets without truncation', skill => {
    const registry = createAgentSkillRegistry({
      estimateTokens: estimateAgentTextTokens,
      maxSummaryTokens: 256,
      maxActivationTokens: 10_000,
      toolExists: () => true,
    });
    expect(() => registry.register(skill)).not.toThrow();
    const snapshot = registry.createRunSnapshot();
    expect(snapshot.catalogTruncated).toBe(false);
    const envelope = snapshot.getActivationEnvelope(skill.id);
    expect(envelope).not.toBeNull();
    expect(serializeAgentSkillActivationEnvelope(envelope!)).not.toContain('undefined');
    const projection = projectAgentToolResultForProvider({
      data: envelope,
      message: `已加载 Skill ${envelope!.skillId}（${envelope!.version}）`,
      ok: true,
    }, 10_000);
    expect(projection.truncated).toBe(false);
  });

  it('returns an isolated definition projection for callers', () => {
    const skills = getBuiltInAgentSkills();
    (skills[0].requiredTools as string[])[0] = 'unexpected.tool';
    (skills[0].optionalTools as string[])[0] = 'unexpected.tool';
    expect(getBuiltInAgentSkills()[0].requiredTools[0]).toBe('file.list');
    expect(getBuiltInAgentSkills()[0].optionalTools[0]).toBe('file.search');
  });
});

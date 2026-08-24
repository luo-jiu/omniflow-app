import { describe, expect, it } from 'vitest';

import { estimateAgentTextTokens } from '../agent-context-projection';
import { projectAgentToolResultForProvider } from '../agent-tool-result-projection';
import { getBuiltInAgentSkills, mediaExtractAudioSkill } from './agent-skill-catalog';
import {
  createAgentSkillRegistry,
  serializeAgentSkillActivationEnvelope,
} from './agent-skill-registry';

describe('built-in Agent Skill catalog', () => {
  it('contains one narrow media extraction recipe with existing Tool names', () => {
    expect(getBuiltInAgentSkills()).toEqual([mediaExtractAudioSkill]);
    expect(mediaExtractAudioSkill.toolAllowlist).toEqual([
      'file.list',
      'file.stat',
      'media.inspect',
      'interaction.request',
      'media.extractAudio',
    ]);
    expect(mediaExtractAudioSkill.instructions).not.toMatch(/ffmpeg\s*[/：:]/iu);
    expect(mediaExtractAudioSkill.instructions).toContain('重新用 file.list 或 file.stat');
  });

  it('fits the activation result budget used by the registry', () => {
    const registry = createAgentSkillRegistry({
      estimateTokens: estimateAgentTextTokens,
      maxSummaryTokens: 256,
      maxActivationTokens: 1_024,
      toolExists: () => true,
    });
    expect(() => registry.register(mediaExtractAudioSkill)).not.toThrow();
    const snapshot = registry.createRunSnapshot();
    const envelope = snapshot.getActivationEnvelope(mediaExtractAudioSkill.id);
    expect(envelope).not.toBeNull();
    expect(serializeAgentSkillActivationEnvelope(envelope!)).not.toContain('undefined');
    const projection = projectAgentToolResultForProvider({
      data: envelope,
      message: `已加载 Skill ${envelope!.skillId}（${envelope!.version}）`,
      ok: true,
    }, 1_024);
    expect(projection.truncated).toBe(false);
  });

  it('returns an isolated definition projection for callers', () => {
    const skills = getBuiltInAgentSkills();
    const mutableAllowlist = skills[0].toolAllowlist as unknown as string[];
    mutableAllowlist[0] = 'unexpected.tool';
    expect(getBuiltInAgentSkills()[0].toolAllowlist[0]).toBe('file.list');
  });
});

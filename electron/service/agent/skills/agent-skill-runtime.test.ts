import { describe, expect, it } from 'vitest';

import { createAgentRunCapabilitySnapshot } from '../agent-run-capability-snapshot';
import { createAgentCapabilitySnapshot } from '../capabilities/agent-capability-registry';
import { agentToolRegistry } from '../agent-tool-registry';
import { fileListTool, fileStatTool } from '../tools/file-read-tools';
import { interactionRequestTool } from '../tools/interaction-request-tool';
import { mediaExtractAudioTool } from '../tools/media-extract-audio-tool';
import { mediaInspectTool } from '../tools/media-inspect-tool';
import {
  builtInAgentSkillRegistry,
  ensureBuiltInAgentCapabilities,
} from './agent-skill-runtime';
import {
  AGENT_SKILL_ACTIVATE_TOOL_NAME,
  AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID,
} from './agent-skill.types';

describe('built-in Agent Skill runtime', () => {
  it('registers the control Tool and validated built-in catalog idempotently', () => {
    [
      fileListTool,
      fileStatTool,
      mediaInspectTool,
      interactionRequestTool,
      mediaExtractAudioTool,
    ].forEach((tool) => {
      if (!agentToolRegistry.get(tool.name)) agentToolRegistry.register(tool);
    });

    expect(() => ensureBuiltInAgentCapabilities()).not.toThrow();
    expect(() => ensureBuiltInAgentCapabilities()).not.toThrow();

    expect(agentToolRegistry.get(AGENT_SKILL_ACTIVATE_TOOL_NAME)).toMatchObject({
      kind: 'control',
      registrationId: AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID,
    });
    expect(builtInAgentSkillRegistry.get('media-extract-audio')).toMatchObject({
      id: 'media-extract-audio',
      source: 'built-in',
    });

    const runSnapshot = createAgentRunCapabilitySnapshot({
      capabilitySnapshot: createAgentCapabilitySnapshot({
        entries: [
          {
            checkedAt: 1,
            definitionRevision: 'builtin:media.ffmpeg@1',
            id: 'media.ffmpeg',
            scopeIdentity: 'machine',
            state: 'available',
          },
          {
            checkedAt: 1,
            definitionRevision: 'builtin:media.ffprobe@1',
            id: 'media.ffprobe',
            scopeIdentity: 'machine',
            state: 'available',
          },
        ],
        registryRevision: 2,
      }),
      skillSnapshot: builtInAgentSkillRegistry.createRunSnapshot(),
      toolSnapshot: agentToolRegistry.createSnapshot(),
    });
    expect(runSnapshot.getSkillSummary('media-extract-audio')).toMatchObject({
      id: 'media-extract-audio',
    });
    expect(runSnapshot.getSkillActivationEnvelope('media-extract-audio')).toMatchObject({
      skillId: 'media-extract-audio',
    });
  });
});

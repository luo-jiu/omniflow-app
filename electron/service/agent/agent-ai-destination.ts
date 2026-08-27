import crypto from 'node:crypto';

import type { AIServiceRuntimeConnection } from '../aiServiceClientModel';

const MAX_MODEL_BYTES = 512;
const MAX_PROFILE_ID_BYTES = 256;
const MAX_PROFILE_LABEL_BYTES = 512;
const MAX_PROVIDER_TYPE_BYTES = 128;
const MAX_REVISION_BYTES = 256;

export interface AgentRuntimeProfile extends AIServiceRuntimeConnection {
  readonly configurationRevision?: string;
  readonly id?: string;
  readonly name?: string;
}

/** Credential-free AI destination captured from the main-owned active Run connection. */
export interface AgentToolMainAiDestinationSnapshot {
  readonly configurationIdentity: string;
  readonly identity: string;
  readonly model: string;
  readonly profileId: string;
  readonly profileLabel: string;
  readonly providerType: string;
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function boundedText(input: unknown, label: string, maximumBytes: number): string {
  const value = String(input ?? '').trim();
  if (!value || value.includes('\0') || utf8Length(value) > maximumBytes) {
    throw new Error(`${label}无效`);
  }
  return value;
}

function identity(domain: string, value: unknown): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify([
    domain,
    value,
  ])).digest('hex');
  return `v1:${digest}`;
}

export function createAgentAiDestinationSnapshot(input: {
  model: string;
  profileId: string;
  runtimeConnection: AgentRuntimeProfile;
}): AgentToolMainAiDestinationSnapshot {
  const model = boundedText(input.model, 'Agent AI 模型', MAX_MODEL_BYTES);
  const profileId = boundedText(input.profileId, 'Agent AI 配置 ID', MAX_PROFILE_ID_BYTES);
  const resolvedProfileId = boundedText(
    input.runtimeConnection.id || profileId,
    'Agent AI 运行配置 ID',
    MAX_PROFILE_ID_BYTES,
  );
  if (resolvedProfileId !== profileId) throw new Error('Agent AI 配置与当前 Run 不匹配');
  const profileLabel = boundedText(
    input.runtimeConnection.name || profileId,
    'Agent AI 配置名称',
    MAX_PROFILE_LABEL_BYTES,
  );
  const providerType = boundedText(
    input.runtimeConnection.providerType,
    'Agent AI Provider',
    MAX_PROVIDER_TYPE_BYTES,
  );
  const fallbackConfigurationRevision = identity(
    'omniflow.agent.ai-destination-unversioned-credential-v1',
    {
      apiKey: String(input.runtimeConnection.apiKey || ''),
      profileId,
    },
  );
  const configurationRevision = boundedText(
    input.runtimeConnection.configurationRevision || fallbackConfigurationRevision,
    'Agent AI 配置 revision',
    MAX_REVISION_BYTES,
  );
  const baseUrl = boundedText(
    input.runtimeConnection.baseUrl,
    'Agent AI Base URL',
    2_048,
  ).replace(/\/+$/u, '');
  const configurationIdentity = identity('omniflow.agent.ai-destination-config-v1', {
    baseUrl,
    configurationRevision,
    profileId,
    providerType,
  });
  return Object.freeze({
    configurationIdentity,
    identity: identity('omniflow.agent.ai-destination-v1', {
      configurationIdentity,
      model,
    }),
    model,
    profileId,
    profileLabel,
    providerType,
  });
}

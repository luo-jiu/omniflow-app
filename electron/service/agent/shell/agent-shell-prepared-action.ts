import crypto from 'node:crypto';

import {
  type AgentShellPreparedActionPublicV1,
  normalizeAgentShellPreparedActionPublicV1,
} from '../../../../src/shared/agent/shell/agent-shell.types';

export type AgentShellPreparedActionSealInputV1 = Omit<
  AgentShellPreparedActionPublicV1,
  'commandHash'
>;

function strictPlainObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Agent Shell prepared action seal 输入无效');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Agent Shell prepared action seal 输入无效');
  }
  return input as Record<string, unknown>;
}

export function createAgentShellCommandHash(command: string): string {
  if (typeof command !== 'string') throw new Error('Agent Shell command 无效');
  const digest = crypto.createHash('sha256').update(command, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

function commandHashesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'ascii');
  const rightBytes = Buffer.from(right, 'ascii');
  return leftBytes.byteLength === rightBytes.byteLength
    && crypto.timingSafeEqual(leftBytes, rightBytes);
}

export function validateAgentShellPreparedActionCommandHashV1(
  input: unknown,
): AgentShellPreparedActionPublicV1 {
  const normalized = normalizeAgentShellPreparedActionPublicV1(input);
  const expectedHash = createAgentShellCommandHash(normalized.command);
  if (!commandHashesEqual(normalized.commandHash, expectedHash)) {
    throw new Error('Agent Shell prepared action command hash 不匹配');
  }
  return normalized;
}

export function sealAgentShellPreparedActionPublicV1(
  input: AgentShellPreparedActionSealInputV1,
): AgentShellPreparedActionPublicV1 {
  const source = strictPlainObject(input);
  if (Object.prototype.hasOwnProperty.call(source, 'commandHash')) {
    throw new Error('Agent Shell prepared action command hash 必须由 main 生成');
  }
  if (typeof source.command !== 'string') throw new Error('Agent Shell command 无效');
  return validateAgentShellPreparedActionCommandHashV1({
    ...source,
    commandHash: createAgentShellCommandHash(source.command),
  });
}

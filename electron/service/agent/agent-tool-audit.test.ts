import { describe, expect, it } from 'vitest';

import { createAgentComputerTextAuditSourceResolver, isAgentComputerTextLegacyAuditName,
  projectAgentComputerTextInput, projectAgentComputerTextPreview, projectAgentComputerTextResult,
  projectAgentToolAuditInput } from './agent-tool-audit';
import type { AgentComputerSetTextPreparedActionPublicV1 } from '../../../src/shared/agent/agent.types';

const trustedTextTool = { name: 'computer.setText', registrationId: 'builtin:computer.setText@1',
  executor: 'main' as const, kind: 'business' as const, risk: 'write', prepareMain: async () => undefined };
const textInput = { observationId: '83fc584b-037d-4c82-8883-a609846ea0d4',
  elementId: '805f4b48-ec6e-4f78-b45b-e01f10bb247e', mode: 'replace' as const, text: '中🪟a' };
const textAction: AgentComputerSetTextPreparedActionPublicV1 = {
  kind: 'computer.setText', version: 1, libraryId: 3, targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce',
  applicationLabel: 'OmniFlow', windowLabel: 'QA', observationId: textInput.observationId,
  elementId: textInput.elementId, mode: 'replace', textLength: 3, textBytes: 8,
};

describe('Agent Tool audit projection', () => {
  it('freezes directed text privacy for canonical and provider names and projects only public text counts', () => {
    const inputTool = { ...trustedTextTool, name: 'computer.input', registrationId: 'builtin:computer.input@1' };
    const registrations = new Map([[inputTool.name, inputTool]]);
    const resolve = createAgentComputerTextAuditSourceResolver({ get: name => registrations.get(name) || null });
    registrations.clear();
    const input = { observationId: textInput.observationId, operation: 'typeText', text: textInput.text,
      title: textInput.text, nested: { text: textInput.text } };
    for (const name of ['computer.input', 'computer_input']) {
      const projected = projectAgentToolAuditInput(input, resolve(name));
      expect(projected).toMatchObject({ complete: true, sensitive: false, input: {
        observationId: textInput.observationId, operation: 'typeText', textLength: 3, textBytes: 8 } });
      expect(JSON.stringify(projected)).not.toContain(textInput.text);
      expect(projected.input).not.toHaveProperty('title');
      expect(projectAgentComputerTextInput(projected.input)).toEqual(projected.input);
    }
    expect(projectAgentToolAuditInput({ observationId: textInput.observationId, operation: 'click', point: { x: 1, y: 2 } }, resolve('computer.input')).input)
      .toEqual({ observationId: textInput.observationId, operation: 'click', point: { x: 1, y: 2 } });
    expect(JSON.stringify(projectAgentToolAuditInput({ ...input, operation: 'click' }, resolve('computer.input')))).not.toContain(textInput.text);
  });

  it('preserves only the directed text receipt identity and release settlement without exposing text or native errors', () => {
    const { elementId: _element, mode: _mode, ...identity } = textAction; void _element; void _mode;
    const action = { ...identity, kind: 'computer.input' as const, operation: 'typeText' as const };
    for (const state of ['dispatched', 'not-dispatched', 'unknown'] as const) {
      const mutationCommitState = state === 'dispatched' ? 'committed' : state === 'not-dispatched' ? 'uncommitted' : 'commit_unknown';
      const receipt = { ok: state === 'dispatched', message: textInput.text, data: { ...action, operation: 'computer.input', inputOperation: 'typeText',
        operationId: textInput.elementId, dispatchState: state, mutationCommitState, inputMethod: 'CGEventPostToPid',
        releaseState: state === 'not-dispatched' ? 'not-required' : 'confirmed', eventCount: 2,
        nextAction: 'observe', retryAllowed: false, text: textInput.text, privateTextHash: 'secret' } };
      const projected = projectAgentComputerTextResult(receipt, action);
      expect(projected).toMatchObject({ ok: receipt.ok, data: { operation: 'computer.input', inputOperation: 'typeText',
        textLength: 3, textBytes: 8, dispatchState: state, mutationCommitState, releaseState: receipt.data.releaseState } });
      expect(JSON.stringify(projected)).not.toContain(textInput.text);
      expect(JSON.stringify(projected)).not.toContain('secret');
    }
  });

  it('keeps menu audit at the public opaque-reference contract and retains sensitive-input rejection', () => {
    const source = { name: 'computer.menu', registrationId: 'builtin:computer.menu@1', executor: 'main' as const,
      kind: 'business' as const, risk: 'write', prepareMain: async () => undefined };
    const input = { observationId: textInput.observationId, elementId: textInput.elementId, operation: 'open', title: '展开更多操作' };
    const projection = projectAgentToolAuditInput(input, source);
    expect(projection).toEqual({ complete: true, sensitive: false, truncated: false, input });
    expect(projectAgentToolAuditInput({ ...input, password: 'not-for-history' }, source)).toMatchObject({ sensitive: true });
  });

  it('captures trusted text privacy identity and provider alias independently of later registry availability', () => {
    const registered = { ...trustedTextTool };
    const registrations = new Map([[registered.name, registered]]);
    const resolve = createAgentComputerTextAuditSourceResolver({ get: name => registrations.get(name) || null });
    registrations.clear();
    registered.registrationId = 'third-party:changed';
    for (const name of ['computer.setText', 'computer_setText']) {
      const source = resolve(name);
      expect(source).toMatchObject({ name: 'computer.setText', registrationId: 'builtin:computer.setText@1' });
      expect(Object.isFrozen(source)).toBe(true);
      expect(projectAgentToolAuditInput(textInput, source).input).not.toHaveProperty('text');
    }
    expect(resolve('other.setText')).toBeNull();
  });

  it('keeps distinct provider-name registrations and untrusted sources outside builtin privacy identity', () => {
    const aliasTool = { ...trustedTextTool, name: 'computer_setText', registrationId: 'third-party:text@1' };
    const resolve = createAgentComputerTextAuditSourceResolver({ get: name => name === trustedTextTool.name
      ? trustedTextTool : name === aliasTool.name ? aliasTool : null });
    expect(projectAgentToolAuditInput(textInput, resolve(trustedTextTool.name)).input).not.toHaveProperty('text');
    expect(resolve(aliasTool.name)).toBeNull();
    expect(projectAgentToolAuditInput(textInput, resolve(aliasTool.name)).input).toHaveProperty('text', textInput.text);
    for (const overrides of [{ registrationId: 'third-party:text@1' }, { prepareMain: undefined },
      { executor: 'renderer' as const }, { kind: 'control' as const }, { risk: 'read' },
      { pluginSource: {} }, { pluginOperation: 'rename' }]) {
      const untrusted = createAgentComputerTextAuditSourceResolver({ get: () => ({ ...trustedTextTool, ...overrides }) });
      expect(untrusted('computer.setText')).toBeNull();
      expect(untrusted('computer_setText')).toBeNull();
    }
  });

  it('limits legacy privacy names to the canonical spelling and fixed provider alias', () => {
    expect(isAgentComputerTextLegacyAuditName('computer.setText')).toBe(true);
    expect(isAgentComputerTextLegacyAuditName('computer_setText')).toBe(true);
    for (const name of [undefined, 'computer.settext', 'computer_setText_custom', 'plugin.setText']) {
      expect(isAgentComputerTextLegacyAuditName(name)).toBe(false);
    }
  });

  it('omits exact builtin text from auditing while retaining scalar and byte counts without modifying execution input', () => {
    const projection = projectAgentToolAuditInput(textInput, trustedTextTool);
    expect(projection).toEqual({ complete: true, sensitive: false, truncated: false,
      input: { observationId: textInput.observationId, elementId: textInput.elementId, mode: 'replace', textLength: 3, textBytes: 8 } });
    expect(projectAgentComputerTextInput(projection.input)).toEqual(projection.input);
    expect(textInput.text).toBe('中🪟a');
    expect(JSON.stringify(projection)).not.toContain(textInput.text);
    expect(projectAgentToolAuditInput({ ...textInput, text: '' }, trustedTextTool).input)
      .toMatchObject({ mode: 'replace', textLength: 0, textBytes: 0 });
  });

  it('retains a public step title through private text audit and repeated history projection', () => {
    const input = { ...textInput, title: '  更新\n测试草稿  ' };
    const projection = projectAgentToolAuditInput(input, trustedTextTool);
    expect(projection).toMatchObject({ complete: true, sensitive: false, input: {
      title: '更新 测试草稿', observationId: textInput.observationId, elementId: textInput.elementId,
      mode: 'replace', textLength: 3, textBytes: 8,
    } });
    expect(projectAgentComputerTextInput(projection.input)).toEqual(projection.input);
    expect(JSON.stringify(projection)).not.toContain(textInput.text);
    expect(input).toEqual({ ...textInput, title: '  更新\n测试草稿  ' });
    expect(projectAgentToolAuditInput({ ...textInput, text: '', title: '清空编辑区' }, trustedTextTool).input)
      .toMatchObject({ title: '清空编辑区', textLength: 0, textBytes: 0 });
    const resolve = createAgentComputerTextAuditSourceResolver({ get: name => name === trustedTextTool.name ? trustedTextTool : null });
    expect(projectAgentToolAuditInput(input, resolve('computer_setText')).input).toEqual(projection.input);
  });

  it('drops titles that echo private text or credentials instead of publishing them as step labels', () => {
    for (const input of [
      { ...textInput, title: textInput.text },
      { ...textInput, title: `输入 ${textInput.text} 到编辑区` },
      { ...textInput, text: '内部\n  测试正文', title: '写入 内部 测试正文' },
      { ...textInput, text: `客户内部项目代号：海棠；${'其他内部说明。'.repeat(30)}`, title: '填写内部项目代号：海棠' },
      { ...textInput, text: '秘密🪟🪟🪟🪟内容', title: '填写 🪟🪟🪟🪟' },
      { ...textInput, text: 'x'.repeat(64_001), title: '检查输入区' },
      { ...textInput, text: null, title: '检查输入区' },
      { ...textInput, title: 'password=private-value' },
      { ...textInput, title: 'Authorization: Bearer abcdefghijklmnop' },
      { ...textInput, title: '[REDACTED]' },
    ]) {
      const output = projectAgentComputerTextInput(input);
      expect(output).not.toHaveProperty('title');
      expect(output).not.toHaveProperty('text');
    }
  });

  it('inspects original text for sensitive credentials and full structural depth before omitting it', () => {
    const sensitive = projectAgentToolAuditInput({ ...textInput, text: 'password=private-value' }, trustedTextTool);
    expect(sensitive).toMatchObject({ complete: true, sensitive: true });
    expect(JSON.stringify(sensitive)).not.toContain('private-value');
    let nested: unknown = { password: 'secret' };
    for (let index = 0; index < 20; index++) nested = { child: nested };
    const incomplete = projectAgentToolAuditInput({ ...textInput, text: nested }, trustedTextTool);
    expect(incomplete.complete).toBe(false);
    expect(JSON.stringify(incomplete)).not.toContain('secret');
    expect(projectAgentToolAuditInput({ ...textInput, text: 'x'.repeat(64_001) }, trustedTextTool).complete).toBe(false);
  });

  it('does not select private builtin semantics for impostor, plugin, renderer or unprepared registrations', () => {
    for (const overrides of [{ registrationId: 'builtin:computer.setText@2' }, { prepareMain: undefined },
      { executor: 'renderer' as const }, { kind: 'control' as const }, { risk: 'read' },
      { pluginSource: {} }, { pluginOperation: 'rename' }]) {
      expect(projectAgentToolAuditInput(textInput, { ...trustedTextTool, ...overrides }).input)
        .toHaveProperty('text', textInput.text);
    }
  });

  it('does not echo denied text, forged identifiers or getters through the defensive legacy projection', () => {
    expect(projectAgentComputerTextInput({ ...textInput, text: 'body\0private', observationId: 'forged', textBytes: 999 }))
      .toEqual({ elementId: textInput.elementId, mode: 'replace' });
    const input = Object.defineProperty({ ...textInput }, 'text', { get: () => { throw new Error('must not read'); } });
    expect(projectAgentComputerTextInput(input)).toEqual({ observationId: textInput.observationId,
      elementId: textInput.elementId, mode: 'replace' });
  });

  it('projects approval and receipts from canonical identity and counts, stripping prose, text and hashes', () => {
    const preview = projectAgentComputerTextPreview(textAction);
    expect(preview.description).toContain('3 个字符，8 字节');
    for (const state of ['dispatched', 'not-dispatched', 'unknown'] as const) {
      const mutationCommitState = state === 'dispatched' ? 'committed' : state === 'unknown' ? 'commit_unknown' : 'uncommitted';
      const result = { ok: state === 'dispatched', message: textInput.text, data: { ...textAction,
        operation: 'computer.setText', operationId: textInput.observationId, dispatchState: state, mutationCommitState,
        nextAction: 'observe', retryAllowed: false, text: textInput.text, textHash: 'private-hash', nested: { body: textInput.text } } };
      const projected = projectAgentComputerTextResult(result, textAction);
      expect(projected.data).toMatchObject({ observationId: textInput.observationId, mode: 'replace', textLength: 3, textBytes: 8,
        dispatchState: state, mutationCommitState, nextAction: 'observe', retryAllowed: false });
      expect(JSON.stringify(projected)).not.toContain(textInput.text);
      expect(JSON.stringify(projected)).not.toContain('private-hash');
      expect(projected.data).not.toHaveProperty('text');
      expect(projectAgentComputerTextResult({ ...result, data: { ...result.data, elementId: textInput.observationId } }, textAction).data)
        .toEqual({ operation: 'computer.setText', dispatchState: 'unknown', mutationCommitState: 'commit_unknown',
          nextAction: 'observe', retryAllowed: false });
    }
  });

  it('turns malformed mutation receipts into unknown outcomes instead of claiming successful dispatch', () => {
    for (const result of [{ ok: true, data: { dispatchState: 'dispatched' } },
      { ok: false, data: { dispatchState: 'unknown', text: textInput.text } },
      { ok: false, message: '文字输入参数无效', data: { dispatchState: 'unknown' } },
      { ok: true, message: textInput.text }]) {
      const projected = projectAgentComputerTextResult(result, textAction);
      expect(projected).toEqual({ ok: false, message: '文字输入结果未知，请先查看窗口，勿重复输入',
        data: { operation: 'computer.setText', dispatchState: 'unknown', mutationCommitState: 'commit_unknown',
          nextAction: 'observe', retryAllowed: false } });
      expect(projected.data).not.toHaveProperty('elementId');
      expect(JSON.stringify(projected)).not.toContain(textInput.text);
    }
    expect(projectAgentComputerTextResult({ ok: false, message: '文字输入参数无效' }, textAction))
      .toEqual({ ok: false, message: '文字输入参数无效' });
  });
  it('retains only the fixed first-party input method on a validated receipt', () => {
    const result = { ok: true, data: { ...textAction, operation: 'computer.setText', operationId: textInput.observationId,
      dispatchState: 'dispatched', mutationCommitState: 'committed', nextAction: 'observe', retryAllowed: false,
      inputMethod: 'omniflow-control', registrationId: 'private-registration', text: textInput.text } };
    const projected = projectAgentComputerTextResult(result, textAction);
    expect(projected.data).toHaveProperty('inputMethod', 'omniflow-control');
    expect(JSON.stringify(projected)).not.toContain('private-registration');
    expect(JSON.stringify(projected)).not.toContain(textInput.text);
    expect(projectAgentComputerTextResult({ ...result, data: { ...result.data, inputMethod: 'arbitrary-driver' } }, textAction).data)
      .not.toHaveProperty('inputMethod');
    expect(projectAgentComputerTextResult({ ...result, data: { ...result.data, elementId: 'forged' } }, textAction).data)
      .not.toHaveProperty('inputMethod');
  });
  it('redacts disguised sensitive keys and sensitive nested string values', () => {
    const projection = projectAgentToolAuditInput({
      'a.p.i-k_e_y': 'top-secret-value',
      nested: {
        note: 'Authorization: Bearer abcdefghijklmnop',
        password: 'another-secret',
      },
      safe: 'visible',
    });
    const serialized = JSON.stringify(projection.input);

    expect(projection).toMatchObject({ complete: true, sensitive: true });
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('visible');
    expect(serialized).not.toContain('top-secret-value');
    expect(serialized).not.toContain('abcdefghijklmnop');
    expect(serialized).not.toContain('another-secret');
  });

  it('bounds oversized and structurally unsafe inputs without serializing them raw', () => {
    const circular: Record<string, unknown> = {
      items: Array.from({ length: 200 }, (_, index) => ({
        index,
        value: 'x'.repeat(1_000),
      })),
    };
    circular.self = circular;

    const projection = projectAgentToolAuditInput(circular);
    const serialized = JSON.stringify(projection.input);

    expect(projection.complete).toBe(false);
    expect(projection.truncated).toBe(true);
    expect(serialized.length).toBeLessThanOrEqual(4_096);
    expect(serialized).not.toContain('x'.repeat(500));
  });

  it('rejects prototype mutation keys and omits them from the audit projection', () => {
    const input = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},'
      + '"prototype":{"polluted":true},"safe":"visible"}',
    );
    const projection = projectAgentToolAuditInput(input);
    const projectedInput = projection.input as Record<string, unknown>;
    const serialized = JSON.stringify(projectedInput);

    expect(projection).toMatchObject({ complete: false, sensitive: false, truncated: true });
    expect(Object.getPrototypeOf(projectedInput)).toBeNull();
    expect(serialized).toContain('visible');
    expect(serialized).toContain('_omniflowAuditTruncated');
    expect(serialized).not.toContain('polluted');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

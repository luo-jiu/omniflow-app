import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolResult } from '../../../src/shared/agent/agent.types';
import { createAgentToolBroker } from './agent-tool-broker';
import type { AgentToolDispatchContext } from './agent-tool-registry';

const OPERATION_ID = 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68';
const OTHER_ID = '74db06a6-be25-437d-9b13-81307bd3c685';
const TOOL_NAME = 'example.batch-rename.propose';
const result = (state: 'committed' | 'uncommitted' | 'commit_unknown', operationId = OPERATION_ID): AgentToolResult => ({
  ok: state === 'committed', data: { mutationCommitState: state, operationId, changes: [{ nodeId: 42, name: 'new.txt' }] },
});
const never = () => new Promise<AgentToolResult>(() => undefined);

function fixture(execute: (context: AgentToolDispatchContext) => Promise<AgentToolResult>, options: {
  tool?: Record<string, unknown> | null;
  timeoutMs?: number;
  settleTimeoutMs?: number;
  controller?: AbortController;
  inheritedSettlement?: AgentToolDispatchContext['commitSettlement'];
} = {}) {
  const controller = options.controller ?? new AbortController();
  const getTool = vi.fn(() => options.tool === undefined
    ? { registrationId: 'rename@frozen', pluginOperation: 'rename', risk: 'write', executor: 'main' }
    : options.tool);
  let dispatched!: AgentToolDispatchContext;
  const registry = { execute: vi.fn(async (_name: string, _input: unknown, context: AgentToolDispatchContext) => {
    dispatched = context;
    return execute(context);
  }) };
  const broker = createAgentToolBroker({ toolRegistry: registry });
  const context = {
    appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] },
    commitSettlement: options.inheritedSettlement,
    onProgress: vi.fn(), signal: controller.signal,
    runCapabilitySnapshot: { getTool },
  } as unknown as AgentToolDispatchContext;
  const running = broker.executeMain(TOOL_NAME, {}, context, options.timeoutMs ?? 30_000, undefined, options.settleTimeoutMs ?? 45_000);
  return { controller, running, registry, context: () => dispatched };
}

afterEach(() => vi.useRealTimers());

describe('host-owned plugin rename commit settlement', () => {
  it('also provides settlement only to the frozen file-output main write capability', async () => {
    const run = fixture(async context => {
      context.commitSettlement!.begin(result('commit_unknown'));
      context.commitSettlement!.settle(result('committed'));
      return result('committed');
    }, { tool: { registrationId: 'output@frozen', pluginOperation: 'file-output', risk: 'write', executor: 'main' } });
    await expect(run.running).resolves.toEqual(result('committed'));
  });
  it('preserves a successful receipt when cancellation follows settle before executor return', async () => {
    const run = fixture(async context => {
      context.commitSettlement!.begin(result('commit_unknown'));
      context.commitSettlement!.settle(result('committed'));
      return never();
    });
    await Promise.resolve(); run.controller.abort();
    await expect(run.running).resolves.toEqual(result('committed'));
    expect(run.context().signal.aborted).toBe(true);
  });

  it.each(['committed', 'uncommitted', 'commit_unknown'] as const)('returns %s receipt even if executor subsequently throws', async state => {
    const run = fixture(async context => {
      context.commitSettlement!.begin(result('commit_unknown'));
      context.commitSettlement!.settle(result(state));
      throw new Error('later refresh or cleanup failed');
    });
    await expect(run.running).resolves.toEqual(result(state));
  });

  it.each(['committed', 'uncommitted', 'commit_unknown'] as const)('accepts a late %s receipt during cancellation grace', async state => {
    vi.useFakeTimers();
    const run = fixture(async context => { context.commitSettlement!.begin(result('commit_unknown')); return never(); });
    let finished = false; void run.running.then(() => { finished = true; });
    await Promise.resolve(); run.controller.abort();
    await vi.advanceTimersByTimeAsync(6_001); expect(finished).toBe(false);
    run.context().commitSettlement!.settle(result(state));
    await expect(run.running).resolves.toEqual(result(state)); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['return', 'throw'] as const)('keeps commit_unknown if executor exits by %s without a receipt', async outcome => {
    const run = fixture(async context => {
      context.commitSettlement!.begin(result('commit_unknown'));
      if (outcome === 'throw') throw new Error('connection lost after write');
      return { ok: true, message: 'unregistered success is not a receipt' };
    });
    await expect(run.running).resolves.toEqual(result('commit_unknown'));
  });

  it('returns the registered unknown fallback when cancellation grace expires and rejects late settlement', async () => {
    vi.useFakeTimers();
    const run = fixture(async context => { context.commitSettlement!.begin(result('commit_unknown')); return never(); });
    await Promise.resolve(); run.controller.abort(); await vi.advanceTimersByTimeAsync(45_000);
    await expect(run.running).resolves.toEqual(result('commit_unknown'));
    expect(() => run.context().commitSettlement!.settle(result('committed'))).toThrow('已经结束');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the unknown fallback after execution timeout plus bounded settlement grace', async () => {
    vi.useFakeTimers();
    const run = fixture(async context => { context.commitSettlement!.begin(result('commit_unknown')); return never(); }, { timeoutMs: 100, settleTimeoutMs: 50 });
    let finished = false; void run.running.then(() => { finished = true; });
    await Promise.resolve(); await vi.advanceTimersByTimeAsync(100);
    expect(run.context().signal.aborted).toBe(true); expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(49); expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await expect(run.running).resolves.toEqual(result('commit_unknown'));
  });

  it('clones and normalizes receipts while preserving the authoritative operation identity', async () => {
    const fallback = result('commit_unknown');
    const receipt: AgentToolResult = { ...result('committed'), message: 'password=hidden', data: { ...(result('committed').data as object), authorization: 'Bearer hidden-token' } };
    const run = fixture(async context => {
      context.commitSettlement!.begin(fallback);
      (fallback.data as Record<string, unknown>).operationId = OTHER_ID;
      context.commitSettlement!.settle(receipt);
      (receipt.data as Record<string, unknown>).operationId = OTHER_ID;
      return { ok: false };
    });
    await expect(run.running).resolves.toEqual({
      ok: true, message: 'password=[REDACTED]',
      data: { ...(result('committed').data as object), authorization: '[REDACTED]' },
    });
  });

  it('rejects duplicate begin, settlement without begin, duplicate settlement and committed downgrade', async () => {
    const run = fixture(async context => {
      const settlement = context.commitSettlement!;
      expect(() => settlement.settle(result('committed'))).toThrow('不存在');
      settlement.begin(result('commit_unknown'));
      expect(() => settlement.begin(result('commit_unknown'))).toThrow('已经开始');
      settlement.settle(result('committed'));
      expect(() => settlement.settle(result('committed'))).toThrow('已经结束');
      expect(() => settlement.settle(result('uncommitted'))).toThrow('已经结束');
      return result('uncommitted');
    });
    await expect(run.running).resolves.toEqual(result('committed'));
  });

  it('rejects malformed, mismatched, oversized and state-inconsistent results without consuming the valid receipt', async () => {
    const invalid = [null, [], { ok: 'false', data: result('commit_unknown').data },
      { ok: false }, { ok: false, data: [] }, { ok: false, data: { operationId: OPERATION_ID, mutationCommitState: ['commit_unknown'] } },
      result('commit_unknown', 'operation-42'), { ...result('committed'), ok: false }, { ...result('uncommitted'), ok: true },
      { ok: false, data: { operationId: OPERATION_ID, mutationCommitState: 'unknown' } },
      { ok: false, data: { ...(result('commit_unknown').data as object), tooLarge: 'x'.repeat(100_001) } },
      Object.create({ ok: false, data: result('commit_unknown').data }),
    ];
    const run = fixture(async context => {
      const settlement = context.commitSettlement!;
      for (const value of [...invalid, result('committed'), result('uncommitted')]) {
        expect(() => settlement.begin(value as AgentToolResult)).toThrow();
      }
      settlement.begin(result('commit_unknown'));
      for (const value of [...invalid, result('committed', OTHER_ID)]) expect(() => settlement.settle(value as AgentToolResult)).toThrow();
      settlement.settle(result('uncommitted')); return result('committed');
    });
    await expect(run.running).resolves.toEqual(result('uncommitted'));
  });
});

describe('main commit authority and existing cancellation behavior', () => {
  it.each([
    null,
    { registrationId: 'read', risk: 'read', executor: 'main' },
    { registrationId: 'read-forged-kind', pluginOperation: 'rename', risk: 'read', executor: 'main' },
    { registrationId: 'renderer', pluginOperation: 'rename', risk: 'write', executor: 'renderer' },
    { registrationId: 'ordinary-write', risk: 'write', executor: 'main' },
  ])('does not provide or inherit commit closures for an ineligible Tool %#', async tool => {
    const inheritedSettlement = { begin: vi.fn(), settle: vi.fn() };
    const run = fixture(async context => { expect(context.commitSettlement).toBeUndefined(); return { ok: true }; }, { tool, inheritedSettlement });
    await expect(run.running).resolves.toEqual({ ok: true });
    expect(inheritedSettlement.begin).not.toHaveBeenCalled(); expect(inheritedSettlement.settle).not.toHaveBeenCalled();
  });

  it('replaces even an eligible upstream closure with a new execution-bound closure', async () => {
    const inheritedSettlement = { begin: vi.fn(), settle: vi.fn() };
    const run = fixture(async context => {
      expect(context.commitSettlement).not.toBe(inheritedSettlement);
      context.commitSettlement!.begin(result('commit_unknown')); return { ok: true };
    }, { inheritedSettlement });
    await expect(run.running).resolves.toEqual(result('commit_unknown')); expect(inheritedSettlement.begin).not.toHaveBeenCalled();
  });

  it('does not dispatch an already cancelled Run', async () => {
    const controller = new AbortController(); controller.abort();
    const run = fixture(async () => ({ ok: true }), { controller });
    await expect(run.running).rejects.toMatchObject({ name: 'AbortError' }); expect(run.registry.execute).not.toHaveBeenCalled();
  });

  it('rejects begin after cancellation and keeps ordinary pre-write cancellation behavior', async () => {
    vi.useFakeTimers(); const run = fixture(never, { settleTimeoutMs: 50 });
    const rejected = expect(run.running).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); run.controller.abort();
    expect(() => run.context().commitSettlement!.begin(result('commit_unknown'))).toThrow('失效');
    await vi.advanceTimersByTimeAsync(50); await rejected;
  });

  it('does not accept a plain read result after cancellation as a commit receipt', async () => {
    let complete!: (value: AgentToolResult) => void;
    const run = fixture(() => new Promise(resolve => { complete = resolve; }), { tool: { registrationId: 'read', risk: 'read', executor: 'main' } });
    const rejected = expect(run.running).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); run.controller.abort(); complete(result('committed')); await rejected;
  });
});

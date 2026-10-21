import { describe, expect, it, vi } from 'vitest';

import { createAgentToolRegistry } from '../agent-tool-registry';
import { resolveAgentModelAdapter, restrictAgentToolsForModel } from '../agent-model-adapter';
import { createAgentShellRunTool } from './shell-run-tool';
import {
  createAgentFileBridgeTools,
  normalizeAgentFilePublishInputV1,
  normalizeAgentFileStageInputV1,
  normalizeAgentFileUploadInputV1,
} from './file-bridge-tools';

function createRuntime() {
  return {
    executePublish: vi.fn(async () => ({ ok: true as const })),
    executeStage: vi.fn(async () => ({ ok: true as const })),
    executeUpload: vi.fn(async () => ({ ok: true as const })),
    preparePublish: vi.fn(async () => ({}) as never),
    prepareStage: vi.fn(async () => ({}) as never),
    prepareUpload: vi.fn(async () => ({}) as never),
  };
}

describe('Agent file bridge tools', () => {
  it('registers strict main-owned business tools with stable identities', () => {
    const tools = createAgentFileBridgeTools(createRuntime());
    const registry = createAgentToolRegistry([...tools]);
    const snapshot = registry.createSnapshot();

    expect(snapshot.tools.map(tool => ({
      cancellationSettleTimeoutMs: tool.cancellationSettleTimeoutMs,
      executor: tool.executor,
      kind: tool.kind,
      name: tool.name,
      registrationId: tool.registrationId,
    }))).toEqual([{
      cancellationSettleTimeoutMs: 45_000,
      executor: 'main',
      kind: 'business',
      name: 'file.stage',
      registrationId: 'file.stage@1',
    }, {
      cancellationSettleTimeoutMs: 45_000,
      executor: 'main',
      kind: 'business',
      name: 'file.publish',
      registrationId: 'file.publish@1',
    }, {
      cancellationSettleTimeoutMs: 45_000,
      executor: 'main',
      kind: 'business',
      name: 'file.upload',
      registrationId: 'file.upload@1',
    }]);
    const stageDescription = snapshot.tools.find(tool => tool.name === 'file.stage')?.description;
    expect(stageDescription).toContain('按原始字节暂存');
    expect(stageDescription).toContain('本机 CLI 编译、测试、校验或转换');
    expect(stageDescription).toContain('优先暂存原始文件后使用 shell_run 的 run-workspace');
    expect(stageDescription).toContain('避免把 file_read 的文本结果经模型重述、heredoc 重建为源文件');
    expect(stageDescription).toContain('logicalPath 相对工作区根，沿用实际返回路径');
    expect(stageDescription).toContain('input/a.cpp 且 cwd=work 时，命令使用 ../input/a.cpp');
    expect(stageDescription).toContain('辅助测试入口和临时构建产物写入 work 或 tmp');
    expect(stageDescription).toContain('纯验证无需 file_publish');
    expect(stageDescription).toContain('executionContext=host 直接操作原路径，无需暂存');
    expect(tools.find(tool => tool.name === 'file.upload')?.description)
      .toContain('先查看或检查原文件，且本轮提供 shell_run 时，可使用该工具直接读取原路径');
    expect(tools.find(tool => tool.name === 'file.upload')?.description)
      .toContain('只有需要工作副本来修改、转换或生成新文件，且本轮提供');
    expect(tools.find(tool => tool.name === 'file.upload')?.description)
      .toContain('file_stage、shell_run 和 file_publish 时，才使用这条处理链');
  });

  it('keeps cross-tool guidance conditional when the model filters Shell but retains staging', () => {
    const original = createAgentToolRegistry([
      ...createAgentFileBridgeTools(createRuntime()),
      createAgentShellRunTool({ execute: vi.fn(), prepare: vi.fn() }),
    ]).createSnapshot();
    const restricted = restrictAgentToolsForModel(original, resolveAgentModelAdapter(
      { providerType: 'openai' }, 'gpt-5.5', { supportsShellTool: false },
    ));

    expect(restricted.get('shell.run')).toBeNull();
    const stageDescription = restricted.get('file.stage')?.description;
    expect(stageDescription).toContain('本轮提供 shell_run 时，资料库文件需要交给本机 CLI');
    expect(stageDescription).toContain('且本轮提供 shell_run 时，可使用其 executionContext=host');
    expect(stageDescription).toContain('本轮提供 file_upload 时，原样传输应使用该工具');
    expect(restricted.get('file.upload')?.description).toContain('且本轮提供 shell_run 时，可使用该工具');
  });

  it('accepts the picker and explicit local-path stage branches', () => {
    expect(normalizeAgentFileStageInputV1({ source: { kind: 'local-picker' } }))
      .toEqual({ source: { kind: 'local-picker' } });
    expect(normalizeAgentFileStageInputV1({ source: { kind: 'local-path', path: '~/input.txt' } }))
      .toEqual({ source: { kind: 'local-path', path: '~/input.txt' } });
    expect(() => normalizeAgentFileStageInputV1({
      source: { kind: 'local-picker', path: '/tmp/private.txt' },
    })).toThrow('来源无效');
    expect(() => normalizeAgentFileStageInputV1({
      source: { kind: 'library-node', nodeId: 0 },
    })).toThrow('来源无效');
  });

  it('normalizes an explicit local file upload to an exact library path', () => {
    expect(normalizeAgentFileUploadInputV1({
      destination: { directoryPath: '/文档/提示词', kind: 'library-path' },
      source: { kind: 'local-path', path: '~/Downloads/prompt.md' },
    })).toEqual({
      destination: { directoryPath: '/文档/提示词', kind: 'library-path' },
      source: { kind: 'local-path', path: '~/Downloads/prompt.md' },
    });
  });

  it.each([
    ['relative source', {
      destination: { directoryPath: '/文档', kind: 'library-path' },
      source: { kind: 'local-path', path: 'Downloads/prompt.md' },
    }],
    ['non-absolute library destination', {
      destination: { directoryPath: '文档', kind: 'library-path' },
      source: { kind: 'local-path', path: '~/Downloads/prompt.md' },
    }],
    ['mixed destination fields', {
      destination: { directoryPath: '/文档', kind: 'library-path', parentId: 3 },
      source: { kind: 'local-path', path: '~/Downloads/prompt.md' },
    }],
    ['picker source', {
      destination: { directoryPath: '/文档', kind: 'library-path' },
      source: { kind: 'local-picker' },
    }],
  ])('rejects malformed direct upload input: %s', (_label, input) => {
    expect(() => normalizeAgentFileUploadInputV1(input)).toThrow();
  });

  it('normalizes strict publish branches without injecting defaults', () => {
    expect(normalizeAgentFilePublishInputV1({
      destination: { kind: 'local-save-as', suggestedFileName: ' result.txt ' },
      sourcePath: 'output/result.txt',
    })).toEqual({
      destination: { kind: 'local-save-as', suggestedFileName: 'result.txt' },
      sourcePath: 'output/result.txt',
    });
    expect(normalizeAgentFilePublishInputV1({
      destination: { kind: 'library', parentId: 8 },
      sourcePath: 'output/result.txt',
    })).toEqual({
      destination: { kind: 'library', parentId: 8 },
      sourcePath: 'output/result.txt',
    });
  });

  it.each([
    ['root extra field', {
      destination: { kind: 'local-save-as' }, sourcePath: 'output/a.txt', unexpected: true,
    }],
    ['mixed destination fields', {
      destination: { kind: 'local-save-as', parentId: 1 }, sourcePath: 'output/a.txt',
    }],
    ['traversal', { destination: { kind: 'local-save-as' }, sourcePath: 'output/../a.txt' }],
    ['non-output source', { destination: { kind: 'local-save-as' }, sourcePath: 'work/a.txt' }],
    ['unsafe provider', {
      destination: { kind: 'library', parentId: 1, providerId: '../secret' },
      sourcePath: 'output/a.txt',
    }],
  ])('rejects malformed publish input: %s', (_label, input) => {
    expect(() => normalizeAgentFilePublishInputV1(input)).toThrow();
  });
});

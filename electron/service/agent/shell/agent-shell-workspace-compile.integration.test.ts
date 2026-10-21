import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AgentFileAuthorityNodeSnapshotV1 } from '@/shared/agent/agent.types';
import { createAgentAiDestinationSnapshot } from '../agent-ai-destination';
import { createAgentRunCapabilitySnapshot } from '../agent-run-capability-snapshot';
import {
  createAgentToolRegistry,
  hashAgentToolInputForPreparation,
  type AgentTool,
  type AgentToolExecutionContext,
  type AgentToolMainPreparationContext,
} from '../agent-tool-registry';
import { createAgentSkillRegistry } from '../skills/agent-skill-registry';
import { createAgentLocalStorageQuotaManager } from '../storage/agent-local-storage-quota-manager';
import { createAgentFileBridgeTools } from '../tools/file-bridge-tools';
import { createAgentShellRunTool } from '../tools/shell-run-tool';
import { createAgentShellLogFileStore } from './agent-shell-log-file-store';
import { createAgentShellLogQuotaAdapter } from './agent-shell-log-quota-adapter';
import { createAgentShellLogStore } from './agent-shell-log-store';
import { createAgentShellProviderRegistry } from './agent-shell-provider-registry';
import { createAgentShellServiceRuntime } from './agent-shell-service-runtime';
import { createAgentShellStorageRuntimeCloser } from './agent-shell-storage-runtime';
import { createAgentShellWorkspaceStore } from './agent-shell-workspace-store';

// Only the renderer authority boundary is simulated; no Electron process is started.
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  webContents: { fromId: vi.fn(() => ({ isDestroyed: () => false })) },
}));

const OWNER_SCOPE = Object.freeze({ accountScope: 'user:77', backendScope: 'https://example.com/api' });
const SESSION_ID = 'session-workspace-compile';
const RUN_ID = 'run-workspace-compile';
const OWNER = Object.freeze({ ...OWNER_SCOPE, sessionId: SESSION_ID });
const PROFILE = Object.freeze({
  apiKey: 'test-only-key', baseUrl: 'https://example.com/v1',
  configurationRevision: 'workspace-compile-v1', id: 'workspace-compile-profile',
  name: 'Workspace compile test', providerType: 'local' as const,
});
const SOURCE_BYTES = Buffer.from([
  '// 原始资料库字节：CRLF 与末尾换行必须保留',
  '#include <algorithm>',
  '#include <vector>',
  'class Solution {',
  'public:',
  '  std::vector<int> sorted(std::vector<int> values) const {',
  '    std::sort(values.begin(), values.end());',
  '    return values;',
  '  }',
  '};',
  '',
].join('\r\n'), 'utf8');
const sourceHash = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function findCompiler(): string | undefined {
  // Only macOS Zsh is execution-ready in the production Provider Registry.
  if (process.platform !== 'darwin') return undefined;
  const directories = [...new Set(['/usr/bin', ...(process.env.PATH || '').split(path.delimiter)])];
  for (const name of ['clang++', 'g++']) {
    for (const directory of directories) {
      if (!path.isAbsolute(directory)) continue;
      const candidate = path.join(directory, name);
      try {
        accessSync(candidate, constants.X_OK);
        if (spawnSync(candidate, ['--version'], { timeout: 5_000, stdio: 'ignore' }).status === 0) {
          return candidate;
        }
      } catch { /* Try the next installed compiler. */ }
    }
  }
  return undefined;
}

const compiler = findCompiler();
const compileIt = compiler ? it : it.skip;

describe('Agent Shell staged library compilation (requires macOS Zsh and clang++/g++)', () => {
  compileIt('compiles the actual second staged path without rewriting library source bytes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-workspace-compile-'));
    const quotaManager = createAgentLocalStorageQuotaManager({
      maxSingleResourceBytes: 32 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
    });
    const workspaceStore = createAgentShellWorkspaceStore({
      quotaManager, rootPath: path.join(root, 'workspaces'),
    });
    const logFileStore = createAgentShellLogFileStore({ quotaManager, rootPath: path.join(root, 'logs') });
    const logStore = createAgentShellLogStore({
      physicalStore: logFileStore,
      quota: createAgentShellLogQuotaAdapter({ quotaManager }),
    });
    const closeStorage = createAgentShellStorageRuntimeCloser(logStore, logFileStore, workspaceStore, quotaManager);
    let service: ReturnType<typeof createAgentShellServiceRuntime> | undefined;
    try {
      await Promise.all([workspaceStore.ready, logFileStore.ready, logStore.ready]);
      const providerRegistry = createAgentShellProviderRegistry({ candidates: { darwin: ['/bin/zsh'] }, platform: 'darwin' });
      const providerSnapshot = await providerRegistry.refresh();
      expect(providerSnapshot.getProviderById('system-zsh')?.publicIdentity.executionReady).toBe(true);
      const node: AgentFileAuthorityNodeSnapshotV1 = {
        id: 42, libraryId: 3, parentId: 9, name: 'compile-source', ext: 'cpp',
        type: 'file', fileSize: SOURCE_BYTES.byteLength,
        storageKey: 'libraries/3/compile-source.cpp', storageProvider: 'local',
        updatedAt: '2026-10-21T00:00:00Z', version: 1,
      };
      type ServiceOptions = Parameters<typeof createAgentShellServiceRuntime>[0];
      const requestFileAuthority = vi.fn<NonNullable<ServiceOptions['requestFileAuthority']>>(async (input) => {
        expect(input.libraryId).toBe(3);
        expect(input.ownerScope).toEqual(OWNER_SCOPE);
        if (input.operation.operation !== 'stage-library-node') throw new Error('unexpected file mutation');
        expect(input.operation.nodeId).toBe(node.id);
        return {
          operation: 'stage-library-node', version: 1, node,
          ...(input.operation.includeDownloadUrl ? { downloadUrl: 'https://example.com/test-source-bytes' } : {}),
        };
      });
      const downloadFile = vi.fn<NonNullable<ServiceOptions['downloadFile']>>(async (_url, destination) => {
        await writeFile(destination, SOURCE_BYTES);
      });
      service = createAgentShellServiceRuntime({
        providerRegistry,
        storageRuntime: { close: closeStorage, logFileStore, logStore, quotaManager, workspaceStore },
        resolveRuntimeProfile: () => PROFILE,
        getPermissionMode: () => 'full-access',
        executionGrowthBytes: 8 * 1024 * 1024,
        executionQuotaPollIntervalMs: 60_000,
        requestFileAuthority,
        downloadFile,
      });
      const fileTools = createAgentFileBridgeTools({
        prepareStage: service.prepareFileStage, executeStage: service.executeFileStage,
        preparePublish: service.prepareFilePublish, executePublish: service.executeFilePublish,
        prepareUpload: service.prepareFileUpload, executeUpload: service.executeFileUpload,
      });
      const stageTool = fileTools.find(tool => tool.name === 'file.stage')!;
      const shellTool = createAgentShellRunTool({ prepare: service.prepare, execute: service.execute });
      const toolSnapshot = createAgentToolRegistry([...fileTools, shellTool]).createSnapshot();
      const runCapabilitySnapshot = createAgentRunCapabilitySnapshot({
        shellPermissionMode: 'full-access', shellProviderSnapshot: providerSnapshot,
        skillSnapshot: createAgentSkillRegistry().createRunSnapshot(), toolSnapshot,
      });
      const aiDestination = createAgentAiDestinationSnapshot({ model: 'compile-test', profileId: PROFILE.id, runtimeConnection: PROFILE });

      const prepare = async (tool: AgentTool, input: unknown, id: string) => {
        const context: AgentToolMainPreparationContext = {
          aiDestination,
          appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [42] },
          ownerScope: OWNER_SCOPE, ownerWebContentsId: 17, runCapabilitySnapshot,
          signal: new AbortController().signal,
          preparationIdentity: {
            aiDestinationIdentity: aiDestination.identity,
            callId: `call-${id}`, libraryId: 3, ownerScope: OWNER_SCOPE, ownerWebContentsId: 17,
            preparedActionId: `prepared-${id}`, runCapabilityIdentity: runCapabilitySnapshot.identity,
            runId: RUN_ID, sessionId: SESSION_ID, toolInputHash: hashAgentToolInputForPreparation(input),
            toolName: tool.name, toolRegistrationId: tool.registrationId!, toolRunId: `tool-run-${id}`,
          },
        };
        expect(await tool.validate?.(input, {
          appContext: context.appContext, onProgress: vi.fn(), signal: context.signal,
          runCapabilitySnapshot,
        })).toEqual({ ok: true });
        const prepared = await tool.prepareMain!(input, undefined, context);
        const sealed = toolSnapshot.sealMainPreparedExecution(tool.name, {
          approvalSemantics: prepared.decision, binding: prepared.binding,
          identity: context.preparationIdentity, publicAction: prepared.publicAction,
          snapshotMaterial: prepared.snapshotMaterial,
        }, tool.registrationId!);
        const execution: AgentToolExecutionContext = {
          appContext: context.appContext, onProgress: vi.fn(), signal: context.signal,
          runCapabilitySnapshot,
          preparation: {
            binding: prepared.binding, identity: sealed.identity,
            preparedActionId: sealed.identity.preparedActionId,
            publicAction: sealed.publicAction, snapshotHash: sealed.snapshotHash,
          },
        };
        return { execution, prepared };
      };

      const stageInput = { source: { kind: 'library-node', nodeId: 42 } };
      const stage = async (id: string) => {
        const { execution } = await prepare(stageTool, stageInput, id);
        const result = await stageTool.execute!(stageInput, execution);
        expect(result).toMatchObject({ ok: true, data: {
          contentHash: sourceHash(SOURCE_BYTES), sizeBytes: SOURCE_BYTES.byteLength,
          sourceKind: 'library-node', sourceNodeId: 42,
        } });
        expect(JSON.stringify(result)).not.toContain(root);
        expect(JSON.stringify(result)).not.toContain('https://example.com/test-source-bytes');
        return result.data as { logicalPath: string; contentHash: string };
      };
      const first = await stage('stage-first');
      const second = await stage('stage-second');
      expect(first.logicalPath).toBe('input/compile-source.cpp');
      expect(second.logicalPath).toBe('input/compile-source-2.cpp');
      expect(downloadFile).toHaveBeenCalledTimes(2);
      expect(requestFileAuthority.mock.calls.map(([input]) => input.toolRunId))
        .toEqual(['tool-run-stage-first', 'tool-run-stage-first', 'tool-run-stage-first',
          'tool-run-stage-second', 'tool-run-stage-second', 'tool-run-stage-second']);

      const relativeSource = path.posix.relative('work', second.logicalPath);
      expect(relativeSource).toBe('../input/compile-source-2.cpp');
      const harness = [
        `#include "${relativeSource}"`,
        '#include <iostream>',
        'int main() {',
        '  const Solution solution;',
        '  if (solution.sorted({17, -6, 25, 6}) != std::vector<int>{-6, 6, 17, 25}) return 2;',
        '  if (!solution.sorted({}).empty()) return 3;',
        '  std::cout << "compile-stage-ok\\n";',
        '  return std::cout ? 0 : 4;',
        '}',
        '',
      ].join('\n');
      const quotedCompiler = `'${compiler!.replace(/'/gu, "'\\''")}'`;
      const command = `cat > harness.cpp <<'HARNESS'\n${harness}HARNESS\n${quotedCompiler} -std=c++17 harness.cpp -o verify-source && ./verify-source`;
      const { execution, prepared } = await prepare(shellTool, {
        command, cwd: 'work', executionContext: 'run-workspace', timeoutMs: 20_000,
      }, 'compile');
      expect(prepared.decision.behavior).toBe('allow');
      expect(prepared.publicAction).toMatchObject({ cwd: { kind: 'run-workspace', path: 'work' } });
      const binding = prepared.binding as { workspace: { workspaceId: string } };
      const workspaceId = binding.workspace.workspaceId;
      const { physicalCwdPath: cwd } = await workspaceStore.resolvePreparationContext(workspaceId, 'work', RUN_ID, OWNER);
      await workspaceStore.withOwnedFile(workspaceId, second.logicalPath, RUN_ID, OWNER, async ownedFile => {
        expect(path.resolve(cwd, relativeSource)).toBe(path.join(ownedFile.managedRootPath, second.logicalPath));
      });

      const result = await service.execute(execution);
      expect(result).toMatchObject({
        ok: true, exitCode: 0, status: 'completed', processStatus: 'completed', terminationConfirmed: true,
      });
      expect(result.outputTail.frames.map(frame => frame.text).join('')).toBe('compile-stage-ok\n');
      expect(await readFile(path.join(cwd, 'harness.cpp'), 'utf8')).toBe(harness);
      expect(await readdir(cwd)).toEqual(['harness.cpp', 'verify-source']);
      for (const staged of [first, second]) {
        await workspaceStore.withOwnedFile(workspaceId, staged.logicalPath, RUN_ID, OWNER, async ownedFile => {
          const bytes = await ownedFile.fileHandle.readFile();
          expect(bytes).toEqual(SOURCE_BYTES);
          expect(sourceHash(bytes)).toBe(staged.contentHash);
          expect(bytes.subarray(-2).toString()).toBe('\r\n');
          await ownedFile.verifyUnchanged();
        });
      }
      const workspace = workspaceStore.get(workspaceId, OWNER)!;
      expect(workspace.manifest.provenance).toEqual(['library-node:3:42']);
      expect(workspace.manifest.entries.filter(entry => entry.kind === 'file').map(entry => entry.logicalPath).sort())
        .toEqual([first.logicalPath, second.logicalPath].sort());
      const log = await logStore.readPage({
        owner: OWNER, sessionId: SESSION_ID, runId: RUN_ID, toolRunId: 'tool-run-compile',
        executionId: result.executionId, logRef: result.logRef,
      });
      expect(log.frames.map(frame => frame.text).join('')).toBe('compile-stage-ok\n');
    } finally {
      try { await service?.close(); }
      finally {
        try { await closeStorage(); }
        finally { await rm(root, { recursive: true, force: true }); }
      }
    }
  }, 45_000);
});

import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';

import type {
  AgentChatRequest,
  AgentMediaArtifactReleaseRequest,
  AgentMediaAudioExtractionRequest,
  AgentMediaInspectionRequest,
  AgentOwnerScope,
  AgentSessionCursor,
  AgentToolApprovalDecisionRequest,
  AgentToolExecutionCompletion,
  AgentToolExecutionCommit,
  AgentToolExecutionProgressRequest,
} from '@/shared/agent/agent.types';
import { agentOrchestrator } from '../service/agent/agent-orchestrator';
import { assertMainWindowAgentSender } from './aiServiceAccess';

interface RegisterAgentIpcOptions {
  getMainWindow: () => BrowserWindow | null;
}

export function registerAgentIpc(
  ipcMain: IpcMain,
  options: RegisterAgentIpcOptions,
): void {
  const ownersWithCleanup = new Set<number>();

  function requireMainWindow(event: IpcMainInvokeEvent): WebContents {
    return assertMainWindowAgentSender(event, options.getMainWindow);
  }

  function ensureOwnerCleanup(sender: WebContents): void {
    if (ownersWithCleanup.has(sender.id)) return;
    ownersWithCleanup.add(sender.id);
    sender.once('destroyed', () => {
      ownersWithCleanup.delete(sender.id);
      agentOrchestrator.releaseOwner(sender.id);
    });
  }

  ipcMain.handle('agent:chat:start', (event, input: AgentChatRequest) => {
    const sender = requireMainWindow(event);
    ensureOwnerCleanup(sender);
    return agentOrchestrator.start(sender, input);
  });

  ipcMain.handle('agent:chat:stop', (event, sessionId: string) => {
    const sender = requireMainWindow(event);
    return agentOrchestrator.stop(String(sessionId || ''), sender.id);
  });

  ipcMain.handle('agent:owner:release', (event) => {
    const sender = requireMainWindow(event);
    agentOrchestrator.releaseOwner(sender.id);
    return true;
  });

  ipcMain.handle(
    'agent:tool:approval:resolve',
    (event, input: AgentToolApprovalDecisionRequest) => {
      const sender = requireMainWindow(event);
      ensureOwnerCleanup(sender);
      return agentOrchestrator.resolveToolApproval(sender.id, input);
    },
  );

  ipcMain.handle(
    'agent:media:inspect',
    (event, input: AgentMediaInspectionRequest) => {
      const sender = requireMainWindow(event);
      ensureOwnerCleanup(sender);
      return agentOrchestrator.inspectMedia(sender.id, input);
    },
  );

  ipcMain.handle(
    'agent:media:extract-audio',
    (event, input: AgentMediaAudioExtractionRequest) => {
      const sender = requireMainWindow(event);
      ensureOwnerCleanup(sender);
      return agentOrchestrator.extractMediaAudio(sender.id, input);
    },
  );

  ipcMain.handle(
    'agent:media:artifact:release',
    (event, input: AgentMediaArtifactReleaseRequest) => {
      const sender = requireMainWindow(event);
      return agentOrchestrator.releaseMediaArtifact(sender.id, input);
    },
  );

  ipcMain.handle(
    'agent:tool:execution:progress',
    (event, input: AgentToolExecutionProgressRequest) => {
      const sender = requireMainWindow(event);
      return agentOrchestrator.reportToolExecutionProgress(sender.id, input);
    },
  );

  ipcMain.handle(
    'agent:tool:execution:commit',
    (event, input: AgentToolExecutionCommit) => {
      const sender = requireMainWindow(event);
      return agentOrchestrator.markToolExecutionCommitted(sender.id, input);
    },
  );

  ipcMain.handle(
    'agent:tool:execution:complete',
    (event, input: AgentToolExecutionCompletion) => {
      const sender = requireMainWindow(event);
      return agentOrchestrator.completeToolExecution(sender.id, input);
    },
  );

  ipcMain.handle('agent:session:list', (event, input: {
    cursor?: AgentSessionCursor;
    libraryId: number;
    ownerScope: AgentOwnerScope;
    query?: string;
  }) => {
    requireMainWindow(event);
    return agentOrchestrator.listSessions(
      input?.ownerScope,
      Number(input?.libraryId),
      String(input?.query || ''),
      input?.cursor,
    );
  });

  ipcMain.handle('agent:session:get', (event, input: {
    libraryId: number;
    ownerScope: AgentOwnerScope;
    sessionId: string;
  }) => {
    requireMainWindow(event);
    return agentOrchestrator.getSession(
      String(input?.sessionId || ''),
      input?.ownerScope,
      Number(input?.libraryId),
    );
  });

  ipcMain.handle('agent:session:rename', (event, input: {
    libraryId: number;
    ownerScope: AgentOwnerScope;
    sessionId: string;
    title: string;
  }) => {
    requireMainWindow(event);
    return agentOrchestrator.renameSession(
      String(input?.sessionId || ''),
      input?.ownerScope,
      Number(input?.libraryId),
      String(input?.title || ''),
    );
  });

  ipcMain.handle('agent:session:delete', (event, input: {
    libraryId: number;
    ownerScope: AgentOwnerScope;
    sessionId: string;
  }) => {
    requireMainWindow(event);
    return agentOrchestrator.deleteSession(
      String(input?.sessionId || ''),
      input?.ownerScope,
      Number(input?.libraryId),
    );
  });
}

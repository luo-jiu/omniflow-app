import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import type { AgentSessionGroupInput, AgentSessionOrganizationInput, AgentSessionListFilter } from '../../src/shared/agent/agent-session-management';

import type {
  AgentChatRequest,
  AgentFileAuthorityCompletionV1,
  AgentInteractionSubmissionRequest,
  AgentMediaArtifactReleaseRequest,
  AgentMediaArtifactSaveRequest,
  AgentMediaArtifactUploadRequest,
  AgentMediaAudioExtractionRequest,
  AgentMediaInspectionRequest,
  AgentMemoryCursor,
  AgentMemoryDeleteRequest,
  AgentMemoryUpdateRequest,
  AgentOwnerScope,
  AgentSessionCursor,
  AgentToolApprovalDecisionRequest,
  AgentToolExecutionCompletion,
  AgentToolExecutionCommit,
  AgentToolExecutionProgressRequest,
  AgentToolPrepareCompletion,
} from '@/shared/agent/agent.types';
import { agentOrchestrator } from '../service/agent/agent-orchestrator';
import { getAgentAttachmentStore } from '../service/agent/agent-attachment-runtime';
import type { AgentAttachmentImport, AgentAttachmentScope } from '../../src/shared/agent/agent-attachments';
import { agentShellSettingsStore } from '../service/agent/shell/agent-shell-settings-store';
import { agentFileAuthorityBroker } from '../service/agent/agent-file-authority-broker';
import type { AgentShellLogPageRequestV1 } from '@/shared/agent/shell/agent-shell.types';
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
      agentFileAuthorityBroker.releaseOwner(sender.id);
    });
  }

  ipcMain.handle('agent:chat:start', (event, input: AgentChatRequest) => {
    const sender = requireMainWindow(event);
    ensureOwnerCleanup(sender);
    return agentOrchestrator.start(sender, input);
  });
  ipcMain.handle('agent:attachment:import', (event, input: AgentAttachmentImport) => {
    requireMainWindow(event);
    return getAgentAttachmentStore().import(input);
  });
  ipcMain.handle('agent:attachment:discard', (event, input: AgentAttachmentScope & { id: string }) => {
    requireMainWindow(event);
    return getAgentAttachmentStore().discard(input, input.id);
  });
  ipcMain.handle('agent:attachment:preview', (event, input: import('../../src/shared/agent/agent-attachments').AgentAttachmentPreviewRequest) => {
    requireMainWindow(event);
    return getAgentAttachmentStore().previewImage(input, input.id, input.sessionId);
  });

  ipcMain.handle('agent:chat:stop', (event, sessionId: string) => {
    const sender = requireMainWindow(event);
    return agentOrchestrator.stop(String(sessionId || ''), sender.id);
  });

  ipcMain.handle('agent:owner:release', (event) => {
    const sender = requireMainWindow(event);
    agentOrchestrator.releaseOwner(sender.id);
    agentFileAuthorityBroker.releaseOwner(sender.id);
    return true;
  });

  ipcMain.handle(
    'agent:file-authority:complete',
    (event, input: AgentFileAuthorityCompletionV1) => {
      const sender = requireMainWindow(event);
      return agentFileAuthorityBroker.complete(sender.id, input);
    },
  );

  ipcMain.handle('agent:shell:settings:get', (event) => {
    requireMainWindow(event);
    return agentShellSettingsStore.load();
  });

  ipcMain.handle('agent:shell:settings:update', (event, permissionMode: unknown) => {
    requireMainWindow(event);
    return agentShellSettingsStore.updatePermissionMode(permissionMode);
  });

  ipcMain.handle('agent:shell:log:read-page', (event, input: AgentShellLogPageRequestV1) => {
    requireMainWindow(event);
    return agentOrchestrator.readShellLogPage(input);
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
    'agent:interaction:submit',
    (event, input: AgentInteractionSubmissionRequest) => {
      const sender = requireMainWindow(event);
      ensureOwnerCleanup(sender);
      return agentOrchestrator.submitInteraction(sender.id, input);
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
    'agent:media:artifact:save',
    (event, input: AgentMediaArtifactSaveRequest) => {
      const sender = requireMainWindow(event);
      ensureOwnerCleanup(sender);
      return agentOrchestrator.saveMediaArtifact(sender, input);
    },
  );

  ipcMain.handle(
    'agent:media:artifact:upload',
    (event, input: AgentMediaArtifactUploadRequest) => {
      const sender = requireMainWindow(event);
      ensureOwnerCleanup(sender);
      return agentOrchestrator.uploadMediaArtifact(sender, input);
    },
  );

  ipcMain.handle(
    'agent:tool:prepare:complete',
    (event, input: AgentToolPrepareCompletion) => {
      const sender = requireMainWindow(event);
      ensureOwnerCleanup(sender);
      return agentOrchestrator.completeToolPreparation(sender.id, input);
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
    filter?: AgentSessionListFilter;
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
      input?.filter,
    );
  });
  ipcMain.handle('agent:tool:access-check', (event, input: Omit<import('../../src/shared/agent/agent.types').AgentToolExecutionCommit, 'result'>) => {
    const sender = requireMainWindow(event);
    return agentOrchestrator.verifyToolAccess(sender.id, input);
  });

  ipcMain.handle('agent:session:get', (event, input: {
    includeArchived?: boolean;
    libraryId: number;
    ownerScope: AgentOwnerScope;
    sessionId: string;
  }) => {
    requireMainWindow(event);
    return agentOrchestrator.getSession(
      String(input?.sessionId || ''),
      input?.ownerScope,
      Number(input?.libraryId),
      input?.includeArchived === true,
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

  ipcMain.handle('agent:group:list', (event, input: { ownerScope: AgentOwnerScope; libraryId: number }) => {
    requireMainWindow(event);
    return agentOrchestrator.listGroups(input.ownerScope, Number(input.libraryId));
  });
  ipcMain.handle('agent:group:save', (event, input: { ownerScope: AgentOwnerScope; libraryId: number; group: AgentSessionGroupInput }) => {
    requireMainWindow(event);
    return agentOrchestrator.saveGroup(input.ownerScope, Number(input.libraryId), input.group);
  });
  ipcMain.handle('agent:group:delete', (event, input: { ownerScope: AgentOwnerScope; libraryId: number; groupId: string; revision: number }) => {
    requireMainWindow(event);
    return agentOrchestrator.deleteGroup(input.ownerScope, Number(input.libraryId), input.groupId, input.revision);
  });
  ipcMain.handle('agent:session:organize', (event, input: { ownerScope: AgentOwnerScope; libraryId: number; sessionId: string; organization: AgentSessionOrganizationInput }) => {
    requireMainWindow(event);
    return agentOrchestrator.organizeSession(input.sessionId, input.ownerScope, Number(input.libraryId), input.organization);
  });
  ipcMain.handle('agent:session:archive', (event, input: { ownerScope: AgentOwnerScope; libraryId: number; sessionId: string; archived: boolean; revision: number }) => {
    requireMainWindow(event);
    return agentOrchestrator.archiveSession(input.sessionId, input.ownerScope, Number(input.libraryId), input.archived, input.revision);
  });

  ipcMain.handle('agent:memory:list', (event, input: {
    cursor?: AgentMemoryCursor;
    libraryId: number;
    ownerScope: AgentOwnerScope;
    query?: string;
  }) => {
    requireMainWindow(event);
    return agentOrchestrator.listMemories(
      input?.ownerScope,
      Number(input?.libraryId),
      String(input?.query || ''),
      input?.cursor,
    );
  });

  ipcMain.handle('agent:memory:update', (event, input: AgentMemoryUpdateRequest) => {
    requireMainWindow(event);
    return agentOrchestrator.updateMemory(input);
  });

  ipcMain.handle('agent:memory:delete', (event, input: AgentMemoryDeleteRequest) => {
    requireMainWindow(event);
    return agentOrchestrator.deleteMemory(input);
  });
}

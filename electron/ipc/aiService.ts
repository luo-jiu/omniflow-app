import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type {
  AIServiceCompletionInput,
  AIServiceRunSessionHandle,
  AIServiceSaveInput,
} from '@/features/ai-services/ai-service.types'
import {
  completeWithAIServiceProfile,
  listActiveAIServiceModels,
} from '../service/aiServiceClient'
import {
  activateAIServiceProfile,
  copyAIServiceProfile,
  getAIServiceRuntimeProfile,
  listAIServiceProfiles,
  revealAIServiceProfileApiKey,
  removeAIServiceProfile,
  reorderAIServiceProfileList,
  saveAIServiceProfile,
} from '../service/aiServiceStore'
import { aiServiceRunSessionRegistry } from '../service/aiServiceRunSession'
import { assertMainWindowAIServiceSender } from './aiServiceAccess'

interface RegisterAIServiceIpcOptions {
  getMainWindow: () => BrowserWindow | null;
}

export function registerAIServiceIpc(
  ipcMain: IpcMain,
  options: RegisterAIServiceIpcOptions,
) {
  const ownersWithCleanup = new Set<number>()

  function requireMainWindow(event: IpcMainInvokeEvent) {
    return assertMainWindowAIServiceSender(event, options.getMainWindow)
  }

  function ensureOwnerCleanup(sender: WebContents) {
    const ownerId = sender.id
    if (ownersWithCleanup.has(ownerId)) return
    ownersWithCleanup.add(ownerId)
    sender.once('destroyed', () => {
      ownersWithCleanup.delete(ownerId)
      aiServiceRunSessionRegistry.releaseOwner(ownerId)
    })
  }

  ipcMain.handle('ai-service:list', (event) => {
    requireMainWindow(event)
    return listAIServiceProfiles()
  })
  ipcMain.handle('ai-service:reveal-api-key', (event, id: string) => {
    requireMainWindow(event)
    return revealAIServiceProfileApiKey(id)
  })
  ipcMain.handle('ai-service:save', (event, input: AIServiceSaveInput) => {
    requireMainWindow(event)
    return saveAIServiceProfile(input)
  })
  ipcMain.handle('ai-service:set-active', (event, id: string) => {
    requireMainWindow(event)
    return activateAIServiceProfile(id)
  })
  ipcMain.handle('ai-service:reorder', (event, orderedIds: string[]) => {
    requireMainWindow(event)
    return reorderAIServiceProfileList(orderedIds)
  })
  ipcMain.handle('ai-service:duplicate', (event, id: string) => {
    requireMainWindow(event)
    return copyAIServiceProfile(id)
  })
  ipcMain.handle('ai-service:delete', (event, id: string) => {
    requireMainWindow(event)
    return removeAIServiceProfile(id)
  })
  ipcMain.handle('ai-service:list-models', (event) => {
    requireMainWindow(event)
    return listActiveAIServiceModels()
  })
  ipcMain.handle('ai-service:run:begin', (event, profileId: string): AIServiceRunSessionHandle => {
    const sender = requireMainWindow(event)
    ensureOwnerCleanup(sender)
    const profile = getAIServiceRuntimeProfile(String(profileId || ''))
    return aiServiceRunSessionRegistry.begin({
      connection: profile,
      ownerWebContentsId: sender.id,
      profileId: profile.id,
    })
  })
  ipcMain.handle('ai-service:run:end', (event, runSessionId: string) => {
    const sender = requireMainWindow(event)
    return aiServiceRunSessionRegistry.end(runSessionId, sender.id)
  })
  ipcMain.handle('ai-service:complete', async (event, input: AIServiceCompletionInput) => {
    const sender = requireMainWindow(event)
    const runRequest = input?.runSessionId
      ? aiServiceRunSessionRegistry.acquireRequest(input.runSessionId, input.profileId, sender.id)
      : undefined
    try {
      return await completeWithAIServiceProfile(
        input,
        runRequest?.connection,
        runRequest?.signal,
      )
    } finally {
      runRequest?.release()
    }
  })
}

import type {
  AIServiceCompletionInput,
  AIServiceRunSessionHandle,
  AIServiceSaveInput,
  AIServiceSnapshot,
} from './ai-service.types';

function bridge() {
  if (!window.electronAIService) {
    throw new Error('当前环境不支持本地 AI 服务配置');
  }
  return window.electronAIService;
}

export function fetchAIServiceProfiles(): Promise<AIServiceSnapshot> {
  return bridge().list();
}

export function saveAIServiceProfile(input: AIServiceSaveInput): Promise<AIServiceSnapshot> {
  return bridge().save(input);
}

export function revealAIServiceProfileApiKey(id: string): Promise<string> {
  return bridge().revealApiKey(id);
}

export function activateAIServiceProfile(id: string): Promise<AIServiceSnapshot> {
  return bridge().setActive(id);
}

export function reorderAIServiceProfiles(orderedIds: string[]): Promise<AIServiceSnapshot> {
  return bridge().reorder(orderedIds);
}

export function duplicateAIServiceProfile(id: string): Promise<AIServiceSnapshot> {
  return bridge().duplicate(id);
}

export function deleteAIServiceProfile(id: string): Promise<AIServiceSnapshot> {
  return bridge().delete(id);
}

export function fetchActiveAIServiceModels(): Promise<string[]> {
  return bridge().listModels();
}

export function beginAIServiceRun(profileId: string): Promise<AIServiceRunSessionHandle> {
  return bridge().beginRun(profileId);
}

export function endAIServiceRun(runSessionId: string): Promise<boolean> {
  return bridge().endRun(runSessionId);
}

export function completeWithAIService(input: AIServiceCompletionInput): Promise<string> {
  return bridge().complete(input);
}

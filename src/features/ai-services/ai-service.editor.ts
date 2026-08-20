import type {
  AIServiceProfile,
  AIServiceProviderType,
  AIServiceSaveInput,
} from './ai-service.types';

export interface AIServiceEditorDraft {
  apiKey: string;
  apiKeyDirty: boolean;
  apiKeyLoaded: boolean;
  baseUrl: string;
  hasStoredApiKey: boolean;
  id?: string;
  name: string;
  providerType: AIServiceProviderType;
}

export function createEmptyAIServiceEditorDraft(): AIServiceEditorDraft {
  return {
    apiKey: '',
    apiKeyDirty: false,
    apiKeyLoaded: false,
    baseUrl: 'http://localhost:11434/v1',
    hasStoredApiKey: false,
    name: '',
    providerType: 'local',
  };
}

export function createAIServiceEditorDraft(profile: AIServiceProfile): AIServiceEditorDraft {
  return {
    apiKey: '',
    apiKeyDirty: false,
    apiKeyLoaded: false,
    baseUrl: profile.baseUrl,
    hasStoredApiKey: profile.hasApiKey,
    id: profile.id,
    name: profile.name,
    providerType: profile.providerType,
  };
}

export function buildAIServiceSaveInput(draft: AIServiceEditorDraft): AIServiceSaveInput {
  const input: AIServiceSaveInput = {
    baseUrl: draft.baseUrl,
    id: draft.id,
    name: draft.name,
    providerType: draft.providerType,
  };
  if (!draft.apiKeyDirty) return input;
  const apiKey = draft.apiKey.trim();
  if (draft.id && !apiKey) {
    return { ...input, removeApiKey: true };
  }
  return { ...input, apiKey };
}

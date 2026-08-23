import type { AIServiceProviderType } from '@/shared/ai-service-provider-types';

export { AI_SERVICE_PROVIDER_TYPES } from '@/shared/ai-service-provider-types';
export type { AIServiceProviderType } from '@/shared/ai-service-provider-types';

export type AIServiceReasoningEffort = 'auto' | 'low' | 'medium' | 'high';

export interface AIServiceProfile {
  baseUrl: string;
  createdAt: string;
  hasApiKey: boolean;
  id: string;
  name: string;
  providerType: AIServiceProviderType;
  updatedAt: string;
}

export interface AIServiceSnapshot {
  activeProfileId: string | null;
  profiles: AIServiceProfile[];
}

export interface AIServiceSaveInput {
  apiKey?: string;
  baseUrl: string;
  id?: string;
  name: string;
  providerType: AIServiceProviderType;
  removeApiKey?: boolean;
}

export interface AIServiceCompletionInput {
  model: string;
  profileId: string;
  reasoningEffort?: AIServiceReasoningEffort;
  runSessionId?: string;
  systemPrompt: string;
  temperature?: number;
  userPrompt: string;
}

export interface AIServiceChatMessage {
  content: string;
  role: 'user' | 'assistant';
}

export interface AIServiceChatCompletionInput {
  maxOutputTokens?: number;
  messages: AIServiceChatMessage[];
  model: string;
  profileId: string;
  reasoningEffort?: AIServiceReasoningEffort;
  systemPrompt: string;
  temperature?: number;
}

export interface AIServiceRunSessionHandle {
  id: string;
  profileId: string;
}

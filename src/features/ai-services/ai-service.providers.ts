import claudeIconUrl from '@/assets/icons/ai-providers/claude.svg';
import deepseekIconUrl from '@/assets/icons/ai-providers/deepseek.svg';
import localIconUrl from '@/assets/icons/ai-providers/local.svg';
import openAIIconUrl from '@/assets/icons/ai-providers/openai.svg';
import {
  AI_SERVICE_PROVIDER_TYPES,
  type AIServiceProviderType,
} from './ai-service.types';

export interface AIServiceProviderDefinition {
  defaultBaseUrl: string;
  iconUrl: string;
  label: string;
  monochromeIcon?: boolean;
  type: AIServiceProviderType;
}

const AI_SERVICE_PROVIDER_DEFINITIONS: Record<AIServiceProviderType, AIServiceProviderDefinition> = {
  deepseek: {
    defaultBaseUrl: 'https://api.deepseek.com',
    iconUrl: deepseekIconUrl,
    label: 'DeepSeek',
    type: 'deepseek',
  },
  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1',
    iconUrl: openAIIconUrl,
    label: 'OpenAI',
    monochromeIcon: true,
    type: 'openai',
  },
  claude: {
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    iconUrl: claudeIconUrl,
    label: 'Claude',
    type: 'claude',
  },
  local: {
    defaultBaseUrl: 'http://localhost:11434/v1',
    iconUrl: localIconUrl,
    label: 'Local',
    monochromeIcon: true,
    type: 'local',
  },
};

export const AI_SERVICE_PROVIDERS = AI_SERVICE_PROVIDER_TYPES.map(
  (providerType) => AI_SERVICE_PROVIDER_DEFINITIONS[providerType],
);

export const AI_SERVICE_PROVIDER_BY_TYPE = AI_SERVICE_PROVIDER_DEFINITIONS;

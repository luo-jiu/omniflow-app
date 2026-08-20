export const AI_SERVICE_PROVIDER_TYPES = [
  'deepseek',
  'openai',
  'claude',
  'local',
] as const;

export type AIServiceProviderType = typeof AI_SERVICE_PROVIDER_TYPES[number];

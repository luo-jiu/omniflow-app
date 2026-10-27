import type { AIServiceReasoningEffort } from '../ai-service.types';

export const REASONING_EFFORT_LABELS: Readonly<Record<AIServiceReasoningEffort, string>> = {
  auto: '自动', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大',
};

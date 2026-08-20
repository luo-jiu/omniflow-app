import { AI_SERVICE_PROVIDER_BY_TYPE } from './ai-service.providers';
import type { AIServiceProviderType } from './ai-service.types';

interface AIServiceProviderLabelProps {
  providerType: AIServiceProviderType;
}

export function AIServiceProviderIcon({ providerType }: AIServiceProviderLabelProps) {
  const provider = AI_SERVICE_PROVIDER_BY_TYPE[providerType];
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`ai-service-provider-icon${provider.monochromeIcon ? ' is-monochrome' : ''}`}
      draggable={false}
      src={provider.iconUrl}
    />
  );
}

export default function AIServiceProviderLabel({ providerType }: AIServiceProviderLabelProps) {
  const provider = AI_SERVICE_PROVIDER_BY_TYPE[providerType];
  return (
    <span className="ai-service-provider-label">
      <AIServiceProviderIcon providerType={providerType} />
      <span>{provider.label}</span>
    </span>
  );
}

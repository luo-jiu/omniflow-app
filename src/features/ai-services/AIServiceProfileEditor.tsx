import React from 'react';
import { IconEyeClosed, IconEyeOpened } from '@douyinfe/semi-icons';
import { Button, Input, Select, Spin } from '@douyinfe/semi-ui';

import AIServiceProviderLabel from './AIServiceProviderLabel';
import { AI_SERVICE_PROVIDERS } from './ai-service.providers';
import type { AIServiceEditorDraft } from './ai-service.editor';
import type { AIServiceProviderType } from './ai-service.types';

interface AIServiceProfileEditorProps {
  draft: AIServiceEditorDraft;
  revealingApiKey: boolean;
  saving: boolean;
  onCancel: () => void;
  onChange: (changes: Partial<AIServiceEditorDraft>) => void;
  onProviderChange: (providerType: AIServiceProviderType) => void;
  onRevealApiKey: () => Promise<boolean>;
  onSave: () => void;
}

export default function AIServiceProfileEditor({
  draft,
  revealingApiKey,
  saving,
  onCancel,
  onChange,
  onProviderChange,
  onRevealApiKey,
  onSave,
}: AIServiceProfileEditorProps) {
  const [apiKeyVisible, setApiKeyVisible] = React.useState(false);

  const toggleApiKeyVisibility = React.useCallback(async () => {
    if (apiKeyVisible) {
      setApiKeyVisible(false);
      return;
    }
    if (draft.hasStoredApiKey && !draft.apiKeyLoaded) {
      if (!await onRevealApiKey()) return;
    }
    setApiKeyVisible(true);
  }, [apiKeyVisible, draft.apiKeyLoaded, draft.hasStoredApiKey, onRevealApiKey]);

  return (
    <section className="ai-service-editor" aria-labelledby="ai-service-editor-title">
      <h3 className="ai-service-editor-title" id="ai-service-editor-title">
        {draft.id ? '编辑 AI 服务配置' : '添加 AI 服务配置'}
      </h3>

      <div className="ai-service-form">
        <label className="ai-service-form-field">
          <span className="ai-service-form-label">配置名称</span>
          <Input
            disabled={saving}
            maxLength={60}
            placeholder="例如：本地 Ollama"
            value={draft.name}
            onChange={(name) => onChange({ name })}
          />
        </label>

        <label className="ai-service-form-field">
          <span className="ai-service-form-label">服务类型</span>
          <Select
            disabled={saving}
            value={draft.providerType}
            onChange={(value) => onProviderChange(String(value) as AIServiceProviderType)}
          >
            {AI_SERVICE_PROVIDERS.map((provider) => (
              <Select.Option
                key={provider.type}
                label={<AIServiceProviderLabel providerType={provider.type} />}
                showTick={false}
                value={provider.type}
              >
                <AIServiceProviderLabel providerType={provider.type} />
              </Select.Option>
            ))}
          </Select>
        </label>

        <label className="ai-service-form-field">
          <span className="ai-service-form-label">Base URL</span>
          <Input
            disabled={saving}
            placeholder="https://api.example.com/v1"
            value={draft.baseUrl}
            onChange={(baseUrl) => onChange({ baseUrl })}
          />
        </label>

        <div className="ai-service-form-field">
          <span className="ai-service-form-label">API Key</span>
          <Input
            disabled={saving || revealingApiKey}
            placeholder={draft.hasStoredApiKey && !draft.apiKeyLoaded ? '' : '本地服务可留空'}
            suffix={(
              <button
                aria-label={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                className="ai-service-key-visibility"
                disabled={saving || revealingApiKey}
                title={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                type="button"
                onClick={() => void toggleApiKeyVisibility()}
              >
                {revealingApiKey
                  ? <Spin size="small" />
                  : apiKeyVisible ? <IconEyeOpened /> : <IconEyeClosed />}
              </button>
            )}
            type={apiKeyVisible ? 'text' : 'password'}
            value={draft.apiKey}
            onChange={(apiKey) => onChange({
              apiKey,
              apiKeyDirty: true,
              apiKeyLoaded: true,
            })}
          />
        </div>
      </div>

      <div className="ai-service-editor-actions">
        <Button disabled={saving} onClick={onCancel}>取消</Button>
        <Button
          disabled={revealingApiKey}
          loading={saving}
          theme="solid"
          type="primary"
          onClick={onSave}
        >
          保存
        </Button>
      </div>
    </section>
  );
}

import React from 'react';
import { Button, TextArea } from '@douyinfe/semi-ui';
import {
  IconPlay,
  IconRedoStroked,
  IconStop,
} from '@douyinfe/semi-icons';
import styled from 'styled-components';

import AIModelSettingsControl from '@/features/ai-services/components/AIModelSettingsControl';

import type { RunnerSnapshot } from './subtitle-translation.runner';
import type { SubtitleTranslationConfig } from './types';

const ComposerShell = styled.section`
  flex: none;
  padding: 9px 10px 8px;
  border: 1px solid var(--app-border-strong);
  border-radius: 8px;
  background: color-mix(in srgb, var(--app-bg-elevated) 96%, transparent);
  box-shadow: 0 8px 24px color-mix(in srgb, #000 13%, transparent);

  .composer-prompt.semi-input-textarea-wrapper {
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .composer-prompt .semi-input-textarea {
    min-height: 48px;
    padding: 0 2px 7px;
    background: transparent;
    color: var(--app-text);
    font-size: 13px;
    line-height: 1.55;
    resize: none;
  }

  .composer-prompt .semi-input-textarea::placeholder {
    color: var(--app-text-muted);
  }
`;

const ComposerFooter = styled.div`
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  .composer-left,
  .composer-right {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .composer-left {
    flex: 1;
  }

  .composer-right {
    flex: none;
  }

  .composer-file-name {
    min-width: 0;
    max-width: 360px;
    overflow: hidden;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 30px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .composer-submit {
    min-height: 30px;
    height: 30px;
    padding: 0 12px;
    border-radius: var(--app-radius-large);
    font-size: 11px;
    font-weight: 700;
  }

  .composer-submit.composer-icon-action {
    width: 30px;
    min-width: 30px;
    max-width: 30px;
    height: 30px;
    min-height: 30px;
    max-height: 30px;
    flex: 0 0 30px;
    padding: 0;
    border-radius: 50%;
  }

  .composer-submit.composer-icon-action.retranslate-action {
    background: var(--semi-color-warning);
    color: #fff;
  }

  .composer-submit.composer-icon-action.retranslate-action:not(.semi-button-disabled):hover {
    background: var(--semi-color-warning-hover);
  }

  .composer-submit.composer-icon-action.start-action {
    background: var(--semi-color-success);
    color: #fff;
  }

  .composer-submit.composer-icon-action.start-action:not(.semi-button-disabled):hover {
    background: var(--semi-color-success-hover);
  }

  .composer-submit.composer-icon-action.semi-button-disabled {
    opacity: 0.38;
  }
`;

type SubtitleTranslationComposerProps = {
  availableModels: string[];
  config: SubtitleTranslationConfig;
  disabled: boolean;
  fileName: string;
  isRunnerActive: boolean;
  loadingModels: boolean;
  modelSourceKey: string;
  retranslateDisabled: boolean;
  runnerSnapshot: RunnerSnapshot;
  onConfigChange: (nextConfig: SubtitleTranslationConfig) => void;
  onLoadModels: () => Promise<boolean>;
  onRetranslateAll: () => void;
  onStartTranslation: () => void;
  onStopTranslation: () => void;
};

const SubtitleTranslationComposer: React.FC<SubtitleTranslationComposerProps> = ({
  availableModels,
  config,
  disabled,
  fileName,
  isRunnerActive,
  loadingModels,
  modelSourceKey,
  retranslateDisabled,
  runnerSnapshot,
  onConfigChange,
  onLoadModels,
  onRetranslateAll,
  onStartTranslation,
  onStopTranslation,
}) => (
  <ComposerShell aria-label="字幕翻译设置">
    <TextArea
      autosize={{ minRows: 2, maxRows: 4 }}
      className="composer-prompt"
      value={config.presetPrompt}
      onChange={(value) => onConfigChange({ ...config, presetPrompt: value })}
      placeholder="输入翻译要求，例如：翻译成简体中文；人名保留英文；术语采用社区常用译法；语气自然口语化。"
    />
    <ComposerFooter>
      <div className="composer-left">
        <span className="composer-file-name" title={fileName}>{fileName}</span>
      </div>
      <div className="composer-right">
        <AIModelSettingsControl
          availableModels={availableModels}
          contextWindow={{
            onChange: (contextWindow) => onConfigChange({ ...config, contextWindow }),
            value: config.contextWindow,
          }}
          loadingModels={loadingModels}
          model={config.model}
          modelSourceKey={modelSourceKey}
          reasoningEffort={config.reasoningEffort}
          onLoadModels={onLoadModels}
          onModelChange={(model) => onConfigChange({ ...config, model })}
          onReasoningEffortChange={(reasoningEffort) => onConfigChange({
            ...config,
            reasoningEffort,
          })}
        />
        {isRunnerActive ? (
          <Button
            className="composer-submit"
            icon={<IconStop />}
            type="danger"
            onClick={onStopTranslation}
          >
            停止翻译 {runnerSnapshot.doneCount}/{runnerSnapshot.totalCount}
          </Button>
        ) : (
          <>
            <Button
              aria-label="重新翻译全文"
              className="composer-submit composer-icon-action retranslate-action"
              disabled={retranslateDisabled}
              icon={<IconRedoStroked />}
              theme="solid"
              title="重新翻译全文"
              type="primary"
              onClick={onRetranslateAll}
            />
            <Button
              aria-label="开始翻译"
              className="composer-submit composer-icon-action start-action"
              disabled={disabled}
              icon={<IconPlay />}
              theme="solid"
              title="开始翻译"
              type="primary"
              onClick={onStartTranslation}
            />
          </>
        )}
      </div>
    </ComposerFooter>
  </ComposerShell>
);

export default SubtitleTranslationComposer;

import React from 'react';
import styled from 'styled-components';
import { IconDownload, IconFolder } from '@douyinfe/semi-icons';

import { Panel } from './styles';

const SaveTargetComposer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;

  .save-lane {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .action-cluster {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    min-height: 64px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--app-border) 86%, transparent);
    background: color-mix(in srgb, var(--app-bg) 84%, var(--app-bg-elevated));
  }

  .save-target-cluster {
    min-width: 0;
    background: color-mix(in srgb, #2f6fed 7%, var(--app-bg));
  }

  .cluster-label {
    display: inline-flex;
    align-items: center;
    font-size: 15px;
    font-weight: 700;
    color: var(--app-text);
    white-space: nowrap;
  }

  .save-target-mode-btn {
    height: 44px;
    min-width: 182px;
    border: none;
    border-radius: 999px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 600;
    transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
  }

  .save-target-mode-btn.local {
    background: color-mix(in srgb, #2f6fed 14%, var(--app-bg-elevated));
    color: color-mix(in srgb, #2f6fed 88%, var(--app-text));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #2f6fed 28%, transparent);
  }

  .save-target-mode-btn.internal {
    background: color-mix(in srgb, #1f9d63 16%, var(--app-bg-elevated));
    color: color-mix(in srgb, #1f9d63 86%, var(--app-text));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #1f9d63 30%, transparent);
  }

  .save-target-mode-btn:hover {
    color: var(--app-text);
    transform: translateY(-1px);
  }

  .save-target-mode-btn:active {
    transform: translateY(0);
  }

  .save-target-mode-btn:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--semi-color-primary) 66%, transparent);
    outline-offset: 2px;
  }

  .save-target-mode-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .save-target-mode-icon {
    width: 19px;
    height: 19px;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .save-target-mode-icon .mode-icon {
    position: absolute;
    inset: 0;
    margin: auto;
    font-size: 19px;
    transition: transform 180ms ease, opacity 180ms ease;
    opacity: 0;
    transform: scale(0.74) rotate(-18deg);
  }

  .save-target-mode-icon .mode-icon.active {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }

  .save-target-mode-btn.internal .save-target-mode-icon .mode-icon.active {
    transform: scale(1) rotate(-12deg);
  }

  .save-target-mode-switch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    font-size: 17px;
    font-weight: 700;
    line-height: 1;
    opacity: 0.92;
    transition: transform 180ms ease, opacity 180ms ease;
  }

  .save-target-mode-btn.local .save-target-mode-switch {
    transform: rotate(0deg);
  }

  .save-target-mode-btn.internal .save-target-mode-switch {
    transform: rotate(180deg);
  }

  .save-target-mode-btn:hover .save-target-mode-switch {
    opacity: 1;
  }

  .save-path-line {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 360px;
    min-width: 260px;
  }

  .save-path-trigger {
    flex: 1;
    min-width: 220px;
    height: 42px;
    border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-bg) 90%, var(--app-bg-elevated));
    color: var(--app-text);
    padding: 0 12px;
    text-align: left;
    cursor: pointer;
    transition: border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
  }

  .save-path-trigger:hover {
    border-color: color-mix(in srgb, var(--semi-color-primary) 52%, var(--app-border));
  }

  .save-path-trigger:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--semi-color-primary) 66%, transparent);
    outline-offset: 2px;
  }

  .save-path-trigger.is-empty {
    color: var(--app-text-muted);
  }

  .save-path-trigger.is-error {
    border-color: color-mix(in srgb, #db4652 80%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #db4652 36%, transparent);
    background: color-mix(in srgb, #db4652 10%, var(--app-bg));
  }

  .save-path-value {
    display: block;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    line-height: 1.4;
  }

  .save-path-required {
    font-size: 13px;
    font-weight: 600;
    color: #db4652;
    white-space: nowrap;
  }
`;

type ToolWorkspaceSaveTargetProps = {
  internalPathRequired: boolean;
  internalTargetMissing: boolean;
  isLocalSaveTarget: boolean;
  onPickSavePath: () => void;
  onToggleSaveTargetType: () => void;
  savePathDisplay: string;
  saveTargetType: 'internal' | 'local';
};

const ToolWorkspaceSaveTarget: React.FC<ToolWorkspaceSaveTargetProps> = ({
  internalPathRequired,
  internalTargetMissing,
  isLocalSaveTarget,
  onPickSavePath,
  onToggleSaveTargetType,
  savePathDisplay,
  saveTargetType,
}) => (
  <Panel>
    <div className="panel-title">保存目标</div>
    <div className="panel-desc">
      先切换保存目标：本地或内部。保存位置点击路径即可更改；内部保存未选目录时会提示“必须选择”，
      输出会自动上传到所选内部目录。
    </div>
    <SaveTargetComposer>
      <div className="save-lane">
        <div className="action-cluster save-target-cluster">
          <span className="cluster-label">保存目标</span>
          <button
            type="button"
            className={`save-target-mode-btn ${isLocalSaveTarget ? 'local' : 'internal'}`}
            onClick={onToggleSaveTargetType}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                onToggleSaveTargetType();
              }
            }}
            aria-label="切换保存目标"
            title="切换保存目标"
          >
            <span className="save-target-mode-label">
              <span className="save-target-mode-icon" aria-hidden>
                <IconDownload className={`mode-icon ${isLocalSaveTarget ? 'active' : ''}`} />
                <IconFolder className={`mode-icon ${isLocalSaveTarget ? '' : 'active'}`} />
              </span>
              {isLocalSaveTarget ? '保存到本地' : '保存到内部'}
            </span>
            <span className="save-target-mode-switch">⇄</span>
          </button>
          <div className="save-path-line">
            <button
              type="button"
              className={`save-path-trigger ${saveTargetType === 'internal' && !savePathDisplay ? 'is-empty' : ''} ${internalPathRequired && internalTargetMissing ? 'is-error' : ''}`}
              onClick={onPickSavePath}
              title={savePathDisplay || '点击选择内部保存路径'}
            >
              <span className="save-path-value">{savePathDisplay || '\u00A0'}</span>
            </button>
            {internalPathRequired && internalTargetMissing ? (
              <span className="save-path-required">必须选择</span>
            ) : null}
          </div>
        </div>
      </div>
    </SaveTargetComposer>
  </Panel>
);

export default ToolWorkspaceSaveTarget;

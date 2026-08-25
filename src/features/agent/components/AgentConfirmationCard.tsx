import React from 'react';
import { IconFolder } from '@douyinfe/semi-icons';
import styled from 'styled-components';

import {
  LibraryNodePickerModal,
  type LibraryNodePickerSelection,
} from '@/features/file-explorer';
import type {
  AgentPreparedActionPublic,
  AgentToolApprovalSnapshot,
} from '@/shared/agent/agent.types';

const ConfirmationCard = styled.article`
  width: min(620px, 100%);
  align-self: flex-start;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--semi-color-warning) 42%, var(--app-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--semi-color-warning-light-default) 35%, var(--app-bg-elevated));

  .agent-confirmation-heading {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .agent-confirmation-icon {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    border-radius: var(--app-radius-small);
    background: color-mix(in srgb, var(--semi-color-warning) 14%, transparent);
    color: var(--semi-color-warning);
  }

  h3 {
    margin: 0;
    font-size: 14px;
    line-height: 1.35;
  }

  p {
    margin: 8px 0 0;
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.55;
  }

  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 6px 12px;
    margin: 12px 0 0;
    font-size: 13px;
  }

  dt {
    color: var(--app-text-muted);
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .agent-confirmation-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }

  button {
    min-width: 68px;
    height: 32px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--app-radius-medium);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .agent-confirmation-cancel {
    background: var(--semi-color-fill-1);
    color: var(--app-text);
  }

  .agent-confirmation-allow {
    background: var(--semi-color-primary);
    color: #fff;
  }

  .agent-confirmation-editor {
    display: grid;
    gap: 10px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid color-mix(in srgb, var(--semi-color-warning) 25%, var(--app-border));
  }

  .agent-confirmation-destination {
    width: fit-content;
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--app-radius-medium);
    background: var(--semi-color-fill-1);
  }

  .agent-confirmation-destination button {
    min-width: 72px;
    height: 28px;
    padding: 0 10px;
    border-radius: calc(var(--app-radius-medium) - 2px);
    background: transparent;
    color: var(--app-text-muted);
  }

  .agent-confirmation-destination button[data-active='true'] {
    background: var(--app-bg-elevated);
    color: var(--app-text);
  }

  .agent-confirmation-field {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .agent-confirmation-field > span:first-child {
    color: var(--app-text-muted);
  }

  .agent-confirmation-field input,
  .agent-confirmation-field select,
  .agent-confirmation-target {
    width: 100%;
    min-width: 0;
    height: 32px;
    border: 1px solid var(--app-border);
    border-radius: var(--app-radius-small);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    font: inherit;
    font-size: 13px;
  }

  .agent-confirmation-field input,
  .agent-confirmation-field select {
    padding: 0 9px;
  }

  .agent-confirmation-target {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0 9px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-confirmation-fallback {
    min-height: 28px;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 80px;
    color: var(--app-text-muted);
    font-size: 13px;
  }

  .agent-confirmation-fallback input {
    width: 15px;
    height: 15px;
    margin: 0;
  }
`;

interface AgentConfirmationCardProps {
  approval: AgentToolApprovalSnapshot;
  busy: boolean;
  libraryId: number;
  onResolve: (approved: boolean, preparedAction?: AgentPreparedActionPublic) => void;
}

const OUTPUT_FORMATS = ['m4a', 'mp3', 'wav'] as const;

function replaceOutputExtension(fileName: string, format: string): string {
  const normalized = String(fileName || '').trim();
  if (!normalized) return `extracted-audio.${format}`;
  if (/\.(m4a|mp3|wav)$/iu.test(normalized)) {
    return normalized.replace(/\.(m4a|mp3|wav)$/iu, `.${format}`);
  }
  return `${normalized}.${format}`;
}

export default function AgentConfirmationCard({
  approval,
  busy,
  libraryId,
  onResolve,
}: AgentConfirmationCardProps) {
  const initialAction = approval.preparation?.action;
  const [preparedAction, setPreparedAction] = React.useState(initialAction);
  const [pickerVisible, setPickerVisible] = React.useState(false);
  const libraryAvailable = initialAction?.destination === 'library';
  const libraryTargetRef = React.useRef<Pick<AgentPreparedActionPublic, 'parentId' | 'targetLabel'>>({
    parentId: initialAction?.parentId,
    targetLabel: initialAction?.targetLabel || '当前目录',
  });

  React.useEffect(() => {
    setPreparedAction(initialAction);
    if (initialAction?.destination === 'library') {
      libraryTargetRef.current = {
        parentId: initialAction.parentId,
        targetLabel: initialAction.targetLabel,
      };
    }
  }, [initialAction]);

  const updateDestination = React.useCallback((destination: 'library' | 'local') => {
    setPreparedAction((current) => {
      if (!current || current.destination === destination) return current;
      if (destination === 'library') {
        return {
          ...current,
          destination,
          fallbackPolicy: 'prompt_local',
          parentId: libraryTargetRef.current.parentId,
          targetLabel: libraryTargetRef.current.targetLabel,
        };
      }
      if (current.destination === 'library') {
        libraryTargetRef.current = {
          parentId: current.parentId,
          targetLabel: current.targetLabel,
        };
      }
      return {
        ...current,
        destination,
        fallbackPolicy: 'none',
        parentId: undefined,
        targetLabel: '本机（执行时选择位置）',
      };
    });
  }, []);

  const handleDirectorySelected = React.useCallback((selection: LibraryNodePickerSelection) => {
    libraryTargetRef.current = {
      parentId: selection.node.id,
      targetLabel: selection.pathLabel,
    };
    setPreparedAction(current => current ? {
      ...current,
      parentId: selection.node.id,
      targetLabel: selection.pathLabel,
    } : current);
    setPickerVisible(false);
  }, []);

  return (
    <>
      <ConfirmationCard>
        <div className="agent-confirmation-heading">
          <span className="agent-confirmation-icon"><IconFolder aria-hidden="true" /></span>
          <h3>{approval.preview.title}</h3>
        </div>
        <p>{approval.preview.description}</p>
        {preparedAction ? (
          <div className="agent-confirmation-editor">
            <div className="agent-confirmation-destination" role="group" aria-label="保存位置">
              <button
                data-active={preparedAction.destination === 'library'}
                disabled={busy || !libraryAvailable}
                onClick={() => updateDestination('library')}
                type="button"
              >
                资料库
              </button>
              <button
                data-active={preparedAction.destination === 'local'}
                disabled={busy}
                onClick={() => updateDestination('local')}
                type="button"
              >
                本机
              </button>
            </div>
            <label className="agent-confirmation-field">
              <span>文件名</span>
              <input
                disabled={busy}
                onChange={event => setPreparedAction(current => current ? {
                  ...current,
                  outputFileName: event.target.value,
                } : current)}
                value={preparedAction.outputFileName}
              />
            </label>
            <label className="agent-confirmation-field">
              <span>格式</span>
              <select
                disabled={busy}
                onChange={(event) => {
                  const outputFormat = event.target.value;
                  setPreparedAction(current => current ? {
                    ...current,
                    outputFileName: replaceOutputExtension(current.outputFileName, outputFormat),
                    outputFormat,
                  } : current);
                }}
                value={preparedAction.outputFormat}
              >
                {OUTPUT_FORMATS.map(format => (
                  <option key={format} value={format}>{format.toUpperCase()}</option>
                ))}
              </select>
            </label>
            <div className="agent-confirmation-field">
              <span>保存到</span>
              {preparedAction.destination === 'library' ? (
                <button
                  className="agent-confirmation-target"
                  disabled={busy}
                  onClick={() => setPickerVisible(true)}
                  title={preparedAction.targetLabel}
                  type="button"
                >
                  {preparedAction.targetLabel}
                </button>
              ) : (
                <span className="agent-confirmation-target">执行时选择本机位置</span>
              )}
            </div>
            {preparedAction.destination === 'library' ? (
              <label className="agent-confirmation-fallback">
                <input
                  checked={preparedAction.fallbackPolicy === 'prompt_local'}
                  disabled={busy}
                  onChange={event => setPreparedAction(current => current ? {
                    ...current,
                    fallbackPolicy: event.target.checked ? 'prompt_local' : 'none',
                  } : current)}
                  type="checkbox"
                />
                上传在提交前明确失败时，询问保存到本机
              </label>
            ) : null}
          </div>
        ) : approval.preview.details?.length ? (
          <dl>
            {approval.preview.details.map(detail => (
              <React.Fragment key={`${detail.label}:${detail.value}`}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        ) : null}
        <div className="agent-confirmation-actions">
          <button
            className="agent-confirmation-cancel"
            disabled={busy}
            onClick={() => onResolve(false)}
            type="button"
          >
            取消
          </button>
          <button
            className="agent-confirmation-allow"
            disabled={busy || Boolean(initialAction && !preparedAction)}
            onClick={() => onResolve(true, preparedAction)}
            type="button"
          >
            {busy ? '处理中' : '允许'}
          </button>
        </div>
      </ConfirmationCard>
      {preparedAction ? (
        <LibraryNodePickerModal
          displayMode="folders"
          libraryId={libraryId}
          onCancel={() => setPickerVisible(false)}
          onConfirm={handleDirectorySelected}
          title="选择保存目录"
          visible={pickerVisible}
        />
      ) : null}
    </>
  );
}

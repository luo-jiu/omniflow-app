import React from 'react';
import { IconFolder, IconTerminal } from '@douyinfe/semi-icons';
import styled from 'styled-components';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';

import {
  LibraryNodePickerModal,
  type LibraryNodePickerSelection,
} from '@/features/file-explorer';
import type {
  AgentMediaExtractAudioOutputFormat,
  AgentMediaExtractAudioPreparedActionPublicV1,
  AgentPreparedActionPublic,
  AgentPluginRenamePreparedActionPublicV1,
  AgentShellPreparedActionPublicV1,
  AgentToolApprovalSnapshot,
} from '@/shared/agent/agent.types';
import { normalizeAgentPreparedActionPublic } from '@/shared/agent/agent-prepared-action';
import { formatAgentShellCommandForDisplay } from '../agent-shell-command-display';

const ConfirmationCard = styled.article`
  width: min(620px, 100%);
  align-self: flex-start;
  padding: 4px 3px 8px;
  border: 0;
  border-radius: 0;
  background: transparent;

  .agent-confirmation-heading {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .agent-confirmation-icon {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    border-radius: var(--app-radius-small);
    background: transparent;
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

  .agent-confirmation-shell {
    display: grid;
    gap: 10px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid color-mix(in srgb, var(--semi-color-warning) 25%, var(--app-border));
  }

  .agent-confirmation-shell-command {
    ${workspaceScrollbarStyles}
    max-height: 240px;
    margin: 0;
    padding: 10px 12px;
    overflow: auto;
    border: 1px solid var(--app-border);
    border-radius: var(--app-radius-small);
    background: var(--semi-color-fill-0);
    color: var(--app-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    direction: ltr;
    unicode-bidi: isolate;
  }

  .agent-confirmation-rename-changes {
    max-height: 280px;
    margin-top: 12px;
    padding: 0 10px 10px;
    overflow: auto;
    border: 1px solid var(--app-border);
    border-radius: var(--app-radius-small);
    background: var(--semi-color-fill-0);
    color: var(--app-text);
    line-height: 1.5;
    ${workspaceScrollbarStyles}
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

interface LibraryTargetDraft {
  parentId?: number;
  targetLabel: string;
}

interface PreparedActionDraft {
  action: AgentMediaExtractAudioPreparedActionPublicV1;
  preparedActionId: string;
}

function normalizeMediaPreparedAction(
  action: AgentPreparedActionPublic | undefined,
): AgentMediaExtractAudioPreparedActionPublicV1 | undefined {
  if (!action) return undefined;
  try {
    const normalized = normalizeAgentPreparedActionPublic(action);
    return normalized.kind === 'media.extractAudio' && normalized.version === 1
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeShellPreparedAction(
  action: AgentPreparedActionPublic | undefined,
): AgentShellPreparedActionPublicV1 | undefined {
  if (!action) return undefined;
  try {
    const normalized = normalizeAgentPreparedActionPublic(action);
    return normalized.kind === 'shell.run' && normalized.version === 1
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
}

function isFileBridgePreparedAction(
  action: AgentPreparedActionPublic | undefined,
): boolean {
  if (!action) return false;
  try {
    const normalized = normalizeAgentPreparedActionPublic(action);
    return (
      normalized.kind === 'file.stage'
      || normalized.kind === 'file.publish'
      || normalized.kind === 'file.upload'
    )
      && normalized.version === 1;
  } catch {
    return false;
  }
}

function normalizeRenamePreparedAction(action: AgentPreparedActionPublic | undefined, libraryId: number, toolName: string): AgentPluginRenamePreparedActionPublicV1 | undefined {
  if (!action) return undefined;
  try {
    const normalized = normalizeAgentPreparedActionPublic(action);
    return normalized.kind === 'plugin.rename' && normalized.libraryId === libraryId
      && toolName.length <= 128 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(toolName)
      && toolName.startsWith(`${normalized.pluginId}.`) ? normalized : undefined;
  } catch { return undefined; }
}

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
  const preparation = approval.preparation;
  const preparedActionId = preparation?.preparedActionId;
  const initialAction = React.useMemo(
    () => normalizeMediaPreparedAction(preparation?.action),
    [preparation?.action],
  );
  const shellAction = React.useMemo(
    () => normalizeShellPreparedAction(preparation?.action),
    [preparation?.action],
  );
  const fileBridgeAction = React.useMemo(
    () => isFileBridgePreparedAction(preparation?.action),
    [preparation?.action],
  );
  const renameAction = React.useMemo(
    () => normalizeRenamePreparedAction(preparation?.action, libraryId, approval.call.name),
    [preparation?.action, libraryId, approval.call.name],
  );
  const fileOutputAction = React.useMemo(() => {
    try {
      const action = normalizeAgentPreparedActionPublic(preparation?.action);
      return action.kind === 'plugin.file-output' && action.libraryId === libraryId
        && approval.call.name.startsWith(`${action.pluginId}.`) ? action : undefined;
    } catch { return undefined; }
  }, [preparation?.action, libraryId, approval.call.name]);
  const [preparedActionDraft, setPreparedActionDraft] = React.useState<PreparedActionDraft | undefined>(
    () => initialAction && preparedActionId
      ? { action: initialAction, preparedActionId }
      : undefined,
  );
  const [pickerVisible, setPickerVisible] = React.useState(false);
  const preparedAction = preparedActionDraft && preparedActionDraft.preparedActionId === preparedActionId
    ? preparedActionDraft.action
    : initialAction;
  const unsupportedPreparation = Boolean(
    preparation && !initialAction && !shellAction && !fileBridgeAction && !renameAction && !fileOutputAction,
  );
  const libraryTargetRef = React.useRef<LibraryTargetDraft>({
    parentId: initialAction?.parentId,
    targetLabel: initialAction?.destination === 'library' ? initialAction.targetLabel : '选择资料库目录',
  });

  React.useEffect(() => {
    setPreparedActionDraft(initialAction && preparedActionId
      ? { action: initialAction, preparedActionId }
      : undefined);
    setPickerVisible(false);
    if (initialAction?.destination === 'library') {
      libraryTargetRef.current = {
        parentId: initialAction.parentId,
        targetLabel: initialAction.targetLabel,
      };
    }
  }, [initialAction, preparedActionId]);

  const updatePreparedAction = React.useCallback((
    update: (
      current: AgentMediaExtractAudioPreparedActionPublicV1,
    ) => AgentMediaExtractAudioPreparedActionPublicV1,
  ) => {
    if (!preparedActionId) return;
    setPreparedActionDraft((current) => {
      const currentAction = current?.preparedActionId === preparedActionId
        ? current.action
        : initialAction;
      return currentAction
        ? { action: update(currentAction), preparedActionId }
        : current;
    });
  }, [initialAction, preparedActionId]);

  const updateDestination = React.useCallback((destination: 'library' | 'local') => {
    updatePreparedAction((current) => {
      if (current.destination === destination) return current;
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
      const localAction = { ...current };
      delete localAction.parentId;
      return {
        ...localAction,
        destination,
        fallbackPolicy: 'none',
        targetLabel: '本机（执行时选择位置）',
      };
    });
  }, [updatePreparedAction]);

  const handleDirectorySelected = React.useCallback((selection: LibraryNodePickerSelection) => {
    libraryTargetRef.current = {
      parentId: selection.node.id,
      targetLabel: selection.pathLabel,
    };
    updatePreparedAction(current => ({
      ...current,
      parentId: selection.node.id,
      targetLabel: selection.pathLabel,
    }));
    setPickerVisible(false);
  }, [updatePreparedAction]);

  return (
    <>
      <ConfirmationCard>
        <div className="agent-confirmation-heading">
          <span className="agent-confirmation-icon">
            {shellAction
              ? <IconTerminal aria-hidden="true" />
              : <IconFolder aria-hidden="true" />}
          </span>
          <h3>{approval.preview.title}</h3>
        </div>
        <p>{approval.preview.description}</p>
        {unsupportedPreparation ? (
          <p role="alert">当前版本无法识别此准备动作，请取消后重试。</p>
        ) : shellAction ? (
          <div className="agent-confirmation-shell">
            <pre className="agent-confirmation-shell-command">
              {formatAgentShellCommandForDisplay(shellAction.command)}
            </pre>
            <dl>
              <dt>Provider</dt>
              <dd>{shellAction.provider.id} ({shellAction.provider.version})</dd>
              <dt>工作目录</dt>
              <dd>{shellAction.cwd.path}</dd>
              <dt>风险</dt>
              <dd>{shellAction.assessment.risk}</dd>
              <dt>超时</dt>
              <dd>{shellAction.timeoutMs} ms</dd>
              {shellAction.environment.map(entry => (
                <React.Fragment key={entry.name}>
                  <dt>{entry.name}</dt>
                  <dd>{entry.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        ) : fileOutputAction ? (
          <div className="agent-confirmation-shell"><dl>
            <dt>插件</dt><dd>{fileOutputAction.pluginId}@{fileOutputAction.pluginVersion}</dd>
            {approval.preview.details?.find(entry => entry.label === '来源文件' && entry.value.trim()) ? <>
              <dt>来源文件</dt><dd>{approval.preview.details.find(entry => entry.label === '来源文件' && entry.value.trim())!.value}</dd>
            </> : null}
            <dt>新文件</dt><dd>{fileOutputAction.fileName}</dd>
            <dt>目标目录</dt><dd>{approval.preview.details?.find(entry => entry.label === '目标目录' && entry.value.trim())?.value ?? `#${fileOutputAction.parentId}`}</dd>
            <dt>存储服务</dt><dd>{fileOutputAction.providerId}</dd>
            <dt>文件格式</dt><dd>{fileOutputAction.mediaType}</dd>
            <dt>文件大小</dt><dd>{fileOutputAction.sizeBytes} 字节</dd>
            <dt>内容 SHA-256</dt><dd>{fileOutputAction.sha256}</dd>
            <dt>保存方式</dt><dd>仅新建，同名冲突时停止，不覆盖现有文件</dd>
          </dl></div>
        ) : renameAction ? (
          <div className="agent-confirmation-shell">
            <dl>
              <dt>插件</dt><dd>{renameAction.pluginId}@{renameAction.pluginVersion}</dd>
              <dt>版本指纹</dt><dd>{renameAction.packageFingerprint}</dd>
              <dt>文件数量</dt><dd>{renameAction.items.length}</dd>
            </dl>
            <div className="agent-confirmation-rename-changes" role="region" aria-label="完整重命名预览" tabIndex={0}>
              <dl>
                {renameAction.items.map((item, index) => (
                  <React.Fragment key={item.nodeId}>
                    <dt>{index + 1}</dt>
                    <dd><bdi>{item.oldName}</bdi>{' → '}<bdi>{item.newName}</bdi></dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          </div>
        ) : preparedAction ? (
          <div className="agent-confirmation-editor">
            <div className="agent-confirmation-destination" role="group" aria-label="保存位置">
              <button
                data-active={preparedAction.destination === 'library'}
                disabled={busy}
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
                onChange={event => updatePreparedAction(current => ({
                  ...current,
                  outputFileName: event.target.value,
                }))}
                value={preparedAction.outputFileName}
              />
            </label>
            <label className="agent-confirmation-field">
              <span>格式</span>
              <select
                disabled={busy}
                onChange={(event) => {
                  const outputFormat = event.target.value as AgentMediaExtractAudioOutputFormat;
                  updatePreparedAction(current => ({
                    ...current,
                    outputFileName: replaceOutputExtension(current.outputFileName, outputFormat),
                    outputFormat,
                  }));
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
                  onChange={event => updatePreparedAction(current => ({
                    ...current,
                    fallbackPolicy: event.target.checked ? 'prompt_local' : 'none',
                  }))}
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
            disabled={busy || unsupportedPreparation || Boolean(initialAction && !preparedAction)
              || (preparedAction?.destination === 'library' && !(Number.isSafeInteger(preparedAction.parentId) && Number(preparedAction.parentId) > 0))}
            onClick={() => onResolve(true, fileOutputAction ?? renameAction ?? (shellAction ? undefined : preparedAction))}
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

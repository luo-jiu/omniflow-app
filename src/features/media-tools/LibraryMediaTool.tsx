import React from 'react';
import { Button, Empty, Tag, Toast } from '@douyinfe/semi-ui';
import { IconFile, IconMusic, IconVideoStroked } from '@douyinfe/semi-icons';
import styled from 'styled-components';
import type { SelectedTreeNode } from '@/features/file-explorer';
import {
  LibraryNodePickerModal,
  type LibraryNodePickerSelection,
} from '@/features/file-explorer';
import {
  getDesktopDefaultDownloadDirectory,
  pickDownloadDirectoryFromDesktop,
} from '@/features/file-explorer/services/desktop-download.api';
import { getFileLink } from '@/features/file-explorer/services/file.api';
import { useResourceImportToLibrary } from '@/features/embedded-browser/resources/hooks/useResourceImportToLibrary';
import ToolWorkspaceSaveTarget from '@/features/tool-workspace/ToolWorkspaceSaveTarget';
import {
  Panel,
  WorkspaceBody,
  WorkspaceHeader,
} from '@/features/tool-workspace/styles';
import {
  processLibraryMediaFile,
  type LibraryMediaToolOperation,
} from './services/media-tool.api';

type MediaSaveTargetType = 'local' | 'internal';

interface LibraryMediaToolProps {
  libraryId: number;
  request: {
    id: number;
    node: SelectedTreeNode;
  } | null;
  onRefreshDirectory?: (directoryId: number) => Promise<void> | void;
}

const ToolPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;

  .source-card {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    min-height: 62px;
    padding: 10px 12px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-bg) 88%, var(--app-bg-elevated));
  }

  .source-icon {
    display: inline-flex;
    width: 38px;
    height: 38px;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: color-mix(in srgb, var(--semi-color-primary-light-default) 76%, var(--app-bg));
    color: var(--semi-color-primary);
    font-size: 18px;
  }

  .source-main {
    min-width: 0;
  }

  .source-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 700;
    color: var(--app-text);
  }

  .source-meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 6px;
  }

  .action-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .action-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 118px;
    padding: 12px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg-elevated);
  }

  .action-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 700;
    color: var(--app-text);
  }

  .action-desc {
    flex: 1;
    font-size: 11px;
    line-height: 1.55;
    color: var(--app-text-muted);
  }

  @media (max-width: 1220px) {
    .action-row {
      grid-template-columns: 1fr;
    }
  }
`;

function normalizeExt(ext?: string | null) {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '');
}

function buildDisplayName(node: SelectedTreeNode) {
  const ext = normalizeExt(node.ext);
  const name = String(node.name || '').trim() || 'media';
  if (!ext || name.toLowerCase().endsWith(`.${ext}`)) {
    return name;
  }
  return `${name}.${ext}`;
}

function isVideoNode(node: SelectedTreeNode | null) {
  if (!node || node.type !== 'file') return false;
  if (String(node.mimeType || '').toLowerCase().startsWith('video/')) return true;
  return ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'flv', 'wmv', 'ts'].includes(normalizeExt(node.ext));
}

function isAudioNode(node: SelectedTreeNode | null) {
  if (!node || node.type !== 'file') return false;
  if (String(node.mimeType || '').toLowerCase().startsWith('audio/')) return true;
  return ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'wma', 'aiff'].includes(normalizeExt(node.ext));
}

const LibraryMediaTool: React.FC<LibraryMediaToolProps> = ({
  libraryId,
  onRefreshDirectory,
  request,
}) => {
  const sourceNode = request?.node ?? null;
  const [runningOperation, setRunningOperation] = React.useState<LibraryMediaToolOperation | null>(null);
  const [saveTargetType, setSaveTargetType] = React.useState<MediaSaveTargetType>('local');
  const [localOutputDirectory, setLocalOutputDirectory] = React.useState('');
  const [defaultLocalOutputDirectory, setDefaultLocalOutputDirectory] = React.useState('');
  const [internalDirectory, setInternalDirectory] = React.useState<LibraryNodePickerSelection | null>(null);
  const [internalPickerVisible, setInternalPickerVisible] = React.useState(false);
  const [internalPathRequired, setInternalPathRequired] = React.useState(false);
  const {
    cleanupTaskTempImportDirectory,
    createTaskTempImportDirectory,
    importOutputToLibrary,
  } = useResourceImportToLibrary({
    libraryId,
    onImportSuccess: async ({ parentId }) => {
      await onRefreshDirectory?.(parentId);
    },
  });

  const sourceName = sourceNode ? buildDisplayName(sourceNode) : '';
  const sourceIsVideo = isVideoNode(sourceNode);
  const sourceIsAudio = isAudioNode(sourceNode);
  const isLocalSaveTarget = saveTargetType === 'local';
  const internalTargetMissing = saveTargetType === 'internal' && !internalDirectory;
  const localOutputPathHint = localOutputDirectory || defaultLocalOutputDirectory || '默认下载目录';
  const savePathDisplay = saveTargetType === 'local'
    ? localOutputPathHint
    : (internalDirectory?.pathLabel || '');
  const actionLabelSuffix = saveTargetType === 'local' ? '保存' : '导入';

  React.useEffect(() => {
    let cancelled = false;
    void getDesktopDefaultDownloadDirectory()
      .then((directoryPath) => {
        if (!cancelled && directoryPath) {
          setDefaultLocalOutputDirectory(directoryPath);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    setInternalPathRequired(false);
  }, [internalDirectory, saveTargetType]);

  const pickSavePath = React.useCallback(async () => {
    if (saveTargetType === 'local') {
      const result = await pickDownloadDirectoryFromDesktop();
      if (!result.canceled && result.directoryPath) {
        setLocalOutputDirectory(result.directoryPath);
        Toast.success('已选择本地保存目录');
      }
      return;
    }
    setInternalPickerVisible(true);
  }, [saveTargetType]);

  const toggleSaveTargetType = React.useCallback(() => {
    setSaveTargetType((current) => (current === 'local' ? 'internal' : 'local'));
  }, []);

  const runOperation = React.useCallback(async (operation: LibraryMediaToolOperation) => {
    if (!sourceNode) {
      Toast.warning('请先从目录树右键选择媒体文件');
      return;
    }
    if (operation === 'compress-video' && !sourceIsVideo) {
      Toast.warning('压缩画质需要选择视频文件');
      return;
    }
    if (operation === 'extract-audio' && !sourceIsVideo && !sourceIsAudio) {
      Toast.warning('提取音频需要选择音频或视频文件');
      return;
    }
    if (saveTargetType === 'internal' && !internalDirectory) {
      setInternalPathRequired(true);
      Toast.warning('资源库目录必须选择');
      return;
    }

    setRunningOperation(operation);
    let tempOutputDirectory = '';
    try {
      const outputDirectoryPath = saveTargetType === 'internal'
        ? await createTaskTempImportDirectory()
        : (localOutputDirectory || defaultLocalOutputDirectory || undefined);
      tempOutputDirectory = saveTargetType === 'internal' ? outputDirectoryPath || '' : '';

      const inputUrl = await getFileLink(sourceNode.id, sourceNode.libraryId || libraryId, 120);
      const result = await processLibraryMediaFile({
        inputFileName: sourceName,
        inputUrl,
        operation,
        outputDirectoryPath,
      });
      if (!result.outputPath) {
        throw new Error('处理完成但没有返回输出文件');
      }

      if (saveTargetType === 'internal') {
        if (!internalDirectory) {
          throw new Error('资源库目录必须选择');
        }
        await importOutputToLibrary(result.outputPath, {
          id: internalDirectory.node.id,
          pathLabel: internalDirectory.pathLabel,
        }, operation === 'extract-audio' ? '提取音频' : '压缩画质');
        tempOutputDirectory = '';
        return;
      }

      Toast.success(operation === 'extract-audio' ? '已完成音频提取' : '已完成视频压缩');
    } catch (error: any) {
      if (tempOutputDirectory) {
        await cleanupTaskTempImportDirectory(tempOutputDirectory);
      }
      Toast.error(error?.message || '媒体处理失败');
    } finally {
      setRunningOperation(null);
    }
  }, [
    cleanupTaskTempImportDirectory,
    createTaskTempImportDirectory,
    defaultLocalOutputDirectory,
    importOutputToLibrary,
    internalDirectory,
    libraryId,
    localOutputDirectory,
    saveTargetType,
    sourceIsAudio,
    sourceIsVideo,
    sourceName,
    sourceNode,
  ]);

  return (
    <>
      <WorkspaceHeader>
        <div className="header-copy">
          <div className="header-title">媒体文件处理</div>
          <div className="header-desc">
            面向资源库里的已有媒体文件，先支持提取音频和压缩画质；输出可以保存到本地，也可以导入到内部目录。
          </div>
        </div>
        <div className="header-tags">
          <Tag color="green">内部文件</Tag>
          <Tag color="blue">本地 ffmpeg</Tag>
        </div>
      </WorkspaceHeader>

      <WorkspaceBody>
        <ToolWorkspaceSaveTarget
          internalPathRequired={internalPathRequired}
          internalTargetMissing={internalTargetMissing}
          isLocalSaveTarget={isLocalSaveTarget}
          onPickSavePath={pickSavePath}
          onToggleSaveTargetType={toggleSaveTargetType}
          savePathDisplay={savePathDisplay}
          saveTargetType={saveTargetType}
        />

        <Panel>
          <ToolPanel>
            {sourceNode ? (
              <div className="source-card">
                <div className="source-icon">
                  {sourceIsVideo ? <IconVideoStroked /> : sourceIsAudio ? <IconMusic /> : <IconFile />}
                </div>
                <div className="source-main">
                  <div className="source-name" title={sourceName}>{sourceName}</div>
                  <div className="source-meta">
                    <Tag color={sourceIsVideo ? 'blue' : sourceIsAudio ? 'green' : 'grey'}>
                      {sourceIsVideo ? '视频' : sourceIsAudio ? '音频' : '文件'}
                    </Tag>
                    {sourceNode.mimeType ? <Tag>{sourceNode.mimeType}</Tag> : null}
                    {sourceNode.ext ? <Tag>{`.${normalizeExt(sourceNode.ext)}`}</Tag> : null}
                  </div>
                </div>
              </div>
            ) : (
              <Empty
                title="还没有选择媒体文件"
                description="在目录树里右键音频或视频文件，选择“在媒体工具打开”。"
              />
            )}

            <div className="action-row">
              <div className="action-card">
                <div className="action-title"><IconMusic />提取音频</div>
                <div className="action-desc">
                  从视频中提取音轨，或把音频统一导出为 m4a。当前使用 AAC 192k，适合作为普通音乐/素材文件保存。
                </div>
                <Button
                  type="primary"
                  loading={runningOperation === 'extract-audio'}
                  disabled={!sourceNode || runningOperation !== null}
                  onClick={() => void runOperation('extract-audio')}
                >
                  {`提取音频&${actionLabelSuffix}`}
                </Button>
              </div>

              <div className="action-card">
                <div className="action-title"><IconVideoStroked />压缩画质</div>
                <div className="action-desc">
                  将视频压缩为 H.264/AAC mp4，当前使用 CRF 28 和 medium preset，优先减小体积并保持常见设备兼容。
                </div>
                <Button
                  loading={runningOperation === 'compress-video'}
                  disabled={!sourceIsVideo || runningOperation !== null}
                  onClick={() => void runOperation('compress-video')}
                >
                  {`压缩画质&${actionLabelSuffix}`}
                </Button>
              </div>
            </div>
          </ToolPanel>
        </Panel>
      </WorkspaceBody>

      <LibraryNodePickerModal
        displayMode="folders"
        libraryId={libraryId}
        title="选择内部保存目录"
        visible={internalPickerVisible}
        onCancel={() => setInternalPickerVisible(false)}
        onConfirm={(selection) => {
          setInternalDirectory(selection);
          setInternalPickerVisible(false);
        }}
      />
    </>
  );
};

export default LibraryMediaTool;

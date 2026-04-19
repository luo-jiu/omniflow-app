import React from 'react';

type EmbeddedBrowserResourceBulkBarProps = {
  canMerge: boolean;
  dedupeSameName: boolean;
  disabled: boolean;
  hasExpandedResources: boolean;
  hasResources: boolean;
  onClearSelection: () => void;
  onCopySelected: () => void;
  onDownloadSelected: () => void;
  onInvertSelection: () => void;
  onMergeSelected: () => void;
  onProcessSelected: () => void;
  onSelectAll: () => void;
  onToggleDedupeSameName: () => void;
  onToggleExpandAll: () => void;
  sameNameHiddenCount: number;
  selectedCount: number;
  selectedMergeableCount: number;
}

const EmbeddedBrowserResourceBulkBar: React.FC<EmbeddedBrowserResourceBulkBarProps> = ({
  canMerge,
  dedupeSameName,
  disabled,
  hasExpandedResources,
  hasResources,
  onClearSelection,
  onCopySelected,
  onDownloadSelected,
  onInvertSelection,
  onMergeSelected,
  onProcessSelected,
  onSelectAll,
  onToggleDedupeSameName,
  onToggleExpandAll,
  sameNameHiddenCount,
  selectedCount,
  selectedMergeableCount,
}) => (
  <div className="resource-bulk-bar">
    <div className="resource-bulk-summary">
      <span>
        已选 {selectedCount} 条
        {selectedMergeableCount ? `，可合并 ${selectedMergeableCount} 条` : ''}
      </span>
      <span className="resource-bulk-status">
        {selectedCount
          ? canMerge ? '已选中可合并的音视频' : '合并需要正好 2 条可合并媒体'
          : '选择资源后可复制、下载或合并'}
      </span>
    </div>
    <div className="resource-bulk-actions">
      <button
        type="button"
        className="resource-card-btn"
        disabled={!hasResources}
        onClick={onSelectAll}
      >
        全选
      </button>
      <button
        type="button"
        className="resource-card-btn"
        disabled={!hasResources}
        onClick={onInvertSelection}
      >
        反选
      </button>
      <button
        type="button"
        className="resource-card-btn"
        disabled={!selectedCount}
        onClick={onClearSelection}
      >
        取消
      </button>
      <button
        type="button"
        className="resource-card-btn"
        disabled={!selectedCount}
        onClick={onCopySelected}
      >
        复制已选
      </button>
      <button
        type="button"
        className="resource-card-btn"
        disabled={!selectedCount}
        onClick={onDownloadSelected}
      >
        下载已选
      </button>
      <button
        type="button"
        className="resource-card-btn"
        disabled={!selectedCount}
        onClick={onProcessSelected}
      >
        处理已选
      </button>
      <button
        type="button"
        className="resource-card-btn primary"
        disabled={disabled || !canMerge}
        onClick={onMergeSelected}
      >
        合并已选
      </button>
      <button
        type="button"
        className="resource-card-btn"
        disabled={!hasResources}
        onClick={onToggleExpandAll}
      >
        {hasExpandedResources ? '收起全部' : '展开全部'}
      </button>
      <button
        type="button"
        className={`resource-card-btn ${dedupeSameName ? 'is-active' : ''}`}
        onClick={onToggleDedupeSameName}
      >
        {dedupeSameName && sameNameHiddenCount > 0
          ? `筛除同名同大小 ${sameNameHiddenCount}`
          : '筛除同名同大小'}
      </button>
    </div>
  </div>
);

export default EmbeddedBrowserResourceBulkBar;

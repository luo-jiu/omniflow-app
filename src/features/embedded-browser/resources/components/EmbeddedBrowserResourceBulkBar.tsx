import React from 'react';

type EmbeddedBrowserResourceBulkBarProps = {
  canMerge: boolean;
  disabled: boolean;
  hasExpandedResources: boolean;
  hasResources: boolean;
  onClearSelection: () => void;
  onCollapseAll: () => void;
  onCopySelected: () => void;
  onDownloadSelected: () => void;
  onExpandAll: () => void;
  onInvertSelection: () => void;
  onMergeSelected: () => void;
  onSelectAll: () => void;
  selectedCount: number;
  selectedMergeableCount: number;
}

const EmbeddedBrowserResourceBulkBar: React.FC<EmbeddedBrowserResourceBulkBarProps> = ({
  canMerge,
  disabled,
  hasExpandedResources,
  hasResources,
  onClearSelection,
  onCollapseAll,
  onCopySelected,
  onDownloadSelected,
  onExpandAll,
  onInvertSelection,
  onMergeSelected,
  onSelectAll,
  selectedCount,
  selectedMergeableCount,
}) => (
  <div className="resource-bulk-bar">
    <div className="resource-bulk-summary">
      已选 {selectedCount} 条
      {selectedMergeableCount ? `，可合并 ${selectedMergeableCount} 条` : ''}
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
        onClick={onExpandAll}
      >
        展开全部
      </button>
      <button
        type="button"
        className="resource-card-btn"
        disabled={!hasExpandedResources}
        onClick={onCollapseAll}
      >
        收起全部
      </button>
    </div>
  </div>
);

export default EmbeddedBrowserResourceBulkBar;

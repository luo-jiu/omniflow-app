import { Tree } from '@douyinfe/semi-ui';

interface DirectoryTreeProps {
  treeData: any[];
  expandedKeys: string[];
  onExpand: (keys: string[]) => void;
  onDoubleClick: (e: React.MouseEvent, node: any) => void;
}

export default function DirectoryTree({
  treeData,
  expandedKeys,
  onExpand,
  onDoubleClick,
}: DirectoryTreeProps) {
  return (
    <div className="tree-container">
      <Tree
        className="custom-tree"
        treeData={treeData}
        expandedKeys={expandedKeys}
        onExpand={onExpand}
        onDoubleClick={onDoubleClick}
        directory
        style={{ padding: 8 }}
      />
    </div>
  );
}

import React from 'react';

import type { ToolWorkspaceToolId } from './types';
import { ToolNav } from './styles';

type ToolWorkspaceNavProps = {
  activeToolId: ToolWorkspaceToolId;
  onSelectTool: (toolId: ToolWorkspaceToolId) => void;
};

const TOOL_ITEMS: Array<{ id: ToolWorkspaceToolId; title: string }> = [
  { id: 'subtitle-translation', title: 'AI 字幕翻译' },
  { id: 'media-file-processing', title: '媒体文件处理' },
  { id: 'media-processing', title: '资源捕获处理' },
];

const ToolWorkspaceNav: React.FC<ToolWorkspaceNavProps> = ({
  activeToolId,
  onSelectTool,
}) => (
  <ToolNav>
    <div className="title">工具区</div>
    {TOOL_ITEMS.map((item) => (
      <button
        key={item.id}
        type="button"
        className={`tool-card ${activeToolId === item.id ? 'is-active' : ''}`}
        onClick={() => onSelectTool(item.id)}
      >
        <div className="tool-card-title">{item.title}</div>
      </button>
    ))}
  </ToolNav>
);

export default ToolWorkspaceNav;

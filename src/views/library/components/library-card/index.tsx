import React from 'react';
import { Input } from '@douyinfe/semi-ui';
import { IconFolder, IconStar, IconStarStroked, IconMore } from '@douyinfe/semi-icons';
import {
  CardItem,
  CardActions,
  ActionIconBtn,
  CardIcon,
  CardName,
  CardNameEdit
} from '../../style';
import type { Library } from "@/features/file-explorer/services/file.api";

interface LibraryCardProps {
  library: Library;
  isEditing: boolean;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMoreClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onToggleStar: () => void;
}

const LibraryCard: React.FC<LibraryCardProps> = ({
  library,
  isEditing,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onContextMenu,
  onMoreClick,
  onDoubleClick,
  onToggleStar
}) => {
  return (
    <CardItem
      title={library.name}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
    >
      <CardActions className="card-actions" onClick={(e) => e.stopPropagation()}>
        <ActionIconBtn
          aria-label={library.starred ? '取消收藏' : '收藏'}
          onClick={onToggleStar}
          title={library.starred ? '取消收藏' : '收藏'}
        >
          {library.starred ? <IconStar /> : <IconStarStroked />}
        </ActionIconBtn>

        <ActionIconBtn
          aria-label="更多"
          onClick={onMoreClick}
          title="更多操作"
        >
          <IconMore />
        </ActionIconBtn>
      </CardActions>

      <CardIcon><IconFolder size="extra-large" /></CardIcon>

      {isEditing ? (
        <CardNameEdit onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Input
            value={renameValue}
            onChange={onRenameChange}
            autoFocus
            onEnterPress={onRenameSubmit}
            onBlur={onRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                onRenameCancel();
              }
            }}
            style={{ width: 200 }}
            placeholder="输入新名称"
          />
        </CardNameEdit>
      ) : (
        <CardName>{library.name}</CardName>
      )}
    </CardItem>
  );
};

export default LibraryCard;


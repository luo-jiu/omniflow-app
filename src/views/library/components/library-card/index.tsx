import React from 'react';
import { IconStar, IconStarStroked, IconMore } from '@douyinfe/semi-icons';
import {
  CardItem,
  CardActions,
  ActionIconBtn,
  CardArtwork,
  CardIcon,
  CardName
} from '../../style';
import type { Library } from "@/features/file-explorer/services/file.api";
import libraryFolderImage from '@/assets/images/library-folder-windows11.png';

interface LibraryCardProps {
  library: Library;
  onContextMenu: (e: React.MouseEvent) => void;
  onMoreClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onToggleStar: () => void;
}

const LibraryCard: React.FC<LibraryCardProps> = ({
  library,
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

      <div className="card-main">
        <CardIcon aria-hidden>
          <CardArtwork src={libraryFolderImage} alt="" draggable={false} />
          <CardName>{library.name}</CardName>
        </CardIcon>
      </div>
    </CardItem>
  );
};

export default LibraryCard;

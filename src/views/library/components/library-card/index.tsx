import React from 'react';
import { IconStar, IconStarStroked, IconMore } from '@douyinfe/semi-icons';
import {
  CardItem,
  CardActions,
  ActionIconBtn,
  CardArtwork,
  CardIcon,
  CardName,
  CardNameEdit,
} from '../../style';
import type { Library } from "@/features/file-explorer/services/file.api";
import libraryFolderImage from '@/assets/images/library-folder-windows11.png';

interface LibraryCardProps {
  library: Library;
  isEditing: boolean;
  isSubmittingRename: boolean;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => Promise<boolean>;
  onRenameCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMoreClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onToggleStar: () => void;
}

const LibraryCard: React.FC<LibraryCardProps> = ({
  library,
  isEditing,
  isSubmittingRename,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onContextMenu,
  onMoreClick,
  onDoubleClick,
  onToggleStar
}) => {
  const cardItemRef = React.useRef<HTMLDivElement | null>(null);
  const renameInputRef = React.useRef<HTMLInputElement | null>(null);
  const renameCancelledRef = React.useRef(false);
  const restoreFocusAfterSubmitRef = React.useRef(false);

  const restoreCardFocus = () => {
    window.requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (!activeElement || activeElement === document.body) {
        cardItemRef.current?.focus();
      }
    });
  };

  React.useEffect(() => {
    if (!isEditing) {
      renameCancelledRef.current = false;
      restoreFocusAfterSubmitRef.current = false;
      return;
    }
    if (isSubmittingRename) return;

    renameCancelledRef.current = false;
    const frameId = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isEditing, isSubmittingRename, library.id]);

  const submitRenameFromBlur = async () => {
    if (renameCancelledRef.current || isSubmittingRename) return;
    const shouldRestoreCardFocus = restoreFocusAfterSubmitRef.current;
    restoreFocusAfterSubmitRef.current = false;
    const completed = await onRenameSubmit();
    const input = renameInputRef.current;
    if (!completed && input && !input.disabled && !renameCancelledRef.current) {
      window.requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    } else if (completed && shouldRestoreCardFocus) {
      restoreCardFocus();
    }
  };

  return (
    <CardItem
      ref={cardItemRef}
      tabIndex={-1}
      title={isEditing ? undefined : library.name}
      onContextMenu={onContextMenu}
      onDoubleClick={isEditing ? undefined : onDoubleClick}
    >
      <div className="card-main">
        <CardIcon>
          <CardArtwork src={libraryFolderImage} alt="" draggable={false} />
          {!isEditing && !isSubmittingRename ? (
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
          ) : null}
        </CardIcon>

        {isEditing ? (
          <CardNameEdit
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          >
            <input
              ref={renameInputRef}
              className="library-card-rename-input"
              value={renameValue}
              disabled={isSubmittingRename}
              aria-label={`重命名${library.name}`}
              aria-busy={isSubmittingRename}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onRenameChange(event.target.value)}
              onBlur={() => {
                void submitRenameFromBlur();
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter') {
                  restoreFocusAfterSubmitRef.current = true;
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  renameCancelledRef.current = true;
                  event.preventDefault();
                  event.stopPropagation();
                  onRenameCancel();
                  restoreCardFocus();
                }
              }}
            />
          </CardNameEdit>
        ) : (
          <CardName>{library.name}</CardName>
        )}
      </div>
    </CardItem>
  );
};

export default LibraryCard;

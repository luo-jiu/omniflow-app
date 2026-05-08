import { useCallback } from 'react';
import { useFileViewer } from '@/hooks/useFileViewer';
import type { FileViewerReturnTarget } from '@/contexts/file-viewer.context';
import type { ComicArchiveCard } from './comic-archive-types';

interface UseComicArchiveNavigationOptions {
  libraryId: number | null;
  currentArchiveReturnTarget: FileViewerReturnTarget | null;
}

export function useComicArchiveNavigation({
  libraryId,
  currentArchiveReturnTarget,
}: UseComicArchiveNavigationOptions) {
  const { setFileUrl } = useFileViewer();

  return useCallback((card: ComicArchiveCard) => {
    if (!libraryId || !currentArchiveReturnTarget) return;
    if (card.cardKind === 'collection') {
      setFileUrl(
        `comic-archive://library/${libraryId}/node/${card.id}`,
        card.title,
        'comic_archive',
        card.id,
        {
          tabTypeLabel: 'COMIC-ARC',
          returnTarget: currentArchiveReturnTarget,
        },
      );
      return;
    }
    setFileUrl(
      `comic://library/${libraryId}/node/${card.id}`,
      card.title,
      'comic',
      card.id,
      {
        tabTypeLabel: 'COMIC',
        returnTarget: currentArchiveReturnTarget,
      },
    );
  }, [currentArchiveReturnTarget, libraryId, setFileUrl]);
}

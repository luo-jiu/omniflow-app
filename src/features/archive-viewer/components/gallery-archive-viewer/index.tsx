import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Popover, Spin, Toast } from '@douyinfe/semi-ui';
import { GalleryArchiveViewerWrapper } from './style';
import { useArchiveCardGrid } from '@/features/archive-viewer/hooks/useArchiveCardGrid';
import {
  batchGetFileLinks,
  deleteNodeAndChildren,
  getChildrenByNodeId,
} from '@/features/file-explorer/services/file.api';
import { locateNodeInDirectoryTree } from '@/features/file-explorer/services/tree-locate';
import { useNodePropertiesOverlay } from '@/features/file-explorer/hooks/useNodePropertiesOverlay';
import ContextMenu, { ContextMenuItem } from '@/components/ui/context-menu';
import type { FileViewerReturnTarget } from '@/contexts/file-viewer.context';
import { buildFileViewerReturnTarget } from '@/contexts/file-viewer-return-target';
import { useFileViewer } from '@/hooks/useFileViewer';
import { buildFileFullName } from '@/utils/fileTreeSettings';
import { runtimeLogger } from '@/utils/runtimeLogger';

interface GalleryArchiveViewerProps {
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
  active?: boolean;
  reloadToken?: number;
  returnTarget?: FileViewerReturnTarget | null;
}

interface GalleryArchiveNode {
  id: number;
  name: string;
  ext?: string;
  mimeType?: string;
  type: 'dir' | 'file' | number | string;
  builtInType?: string;
  archiveMode?: number;
  fileSize?: number;
}

interface GalleryArchiveCard {
  id: number;
  title: string;
  cardKind: 'album' | 'collection';
  imageCount: number | null;
  videoCount: number | null;
  coverNode?: GalleryArchiveNode | null;
  coverUrl?: string | null;
  detailLoaded?: boolean;
  detailLoading?: boolean;
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif', 'heic', 'heif', 'heics', 'heifs']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'ts', 'flv', 'f4v', 'mpeg', 'mpg', 'wmv', 'ogv', '3gp']);
const LINK_EXPIRY_MINUTES = 240;
const COVER_LOAD_CONCURRENCY = 3;

function parseGalleryArchiveLibraryId(fileUrl: string): number | null {
  const matches = /^gallery-archive:\/\/library\/(\d+)\/node\/\d+$/i.exec(String(fileUrl || '').trim());
  if (!matches) return null;
  const parsed = Number(matches[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeArchiveTitle(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  if (!raw) return '图集归档';
  if (raw.toUpperCase().startsWith('GALLERY 归档 ·')) {
    return raw.replace(/^GALLERY\s*归档\s*·\s*/iu, '').trim() || '图集归档';
  }
  return raw;
}

function normalizeExt(ext?: string): string {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '');
}

function isFileNode(item: GalleryArchiveNode): boolean {
  return String(item.type) === 'file' || Number(item.type) === 1;
}

function isDirNode(item: GalleryArchiveNode): boolean {
  return String(item.type) === 'dir' || Number(item.type) === 0;
}

function isGalleryDirectory(item: GalleryArchiveNode): boolean {
  return isDirNode(item) && String(item.builtInType || '').trim().toUpperCase() === 'GALLERY';
}

function resolveMediaKind(item: GalleryArchiveNode): 'image' | 'video' | null {
  if (!isFileNode(item)) return null;
  const mimeType = String(item.mimeType || '').trim().toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/') || mimeType === 'application/vnd.apple.mpegurl') return 'video';
  const ext = normalizeExt(item.ext);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

function isHeicNode(item?: GalleryArchiveNode | null): boolean {
  if (!item) return false;
  const ext = normalizeExt(item.ext);
  const mimeType = String(item.mimeType || '').trim().toLowerCase();
  return ext === 'heic'
    || ext === 'heif'
    || ext === 'heics'
    || ext === 'heifs'
    || mimeType === 'image/heic'
    || mimeType === 'image/heif'
    || mimeType === 'image/heic-sequence'
    || mimeType === 'image/heif-sequence';
}

const GalleryArchiveViewer: React.FC<GalleryArchiveViewerProps> = ({
  folderNodeId,
  fileUrl,
  fileName,
  active = true,
  reloadToken = 0,
  returnTarget = null,
}) => {
  const { viewportRef, wrapperStyle } = useArchiveCardGrid({
    baseCardWidth: 220,
    minScale: 0.82,
    gridGap: 18,
  });
  const { setFileUrl } = useFileViewer();
  const libraryId = useMemo(() => parseGalleryArchiveLibraryId(fileUrl), [fileUrl]);
  const title = useMemo(() => normalizeArchiveTitle(fileName), [fileName]);
  const currentArchiveReturnTarget = useMemo<FileViewerReturnTarget | null>(() => {
    if (!folderNodeId || !libraryId) return null;
    return buildFileViewerReturnTarget({
      fileUrl,
      fileName: fileName || title,
      fileType: 'gallery_archive',
      nodeId: folderNodeId,
      tabTypeLabel: 'GALLERY-ARC',
      returnTarget: returnTarget ?? null,
    });
  }, [fileName, fileUrl, folderNodeId, libraryId, returnTarget, title]);
  const { showNodeProperties } = useNodePropertiesOverlay({ libraryId });
  const [cards, setCards] = useState<GalleryArchiveCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    card: GalleryArchiveCard | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    card: null,
  });
  const cardElementMapRef = useRef<Map<number, HTMLButtonElement>>(new Map());
  const loadingDetailIdsRef = useRef<Set<number>>(new Set());
  const detailQueueRef = useRef<number[]>([]);
  const detailInflightRef = useRef(0);
  const detailGenerationRef = useRef(0);
  const cardsRef = useRef<GalleryArchiveCard[]>([]);

  const closeContextMenu = useCallback(() => {
    setMenuState(prev => ({ ...prev, visible: false }));
  }, []);

  const openCard = useCallback((card: GalleryArchiveCard) => {
    if (!libraryId || !currentArchiveReturnTarget) return;
    if (card.cardKind === 'collection') {
      setFileUrl(
        `gallery-archive://library/${libraryId}/node/${card.id}`,
        card.title,
        'gallery_archive',
        card.id,
        {
          tabTypeLabel: 'GALLERY-ARC',
          returnTarget: currentArchiveReturnTarget,
        },
      );
      return;
    }
    setFileUrl(
      `gallery://library/${libraryId}/node/${card.id}`,
      card.title,
      'gallery',
      card.id,
      {
        tabTypeLabel: 'GALLERY',
        returnTarget: currentArchiveReturnTarget,
      },
    );
  }, [currentArchiveReturnTarget, libraryId, setFileUrl]);

  const openCardContextMenu = useCallback((event: React.MouseEvent, card: GalleryArchiveCard) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuState({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      card,
    });
  }, []);

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const card = menuState.card;
    if (!card || !libraryId) return [];
    return [
      {
        key: 'open',
        label: card.cardKind === 'collection' ? '打开归档' : '打开图集',
        onClick: () => {
          closeContextMenu();
          openCard(card);
        },
      },
      {
        key: 'locate-in-tree',
        label: '在目录树中定位',
        onClick: () => {
          closeContextMenu();
          locateNodeInDirectoryTree({ libraryId, nodeId: card.id });
        },
      },
      {
        key: 'props',
        label: '属性',
        onClick: () => {
          closeContextMenu();
          void showNodeProperties({ id: card.id, label: card.title });
        },
      },
      {
        key: 'delete',
        label: '删除',
        danger: true,
        onClick: () => {
          closeContextMenu();
          Modal.confirm({
            title: '确认删除',
            content: `确认将「${card.title || '未命名图集'}」移入回收站吗？`,
            okButtonProps: { theme: 'solid', type: 'danger' },
            okText: '删除',
            cancelText: '取消',
            centered: true,
            onOk: async () => {
              try {
                await deleteNodeAndChildren(card.id, libraryId);
                setCards(prev => prev.filter(item => item.id !== card.id));
                Toast.success('已移入回收站');
              } catch (deleteError: any) {
                runtimeLogger.error('删除图集归档卡片失败:', deleteError);
                Toast.error(deleteError?.message || '删除失败');
              }
            },
          });
        },
      },
    ];
  }, [closeContextMenu, libraryId, menuState.card, openCard, showNodeProperties]);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  const createGalleryCard = useCallback((node: GalleryArchiveNode): GalleryArchiveCard => ({
    id: Number(node.id),
    title: buildFileFullName(String(node.name || ''), node.ext) || `gallery-${node.id}`,
    cardKind: Number(node.archiveMode ?? 0) === 1 ? 'collection' : 'album',
    imageCount: null,
    videoCount: null,
    coverNode: null,
    coverUrl: null,
    detailLoaded: false,
    detailLoading: false,
  }), []);

  const loadGalleryCardDetail = useCallback(async (card: GalleryArchiveCard): Promise<GalleryArchiveCard> => {
    const children = (await getChildrenByNodeId(card.id, libraryId as number)) as GalleryArchiveNode[];
    const mediaChildren = children
      .map((child) => ({
        node: child,
        kind: resolveMediaKind(child),
      }))
      .filter((item): item is { node: GalleryArchiveNode; kind: 'image' | 'video' } => Boolean(item.kind));
    const coverNode = mediaChildren.find(item => item.kind === 'image')?.node ?? null;
    return {
      ...card,
      imageCount: mediaChildren.filter(item => item.kind === 'image').length,
      videoCount: mediaChildren.filter(item => item.kind === 'video').length,
      coverNode,
      detailLoaded: true,
      detailLoading: false,
    };
  }, [libraryId]);

  const resolveCoverUrl = useCallback(async (coverNode: GalleryArchiveNode | null | undefined): Promise<string | null> => {
    if (!libraryId || !coverNode?.id) return null;
    try {
      const linkMap = await batchGetFileLinks({
        libraryId,
        nodeIds: [Number(coverNode.id)],
        expiry: LINK_EXPIRY_MINUTES,
      });
      const sourceUrl = linkMap.get(Number(coverNode.id)) || '';
      if (!sourceUrl) return null;
      if (!isHeicNode(coverNode)) return sourceUrl;
      const api = window.electronAPI?.prepareImagePreview;
      if (!api) return null;
      const result = await api({
        nodeId: Number(coverNode.id),
        libraryId,
        url: sourceUrl,
        fileName: buildFileFullName(String(coverNode.name || ''), coverNode.ext),
        ext: coverNode.ext,
        mimeType: coverNode.mimeType,
        fileSize: coverNode.fileSize,
      });
      return result?.ok ? result.previewUrl || result.previewDataUrl || null : null;
    } catch (coverError) {
      runtimeLogger.warn('加载图集归档封面失败:', coverError);
      return null;
    }
  }, [libraryId]);

  const pumpDetailQueue = useCallback(() => {
    if (!libraryId) return;
    const generation = detailGenerationRef.current;
    while (detailInflightRef.current < COVER_LOAD_CONCURRENCY && detailQueueRef.current.length > 0) {
      const cardId = detailQueueRef.current.shift();
      if (!cardId) continue;
      const card = cardsRef.current.find(item => item.id === cardId);
      if (!card || card.detailLoaded) {
        loadingDetailIdsRef.current.delete(cardId);
        continue;
      }

      detailInflightRef.current += 1;
      setCards(prev => prev.map(item => (
        item.id === cardId ? { ...item, detailLoading: true } : item
      )));

      void (async () => {
        const detailCard = await loadGalleryCardDetail(card);
        const coverUrl = await resolveCoverUrl(detailCard.coverNode);
        if (generation !== detailGenerationRef.current) return;
        setCards(prev => prev.map(item => (
          item.id === cardId ? { ...detailCard, coverUrl, detailLoading: false } : item
        )));
      })().catch((detailError) => {
        if (generation !== detailGenerationRef.current) return;
        runtimeLogger.warn('加载图集归档卡片详情失败:', detailError);
        setCards(prev => prev.map(item => (
          item.id === cardId ? { ...item, detailLoaded: true, detailLoading: false } : item
        )));
      }).finally(() => {
        if (generation !== detailGenerationRef.current) return;
        detailInflightRef.current = Math.max(detailInflightRef.current - 1, 0);
        loadingDetailIdsRef.current.delete(cardId);
        pumpDetailQueue();
      });
    }
  }, [libraryId, loadGalleryCardDetail, resolveCoverUrl]);

  const scheduleCardDetailLoad = useCallback((cardId: number) => {
    const card = cardsRef.current.find(item => item.id === cardId);
    if (!card || card.detailLoaded || loadingDetailIdsRef.current.has(cardId)) return;
    loadingDetailIdsRef.current.add(cardId);
    detailQueueRef.current.push(cardId);
    pumpDetailQueue();
  }, [pumpDetailQueue]);

  useEffect(() => {
    if (active) return;
    setMenuState(prev => (prev.visible ? { ...prev, visible: false } : prev));
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    detailGenerationRef.current += 1;
    cardElementMapRef.current.clear();
    loadingDetailIdsRef.current.clear();
    detailQueueRef.current = [];
    detailInflightRef.current = 0;
    async function load() {
      if (!folderNodeId || !libraryId) {
        setCards([]);
        setLoading(false);
        setError('图集归档参数异常');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const children = (await getChildrenByNodeId(folderNodeId, libraryId)) as GalleryArchiveNode[];
        if (cancelled) return;
        const galleryNodes = children
          .filter(isGalleryDirectory);
        const nextCards = galleryNodes.map(node => createGalleryCard(node));
        if (!cancelled) {
          setCards(nextCards);
        }
      } catch (loadError) {
        runtimeLogger.error('加载图集归档失败:', loadError);
        if (!cancelled) {
          setCards([]);
          setError('图集归档加载失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      detailGenerationRef.current += 1;
    };
  }, [createGalleryCard, folderNodeId, libraryId, reloadToken]);

  useEffect(() => {
    if (loading || cards.length === 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const cardId = Number((entry.target as HTMLElement).dataset.cardId || 0);
        if (cardId > 0) {
          scheduleCardDetailLoad(cardId);
        }
      });
    }, {
      root: viewport,
      rootMargin: '240px',
      threshold: 0.01,
    });
    cardElementMapRef.current.forEach(element => observer.observe(element));
    return () => {
      observer.disconnect();
    };
  }, [cards.length, loading, scheduleCardDetailLoad, viewportRef]);

  return (
    <>
      <GalleryArchiveViewerWrapper style={wrapperStyle}>
        <section className="gallery-archive-surface" ref={viewportRef}>
          {loading ? (
            <div className="state-wrap">
              <Spin size="large" tip="图集归档加载中..." />
            </div>
          ) : error ? (
            <div className="state-wrap state-error">{error}</div>
          ) : cards.length === 0 ? (
            <div className="state-wrap">当前归档下暂无可展示的图集</div>
          ) : (
            <div className="gallery-archive-grid">
              {cards.map(card => (
                <button
                  key={card.id}
                  type="button"
                  className="gallery-album-card"
                  data-card-id={card.id}
                  ref={(element) => {
                    if (element) {
                      cardElementMapRef.current.set(card.id, element);
                    } else {
                      cardElementMapRef.current.delete(card.id);
                    }
                  }}
                  onClick={() => openCard(card)}
                  onContextMenu={(event) => openCardContextMenu(event, card)}
                  title={card.title}
                >
                  <span className="gallery-album-stack">
                    <span className="gallery-album-cover">
                      {card.coverUrl ? (
                        <img src={card.coverUrl} alt="" draggable={false} aria-hidden />
                      ) : (
                        <span className="gallery-album-placeholder">
                          {card.detailLoading ? 'LOADING' : 'GALLERY'}
                        </span>
                      )}
                    </span>
                    <span className="gallery-album-overlay">
                      <span className="gallery-album-title">{card.title}</span>
                    </span>
                    {card.cardKind === 'collection' ? (
                      <span className="gallery-album-badge">归档</span>
                    ) : null}
                  </span>
                  <span className="gallery-album-meta">
                    <span>{card.imageCount === null ? '--' : card.imageCount} 图片</span>
                    <span>{card.videoCount === null ? '--' : card.videoCount} 视频</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        <footer className="archive-footer">
          <div className="footer-title-group">
            <span className="badge">GALLERY ARCHIVE</span>
            <span className="title" title={title}>{title}</span>
          </div>
        </footer>
      </GalleryArchiveViewerWrapper>
      <Popover
        trigger="custom"
        visible={menuState.visible}
        onClickOutSide={closeContextMenu}
        position="bottomLeft"
        showArrow={false}
        spacing={4}
        getPopupContainer={() => document.body}
        content={(
          <ContextMenu
            items={contextMenuItems}
            className="directory-context-menu"
            onItemClick={closeContextMenu}
          />
        )}
      >
        <div
          style={{
            position: 'fixed',
            left: menuState.x,
            top: menuState.y,
            width: 1,
            height: 1,
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        />
      </Popover>
    </>
  );
};

export default GalleryArchiveViewer;

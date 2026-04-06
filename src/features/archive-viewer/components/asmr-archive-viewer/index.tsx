import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Spin } from '@douyinfe/semi-ui';
import { fetchNodeDetailById, getChildrenByNodeId, getFileLink } from '@/features/file-explorer/services/file.api';
import { isImageExtension } from '@/features/file-explorer/utils/file-node-icon';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { AsmrArchiveViewerWrapper } from './style';
import { useFileViewer } from '@/hooks/useFileViewer';
import { fetchTags, type TagItem } from '@/features/tag-management/services/tag.api';
import { useArchiveCardGrid } from '@/features/archive-viewer/hooks/useArchiveCardGrid';

interface AsmrArchiveViewerProps {
  folderNodeId: number | null;
  fileUrl: string;
  fileName?: string | null;
}

interface ArchiveNodeItem {
  id: number;
  name: string;
  type: 'dir' | 'file' | string | number;
  ext?: string;
  mimeType?: string;
  builtInType?: string;
  archiveMode?: number;
}

interface AsmrArchiveCard {
  id: number;
  title: string;
  coverUrl: string | null;
  tags: AsmrArchiveTag[];
}

interface AsmrArchiveTag {
  id: number | null;
  name: string;
  color?: string | null;
  textColor?: string | null;
  fallback?: boolean;
}

interface AsmrViewMetaPayload {
  tag?: string;
  tagIds?: number[];
  coverNodeId?: number;
  [key: string]: unknown;
}

const NAME_COLLATOR = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
});

function parseArchiveLibraryId(fileUrl: string): number | null {
  const matches = /^asmr-archive:\/\/library\/(\d+)\/node\/\d+$/i.exec(String(fileUrl || '').trim());
  if (!matches) return null;
  const parsed = Number(matches[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDirectoryNode(item: ArchiveNodeItem): boolean {
  return String(item.type) === 'dir' || Number(item.type) === 0;
}

function isHiddenNodeName(name?: string, ext?: string): boolean {
  const trimmedName = String(name || '').trim();
  if (trimmedName.startsWith('.')) {
    return true;
  }
  const normalizedExt = String(ext || '').trim().replace(/^\./, '');
  return trimmedName.length === 0 && normalizedExt.length > 0;
}

function isImageFileNode(item: ArchiveNodeItem): boolean {
  if (isDirectoryNode(item)) return false;
  if (isHiddenNodeName(item.name, item.ext)) return false;
  if (String(item.mimeType || '').startsWith('image/')) return true;
  return isImageExtension(item.ext);
}

function normalizeArchiveTitle(fileName?: string | null): string {
  const raw = String(fileName || '').trim();
  if (!raw) return 'ASMR 归档';
  if (raw.startsWith('ASMR 归档 ·')) {
    const stripped = raw.replace(/^ASMR 归档 ·\s*/u, '').trim();
    if (stripped) return stripped;
  }
  return raw;
}

function parseViewMeta(raw?: string | null): AsmrViewMetaPayload {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as AsmrViewMetaPayload;
    }
  } catch {
    return {};
  }
  return {};
}

function sanitizeMetaText(input: unknown): string {
  return String(input || '').trim();
}

function resolveMetaNumber(input: unknown): number | null {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function resolveMetaNumberList(input: unknown): number[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const result: number[] = [];
  input.forEach((item) => {
    const value = resolveMetaNumber(item);
    if (value !== null && !result.includes(value)) {
      result.push(value);
    }
  });
  return result;
}

function resolveTagIdsFromLegacyTagText(
  legacyTagText: string,
  normalizedNameMap: Map<string, number>,
): number[] {
  const normalized = sanitizeMetaText(legacyTagText);
  if (!normalized) return [];

  const tokens = normalized
    .split(/[/,，、|]/g)
    .map(token => sanitizeMetaText(token).toLowerCase())
    .filter(Boolean);
  const ids: number[] = [];
  tokens.forEach((token) => {
    const tagId = normalizedNameMap.get(token);
    if (tagId && !ids.includes(tagId)) {
      ids.push(tagId);
    }
  });
  return ids;
}

function resolveFallbackTagTexts(tagText: string): string[] {
  return sanitizeMetaText(tagText)
    .split(/[/,，、|]/g)
    .map(token => sanitizeMetaText(token))
    .filter(Boolean);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

const AsmrArchiveViewer: React.FC<AsmrArchiveViewerProps> = ({ folderNodeId, fileUrl, fileName }) => {
  const { setFileUrl } = useFileViewer();
  const { viewportRef, wrapperStyle } = useArchiveCardGrid({
    baseCardWidth: 410,
  });
  const libraryId = useMemo(() => parseArchiveLibraryId(fileUrl), [fileUrl]);
  const title = useMemo(() => normalizeArchiveTitle(fileName), [fileName]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<AsmrArchiveCard[]>([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!folderNodeId || !Number.isFinite(folderNodeId) || !libraryId) {
      setCards([]);
      setError('归档参数异常');
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const children = (await getChildrenByNodeId(folderNodeId, libraryId)) as ArchiveNodeItem[];
        if (requestId !== requestIdRef.current) return;
        const asmrTagOptions = await fetchTags('ASMR')
          .then(list => list.filter(tag => (
            Number(tag.enabled ?? 1) === 1
            && Number(tag.ownerUserId ?? 0) > 0
          )))
          .catch((error) => {
            runtimeLogger.warn('加载 ASMR 标签失败，归档卡片将仅显示文本标签:', error);
            return [] as TagItem[];
          });
        const tagOptionMap = new Map<number, TagItem>();
        const normalizedTagNameMap = new Map<string, number>();
        asmrTagOptions.forEach((option) => {
          tagOptionMap.set(option.id, option);
          const normalizedName = sanitizeMetaText(option.name).toLowerCase();
          if (normalizedName && !normalizedTagNameMap.has(normalizedName)) {
            normalizedTagNameMap.set(normalizedName, option.id);
          }
        });

        const archiveUnits = (children || [])
          .filter(item => isDirectoryNode(item))
          .filter(item => String(item.builtInType || 'DEF').toUpperCase() === 'ASMR')
          .filter(item => Number(item.archiveMode ?? 0) !== 1)
          .sort((a, b) => NAME_COLLATOR.compare(String(a.name || ''), String(b.name || '')));

        const nextCards = await mapWithConcurrency(
          archiveUnits,
          6,
          async (unit): Promise<AsmrArchiveCard> => {
          try {
            const [unitChildren, detail] = await Promise.all([
              getChildrenByNodeId(unit.id, libraryId) as Promise<ArchiveNodeItem[]>,
              fetchNodeDetailById(unit.id).catch((error) => {
                runtimeLogger.warn('加载 ASMR 归档卡片元信息失败:', error);
                return null;
              }),
            ]);
            const parsedMeta = parseViewMeta(detail?.viewMeta);
            const preferredCoverNodeId = resolveMetaNumber(parsedMeta.coverNodeId);
            const fallbackCoverNode = (unitChildren || []).find(isImageFileNode);
            const coverCandidateIds = [
              preferredCoverNodeId,
              fallbackCoverNode?.id ?? null,
            ].filter((id, index, list): id is number => (
              Number.isFinite(id)
              && Number(id) > 0
              && list.indexOf(id) === index
            ));

            let coverUrl: string | null = null;
            for (const candidateId of coverCandidateIds) {
              try {
                const nextUrl = await getFileLink(candidateId, libraryId, 120);
                if (nextUrl) {
                  coverUrl = nextUrl;
                  break;
                }
              } catch (error) {
                runtimeLogger.warn('加载 ASMR 归档卡片候选封面失败，将自动回退:', error);
              }
            }

            const nextTags: AsmrArchiveTag[] = [];
            const metaTagText = sanitizeMetaText(parsedMeta.tag);
            const metaTagIds = resolveMetaNumberList(parsedMeta.tagIds);
            const resolvedTagIds = metaTagIds.length > 0
              ? metaTagIds
              : resolveTagIdsFromLegacyTagText(metaTagText, normalizedTagNameMap);

            resolvedTagIds.forEach((tagId) => {
              const option = tagOptionMap.get(tagId);
              if (!option) return;
              nextTags.push({
                id: option.id,
                name: option.name,
                color: option.color,
                textColor: option.textColor,
              });
            });
            if (nextTags.length === 0 && metaTagText) {
              resolveFallbackTagTexts(metaTagText).forEach((tagName) => {
                if (nextTags.some(item => item.name === tagName)) return;
                nextTags.push({
                  id: null,
                  name: tagName,
                  fallback: true,
                });
              });
            }

            return {
              id: unit.id,
              title: unit.name,
              coverUrl: coverUrl || null,
              tags: nextTags,
            };
          } catch (error) {
            runtimeLogger.warn('加载 ASMR 归档卡片封面失败:', error);
            return {
              id: unit.id,
              title: unit.name,
              coverUrl: null,
              tags: [],
            };
          }
          },
        );

        if (requestId !== requestIdRef.current) return;
        setCards(nextCards);
      } catch (error) {
        runtimeLogger.error('加载 ASMR 归档失败:', error);
        if (requestId === requestIdRef.current) {
          setCards([]);
          setError('加载归档失败');
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
  }, [folderNodeId, libraryId]);

  return (
    <AsmrArchiveViewerWrapper style={wrapperStyle}>
      <section className="table-surface" ref={viewportRef}>
        {loading ? (
          <div className="state-wrap">
            <Spin size="large" tip="归档加载中..." />
          </div>
        ) : error ? (
          <div className="state-wrap state-error">{error}</div>
        ) : cards.length === 0 ? (
          <div className="state-wrap">当前归档下暂无可展示的 ASMR 集合</div>
        ) : (
          <div className="cards-grid">
            {cards.map(card => (
              <article
                key={card.id}
                className="archive-card"
                onDoubleClick={() => {
                  if (!libraryId || !folderNodeId || !Number.isFinite(folderNodeId)) return;
                  setFileUrl(
                    `asmr://library/${libraryId}/node/${card.id}`,
                    card.title,
                    'asmr',
                    card.id,
                    {
                      tabTypeLabel: 'ASMR',
                      returnTarget: {
                        fileUrl,
                        fileName: fileName || title,
                        fileType: 'asmr_archive',
                        nodeId: folderNodeId,
                        tabTypeLabel: 'ASMR-ARCHIVE',
                      },
                    },
                  );
                }}
              >
                <div className="card-cover">
                  {card.coverUrl ? (
                    <img src={card.coverUrl} alt={card.title} draggable={false} />
                  ) : (
                    <div className="cover-empty" />
                  )}
                </div>
                <div className="card-title" title={card.title}>
                  {card.title}
                </div>
                <div className="card-tag-slot">
                  {card.tags.length > 0 ? (
                    card.tags.map((tag, index) => (
                      <span
                        key={`tag-${card.id}-${tag.id ?? tag.name}-${index}`}
                        className={`card-tag-pill${tag.fallback ? ' fallback' : ''}`}
                        style={tag.fallback ? undefined : {
                          background: tag.color || 'var(--semi-color-fill-0)',
                          color: tag.textColor || '#fff',
                          borderColor: tag.color || 'var(--semi-color-border)',
                        }}
                        title={tag.name}
                      >
                        {tag.name}
                      </span>
                    ))
                  ) : (
                    <span className="card-tag-empty">暂无标签</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="archive-footer">
        <div className="footer-title-group">
          <span className="badge">ASMR ARCHIVE</span>
          <span className="title" title={title}>{title}</span>
        </div>
      </footer>
    </AsmrArchiveViewerWrapper>
  );
};

export default AsmrArchiveViewer;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Spin } from '@douyinfe/semi-ui';
import { getChildrenByNodeId, getFileLink } from '@/features/file-explorer/services/file.api';
import { isImageExtension } from '@/features/file-explorer/utils/file-node-icon';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { AsmrArchiveViewerWrapper } from './style';
import { useFileViewer } from '@/hooks/useFileViewer';

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

function isImageFileNode(item: ArchiveNodeItem): boolean {
  if (isDirectoryNode(item)) return false;
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

const AsmrArchiveViewer: React.FC<AsmrArchiveViewerProps> = ({ folderNodeId, fileUrl, fileName }) => {
  const { setFileUrl } = useFileViewer();
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

        const archiveUnits = (children || [])
          .filter(item => isDirectoryNode(item))
          .filter(item => String(item.builtInType || 'DEF').toUpperCase() === 'ASMR')
          .filter(item => Number(item.archiveMode ?? 0) !== 1)
          .sort((a, b) => NAME_COLLATOR.compare(String(a.name || ''), String(b.name || '')));

        const nextCards = await Promise.all(archiveUnits.map(async (unit): Promise<AsmrArchiveCard> => {
          try {
            const unitChildren = (await getChildrenByNodeId(unit.id, libraryId)) as ArchiveNodeItem[];
            const coverNode = (unitChildren || []).find(isImageFileNode);
            let coverUrl: string | null = null;
            if (coverNode) {
              coverUrl = await getFileLink(coverNode.id, libraryId, 120);
            }
            return {
              id: unit.id,
              title: unit.name,
              coverUrl: coverUrl || null,
            };
          } catch (error) {
            runtimeLogger.warn('加载 ASMR 归档卡片封面失败:', error);
            return {
              id: unit.id,
              title: unit.name,
              coverUrl: null,
            };
          }
        }));

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
    <AsmrArchiveViewerWrapper>
      <section className="table-surface">
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
                <div className="card-tag-slot" />
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

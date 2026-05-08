import type { ArchiveCardDTO } from '@/features/file-explorer/services/file.api';
import type {
  ComicArchiveCard,
  ComicArchiveCardKind,
} from './comic-archive-types';

function normalizeComicArchiveCardKind(input?: string | null): ComicArchiveCardKind {
  return String(input || '').trim().toLowerCase() === 'collection' ? 'collection' : 'media';
}

export function mapComicArchiveCards(items: ArchiveCardDTO[]): ComicArchiveCard[] {
  return items.map(item => ({
    id: Number(item.id),
    title: String(item.name || ''),
    sortOrder: Number(item.sortOrder ?? 0),
    cardKind: normalizeComicArchiveCardKind(item.cardKind),
    coverNodeId: Number.isFinite(Number(item.coverNodeId)) && Number(item.coverNodeId) > 0
      ? Number(item.coverNodeId)
      : null,
    coverUrl: null,
  }));
}

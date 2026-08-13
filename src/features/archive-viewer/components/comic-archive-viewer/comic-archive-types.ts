export type ComicArchiveCardKind = 'media' | 'collection';

export interface ComicArchiveCard {
  id: number;
  title: string;
  sortOrder: number;
  cardKind: ComicArchiveCardKind;
  coverNodeId: number | null;
  coverUrl: string | null;
}

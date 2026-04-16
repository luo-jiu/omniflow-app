export type BuiltInType = 'DEF' | 'COMIC' | 'ASMR' | 'VIDEO';

export type ArchiveBuiltInType = Exclude<BuiltInType, 'DEF'>;

export type ArchiveFileType = 'asmr_archive' | 'comic_archive' | 'video_archive';

export type FileViewerFileType =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'comic'
  | 'asmr'
  | ArchiveFileType
  | 'other';

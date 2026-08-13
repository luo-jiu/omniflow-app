export type BuiltInType = 'DEF' | 'COMIC' | 'ASMR' | 'VIDEO' | 'AUDIO' | 'GALLERY';

export type ArchiveBuiltInType = Exclude<BuiltInType, 'DEF'>;

export type ArchiveFileType = 'asmr_archive' | 'comic_archive' | 'video_archive' | 'audio_archive' | 'gallery_archive';

export type FileViewerFileType =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'comic'
  | 'gallery'
  | 'asmr'
  | ArchiveFileType
  | 'other';

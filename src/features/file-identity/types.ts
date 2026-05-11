import type { PreviewFileType } from '@/utils/preview-file-type';

export type FileIdentityConfidence = 'manual' | 'detected' | 'mime' | 'context' | 'extension' | 'unknown';

export type FileIdentityPreviewKind = PreviewFileType;

export interface ResolveFileIdentityInput {
  name?: string | null;
  ext?: string | null;
  mimeType?: string | null;
  detectedMimeType?: string | null;
  detectedKind?: FileIdentityPreviewKind | null;
  detectedIconKind?: string | null;
  contentKindOverride?: FileIdentityPreviewKind | null;
  parentBuiltInType?: string | null;
  parentArchiveMode?: number | null;
}

export interface FileIdentity {
  previewKind: FileIdentityPreviewKind;
  iconKind: string;
  mimeType: string | null;
  detectedMimeType: string | null;
  detectedKind: FileIdentityPreviewKind | null;
  confidence: FileIdentityConfidence;
  ambiguous: boolean;
  reason: string;
}

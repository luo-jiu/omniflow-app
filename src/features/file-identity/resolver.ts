import {
  normalizeFileExtension,
  resolvePreviewFileType,
  type PreviewFileType,
} from '@/utils/preview-file-type';
import { isAmbiguousExtension } from './ambiguous-extensions';
import type { FileIdentity, FileIdentityPreviewKind, ResolveFileIdentityInput } from './types';

function normalizeMimeType(value?: string | null): string {
  return String(value || '').trim().toLowerCase().split(';')[0] || '';
}

function normalizeBuiltInType(value?: string | null): string {
  return String(value || 'DEF').trim().toUpperCase() || 'DEF';
}

function normalizeKind(value?: string | null): FileIdentityPreviewKind | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'image'
    || normalized === 'video'
    || normalized === 'audio'
    || normalized === 'pdf'
    || normalized === 'text'
    || normalized === 'other'
  ) {
    return normalized;
  }
  return null;
}

function resolveKindFromMime(mimeType?: string | null): PreviewFileType | null {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return null;
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/') || normalized === 'application/vnd.apple.mpegurl') return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized === 'application/pdf' || normalized.endsWith('/pdf')) return 'pdf';
  if (normalized.startsWith('text/')) return 'text';
  if (
    normalized === 'application/json'
    || normalized === 'application/xml'
    || normalized === 'application/javascript'
    || normalized === 'application/typescript'
    || normalized === 'application/x-typescript'
  ) {
    return 'text';
  }
  return null;
}

function resolveIconKind(previewKind: FileIdentityPreviewKind, ext: string): string {
  if (previewKind === 'image') return 'image';
  if (previewKind === 'video') return 'video';
  if (previewKind === 'audio') return 'audio';
  if (previewKind === 'pdf') return 'pdf';
  if (previewKind === 'text' && (ext === 'ts' || ext === 'mts' || ext === 'cts')) return 'typescript';
  return previewKind === 'other' ? 'file' : previewKind;
}

function buildIdentity(
  input: ResolveFileIdentityInput,
  previewKind: FileIdentityPreviewKind,
  confidence: FileIdentity['confidence'],
  reason: string,
): FileIdentity {
  const ext = normalizeFileExtension(input.ext ?? undefined);
  const detectedKind = normalizeKind(input.detectedKind);
  return {
    previewKind,
    iconKind: input.detectedIconKind || resolveIconKind(previewKind, ext),
    mimeType: input.mimeType ?? null,
    detectedMimeType: input.detectedMimeType ?? null,
    detectedKind,
    confidence,
    ambiguous: isAmbiguousExtension(ext),
    reason,
  };
}

export function resolveNodeFileIdentity(input: ResolveFileIdentityInput): FileIdentity {
  const ext = normalizeFileExtension(input.ext ?? undefined);
  const parentBuiltInType = normalizeBuiltInType(input.parentBuiltInType);
  const overrideKind = normalizeKind(input.contentKindOverride);
  if (overrideKind) {
    return buildIdentity(input, overrideKind, 'manual', 'content kind override');
  }

  const detectedKind = normalizeKind(input.detectedKind);
  if (detectedKind) {
    return buildIdentity(input, detectedKind, 'detected', 'detected kind');
  }

  const detectedMimeKind = resolveKindFromMime(input.detectedMimeType);
  if (detectedMimeKind) {
    return buildIdentity(input, detectedMimeKind, 'detected', `detected MIME ${normalizeMimeType(input.detectedMimeType)}`);
  }

  const mimeKind = resolveKindFromMime(input.mimeType);
  if (mimeKind) {
    return buildIdentity(input, mimeKind, 'mime', `MIME ${normalizeMimeType(input.mimeType)}`);
  }

  if (ext === 'ts') {
    if (parentBuiltInType === 'VIDEO') {
      return buildIdentity(input, 'video', 'context', 'ambiguous .ts under VIDEO context');
    }
    return buildIdentity(input, 'text', 'extension', 'ambiguous .ts defaults to TypeScript text');
  }

  const extensionKind = resolvePreviewFileType(undefined, ext, input.name ?? undefined);
  if (extensionKind !== 'other') {
    return buildIdentity(input, extensionKind, 'extension', `extension ${ext || 'unknown'}`);
  }

  return buildIdentity(input, 'other', 'unknown', 'no reliable file identity signal');
}

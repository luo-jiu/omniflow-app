import { isViewerContributionId } from '@/shared/viewer-contribution-id';
import { isViewerAccountScope } from '../session/viewer-session-identity';
import type { ViewerFacts } from './viewer-registry';

const PREFIX = 'omniflow:viewer-associations:v1:';
export function viewerFormatKey(facts: ViewerFacts): string {
  if (facts.fileType === 'comic') return 'comic:';
  return `${facts.fileType ?? 'other'}:${/\.([a-z0-9]{1,32})$/i.exec(facts.fileName ?? '')?.[1].toLowerCase() ?? ''}`;
}
function storageKey(accountScope: string, libraryId: number) {
  if (!isViewerAccountScope(accountScope) || !Number.isSafeInteger(libraryId) || libraryId <= 0) throw new Error('Invalid viewer association scope');
  return `${PREFIX}${accountScope}:${libraryId}`;
}
function read(accountScope: string, libraryId: number): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(storageKey(accountScope, libraryId));
  if (!raw || raw.length > 65536) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => /^[a-z_]+:[a-z0-9]{0,32}$/.test(key) && isViewerContributionId(value)).slice(0, 256));
}
export function readViewerAssociation(accountScope: string, libraryId: number, facts: ViewerFacts): string | undefined {
  try { return read(accountScope, libraryId)[viewerFormatKey(facts)]; } catch { return undefined; }
}
export function saveViewerAssociation(accountScope: string, libraryId: number, facts: ViewerFacts, viewerId: string) {
  if (!isViewerContributionId(viewerId)) throw new Error('Invalid viewer id');
  const entries = read(accountScope, libraryId);
  entries[viewerFormatKey(facts)] = viewerId;
  if (Object.keys(entries).length > 256) throw new Error('Too many viewer associations');
  localStorage.setItem(storageKey(accountScope, libraryId), JSON.stringify(entries));
}

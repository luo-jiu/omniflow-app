import type { GlobalAudioPlayerState } from './global-audio-player';

export interface GlobalAudioOwnerIdentity {
  libraryId: number | null;
  ownerKey: string | null;
  ownerType: GlobalAudioPlayerState['ownerType'];
  tabId: string | null;
}

export function isGlobalAudioOwnedBy(
  state: GlobalAudioPlayerState,
  identity: GlobalAudioOwnerIdentity,
): boolean {
  return Boolean(
    identity.ownerKey
    && identity.tabId
    && identity.libraryId != null
    && state.ownerType === identity.ownerType
    && state.ownerKey === identity.ownerKey
    && state.tabId === identity.tabId
    && state.libraryId === identity.libraryId
  );
}

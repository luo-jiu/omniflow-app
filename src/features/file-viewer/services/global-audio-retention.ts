import type { GlobalAudioPlayerState } from './global-audio-player';

export function isOwnedGlobalAudioPlaying(
  state: Pick<GlobalAudioPlayerState, 'isPlaying' | 'libraryId' | 'tabId'>,
  tabId: string,
  libraryId: number | null,
): boolean {
  return state.tabId === tabId
    && state.libraryId === libraryId
    && state.isPlaying;
}

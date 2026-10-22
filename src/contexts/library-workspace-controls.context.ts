import { createContext, useContext } from 'react';

interface LibraryWorkspaceControlsContextValue {
  openWebUrl?: (url: string) => void;
  setVideoWideMode?: (enabled: boolean) => void;
}

export const LibraryWorkspaceControlsContext = createContext<LibraryWorkspaceControlsContextValue>({});

export function useLibraryWorkspaceControls() {
  return useContext(LibraryWorkspaceControlsContext);
}

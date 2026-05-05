import { createContext, useContext } from 'react';

interface LibraryWorkspaceControlsContextValue {
  setVideoWideMode?: (enabled: boolean) => void;
}

export const LibraryWorkspaceControlsContext = createContext<LibraryWorkspaceControlsContextValue>({});

export function useLibraryWorkspaceControls() {
  return useContext(LibraryWorkspaceControlsContext);
}

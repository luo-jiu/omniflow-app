import { createContext } from 'react';

// Visibility is a UI projection, independent of background task ownership.
export const WorkspaceVisibilityContext = createContext(true);

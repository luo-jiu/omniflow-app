import { createContext } from 'react';
// Trusted host adapter projection, not a third-party identity assertion.
export const ViewerContributionContext = createContext<string | undefined>(undefined);

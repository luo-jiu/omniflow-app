import { createContext } from 'react';
import type { AgentFileLink } from '@/shared/agent/agent-file-link';

export const AgentFileLinkContext = createContext<((link: AgentFileLink) => void) | undefined>(undefined);

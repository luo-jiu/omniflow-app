import { createContext } from 'react';
import type { ThemeView } from './theme-view';
import type { ThemeOperationToken, ThemeSelection } from './theme-state';

export const AppearanceViewContext = createContext<ThemeView | null>(null);
export interface AppearanceControls {
  selection: ThemeSelection;
  phase: string;
  preview: (selection: ThemeSelection) => ThemeOperationToken;
  cancel: (token: ThemeOperationToken) => void;
  confirm: (token: ThemeOperationToken) => boolean;
  bindAccount: (accountScope: string, legacyMode: ThemeSelection['mode']) => void;
}
export const AppearanceControlContext = createContext<AppearanceControls | null>(null);

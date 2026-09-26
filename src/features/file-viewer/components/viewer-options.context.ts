import { createContext } from 'react';

/** 宿主打开方式的展示入口；选择和默认关联仍由 FileViewerContext 持有。 */
export const ViewerOptionsContext = createContext<{
  open: () => void;
  unavailable: boolean;
} | null>(null);

import React, { ReactNode } from 'react';
import { MediaRegistryContext } from './media-registry.context';
import { mediaRegistry } from './media-registry.singleton';

// Provider 保留只是为了兼容现有 import；它不再创建/重置 registry，仅做 Context 注入。
// 新代码应直接 import { mediaRegistry } from '@/contexts/media-registry.singleton'，
// 避免依赖 React Context 生命周期。
export const MediaRegistryProvider: React.FC<{ children: ReactNode }> = ({ children }) => (
  <MediaRegistryContext.Provider value={mediaRegistry}>
    {children}
  </MediaRegistryContext.Provider>
);

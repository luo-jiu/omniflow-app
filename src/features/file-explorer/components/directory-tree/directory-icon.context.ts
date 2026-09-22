import { createContext } from 'react';

// 只投影 Tree 已有的受控展开状态，不保存第二份状态。
export const ExpandedDirectoryKeysContext = createContext<ReadonlySet<string>>(new Set());

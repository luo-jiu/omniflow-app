import type { ReactNode } from 'react';

export interface Node {
  id: number;
  name: string;
  type: string;
  parentId: number;
  libraryId: number;
  label: string;
  isLeaf: boolean;
  children?: Node[];
  key: string;
  loaded?: boolean;
  ext?: string;
  mimeType?: string;
  fileSize?: number;
  data?: {
    rawName: string;
    rawExt?: string;
    parentArchiveMode?: number;
    [key: string]: any;
  };
  icon?: ReactNode;
  builtInType?: string;
  archiveMode?: number;
}

export interface NodeRespDTO {
  id: number;
  name: string;
  type: 'dir' | 'file';
  parentId: number;
  libraryId: number;
  ext?: string;
  mimeType?: string;
  fileSize?: number;
  builtInType?: string;
  archiveMode?: number;
}

export interface AppendNodeBatchItem {
  parentNodeKey: string;
  newNodeDTO: NodeRespDTO;
  retryCount?: number;
  firstQueuedAt?: number;
}

export interface RepositoryTreeSnapshot {
  selectedRepository: string;
  rootNodeId: number | null;
  expandedKeys: string[];
  treesCache: Record<string, Node[]>;
}

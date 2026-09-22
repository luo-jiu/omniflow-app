import { useContext } from 'react';
import { getDirectoryBuiltInIcon } from '@/features/file-explorer/utils/file-node-icon';
import { ExpandedDirectoryKeysContext } from './directory-icon.context';

export default function DirectoryNodeIcon({ nodeKey, builtInType, archiveMode }: {
  nodeKey: string;
  builtInType?: string;
  archiveMode?: number;
}) {
  const expanded = useContext(ExpandedDirectoryKeysContext).has(nodeKey);
  return getDirectoryBuiltInIcon(builtInType, archiveMode, expanded)
    ?? getDirectoryBuiltInIcon('DEF', 0, expanded);
}

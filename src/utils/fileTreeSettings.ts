const FILE_TREE_SHOW_SUFFIX_KEY = 'app-file-tree-show-file-suffix';

export function getFileTreeShowSuffix(): boolean {
  const raw = localStorage.getItem(FILE_TREE_SHOW_SUFFIX_KEY);
  if (raw === null) return true;

  try {
    return JSON.parse(raw) === true;
  } catch {
    return raw === 'true';
  }
}

export function setFileTreeShowSuffix(show: boolean) {
  localStorage.setItem(FILE_TREE_SHOW_SUFFIX_KEY, JSON.stringify(show));
}

export function buildTreeNodeLabel(params: {
  name: string;
  type: 'dir' | 'file' | string;
  ext?: string;
}): string {
  const { name, type, ext } = params;
  if (type !== 'file') return name;
  if (!getFileTreeShowSuffix()) return name;
  if (!ext) return name;

  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
  if (name.toLowerCase().endsWith(normalizedExt.toLowerCase())) {
    return name;
  }

  return `${name}${normalizedExt}`;
}

const FILE_TREE_SHOW_SUFFIX_KEY = 'app-file-tree-show-file-suffix';

function normalizeExt(ext?: string): string {
  if (!ext) return '';
  return ext.trim().replace(/^\./, '');
}

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
  const normalizedExt = normalizeExt(ext);
  if (!normalizedExt) return name;
  const extWithDot = `.${normalizedExt}`;
  if (name.toLowerCase().endsWith(extWithDot.toLowerCase())) {
    return name;
  }

  return `${name}${extWithDot}`;
}

export function buildFileFullName(name: string, ext?: string): string {
  const normalizedExt = normalizeExt(ext);
  if (!normalizedExt) return name;
  const extWithDot = `.${normalizedExt}`;
  if (name.toLowerCase().endsWith(extWithDot.toLowerCase())) {
    return name;
  }
  return `${name}${extWithDot}`;
}

export function splitFileBaseNameAndExt(fullName: string): { name: string; ext: string } {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { name: '', ext: '' };
  }

  const lastDotIndex = trimmed.lastIndexOf('.');
  if (lastDotIndex <= 0) {
    return { name: trimmed, ext: '' };
  }

  const baseName = trimmed.slice(0, lastDotIndex).trim();
  const ext = normalizeExt(trimmed.slice(lastDotIndex + 1));

  if (!baseName) {
    return { name: trimmed, ext: '' };
  }

  return { name: baseName, ext };
}

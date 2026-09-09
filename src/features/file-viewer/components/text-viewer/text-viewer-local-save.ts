interface TextViewerLocalSaveBridge {
  saveDownloadFile: (defaultFileName: string, options?: {
    filters?: Array<{
      name: string;
      extensions: string[];
    }>;
  }) => Promise<{
    canceled: boolean;
    filePath: string;
  }>;
  writeTextFile: (filePath: string, content: string) => Promise<string>;
}

function resolveFileExtension(fileName: string): string | null {
  const normalized = String(fileName || '').trim();
  const separatorIndex = normalized.lastIndexOf('.');
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) return null;
  const extension = normalized.slice(separatorIndex + 1).toLowerCase();
  return /^[a-z0-9]+$/i.test(extension) ? extension : null;
}

export function resolveTextFileDialogFilters(fileName: string) {
  const extension = resolveFileExtension(fileName);
  return extension
    ? [
      { name: `${extension.toUpperCase()} 文件`, extensions: [extension] },
      { name: '所有文件', extensions: ['*'] },
    ]
    : [{ name: '所有文件', extensions: ['*'] }];
}

export async function saveTextContentToDesktop(
  bridge: TextViewerLocalSaveBridge,
  fileName: string,
  content: string,
): Promise<string | null> {
  const defaultFileName = String(fileName || '').trim() || '未命名.txt';
  const saveResult = await bridge.saveDownloadFile(defaultFileName, {
    filters: resolveTextFileDialogFilters(defaultFileName),
  });
  if (!saveResult || saveResult.canceled || !saveResult.filePath) return null;
  return bridge.writeTextFile(saveResult.filePath, content);
}

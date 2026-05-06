export type LibraryMediaToolOperation = 'extract-audio' | 'compress-video';

export interface ProcessLibraryMediaFileInput {
  inputFileName: string;
  inputUrl: string;
  operation: LibraryMediaToolOperation;
  outputDirectoryPath?: string;
}

export interface ProcessLibraryMediaFileResult {
  commandArgs?: string[];
  error?: string;
  ffmpegPath?: string;
  ok: boolean;
  outputPath?: string;
}

export async function processLibraryMediaFile(
  input: ProcessLibraryMediaFileInput,
): Promise<ProcessLibraryMediaFileResult> {
  if (!window.electronAPI?.processMediaFile) {
    throw new Error('当前环境不支持媒体文件处理');
  }
  const result = await window.electronAPI.processMediaFile(input);
  if (!result?.ok) {
    throw new Error(result?.error || '媒体处理失败');
  }
  return result;
}
